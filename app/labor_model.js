/* labor_model.js - how an HH2 row becomes a cost, and when it does not.

   Rates are Sage's own rate tables (app/sage_rates.js reads the export). The
   key is EXACT: rate table | certified class | pay ID, with
     the rate table   the one assigned to the row's job (#225008 for SBN 204),
     certified class  the employee's, as Sage names it (#CARP-J, #LAB-GF,
                      #SUP ...), set in Settings or defaulted from the
                      employee number's prefix,
     pay ID           HH2's PayType column verbatim (UNION REG, REG, O/T ...),
                      which is Sage's Pay ID.

   A row that cannot be priced is HELD, with the reason, and shows as held
   hours until someone answers in Settings. It is never priced at zero.

   The same rules live in the database (app.labor_priced); the tests hold
   the two to each other on the fixture. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.LaborModel = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  // Certified class from the employee number's prefix, when the employee has
  // none set. The prefixes are a setting (Settings > Employees > Prefix
  // defaults: "FB5 is a Laborer journeyman, then hand-pick the foremen");
  // these are the ones every workspace starts with. FB1 (safety) has no
  // default: it is set, never guessed.
  const PREFIX_CLASS = { FB2: "#LAB-J", FB5: "#LAB-J", TTR: "#LAB-J", FB7: "#CARP-J", FB8: "#CARP-J" };
  const TRADE_OF = { CARP: "Carpenter", LAB: "Laborer", SUP: "Superintendent", SAF: "Safety" };
  const LEVEL_OF = { J: "Journeyman", F: "Foreman", GF: "General Foreman", A: "Apprentice", NU: "Non-union" };
  const KNOWN_CLASSES = ["#CARP-A", "#CARP-J", "#CARP-F", "#CARP-GF", "#CARP-NU", "#LAB-A", "#LAB-J", "#LAB-F", "#LAB-GF", "#LAB-NU", "#SUP"];
  // Paid time off: hours, but no billable rate. Held for the audit, never rated.
  const PTO_PAY_TYPES = ["Vacation", "Holiday", "Sick Time", "Flex Paid Time Off", "Birthday Time Off", "Floating Hol"];
  const POLICIES = ["rated", "held_pto", "excluded"];

  /** {FB5: "#LAB-J", ...} from the rows Settings keeps ([{prefix, certified_class}]); an object passes through; nothing given = the page's own list */
  function prefixMap(rows) {
    if (rows == null) return PREFIX_CLASS;
    if (!Array.isArray(rows)) return rows;
    const m = {};
    for (const r of rows) if (r && r.prefix && r.certified_class) m[String(r.prefix).toUpperCase()] = r.certified_class;
    return m;
  }
  /** The class the number's prefix implies: the longest listed prefix it starts with, or null. */
  function classFromPrefix(employeeNumber, prefixes) {
    const n = String(employeeNumber || "").toUpperCase();
    let bestPrefix = "", bestClass = null;
    for (const [p, c] of Object.entries(prefixMap(prefixes))) {
      const k = String(p).toUpperCase();
      if (k && n.startsWith(k) && k.length > bestPrefix.length) { bestPrefix = k; bestClass = c; }
    }
    return bestClass;
  }
  /** "#CARP-GF" -> {trade: "Carpenter", level: "General Foreman", label: "Carpenter General Foreman"} */
  function classParts(code) {
    const m = String(code || "").toUpperCase().match(/^#?([A-Z]+)(?:-([A-Z]+))?$/);
    if (!m) return { trade: code || "", level: "", label: code || "" };
    const trade = TRADE_OF[m[1]] || m[1], level = m[2] ? (LEVEL_OF[m[2]] || m[2]) : "";
    return { trade, level, label: level ? `${trade} ${level}` : trade };
  }
  const classLabel = (code) => classParts(code).label;
  const weekEnding = (iso) => C.sundayOnOrAfter(iso);
  const rateKey = (table, cclass, payId) => [table, cclass, payId].join(" | ");

  /** The rate in force on a day for an exact key, or null.
      rates: [{rate_table_code, certified_class, pay_id, rate_cents, effective_from, effective_to (exclusive, nullable), retired_at (nullable)}] */
  function findRate(rates, table, cclass, payId, workDate) {
    let best = null;
    for (const r of rates || []) {
      if (r.retired_at) continue;
      if (r.rate_table_code !== table || r.certified_class !== cclass || r.pay_id !== payId) continue;
      if (r.effective_from && workDate < r.effective_from) continue;
      if (r.effective_to && workDate >= r.effective_to) continue;
      if (best) throw new C.Refusal(`two rates are in force on ${C.fmtDay(workDate)} for ${rateKey(table, cclass, payId)}; retire one.`);
      best = r;
    }
    return best;
  }

  function policyOf(payTypeName, policy) {
    if (policy && payTypeName in policy) return policy[payTypeName];
    return PTO_PAY_TYPES.includes(payTypeName) ? "held_pto" : "rated";
  }

  /* rows from HH2.read -> the same rows with certified_class, status, reason,
     rate_cents, cost_cents (cost null unless priced).
     ctx: { rates, employees: {number: {certified_class}}, policy: {payTypeName: policy},
            jobs: [{job_number, rate_table_code}] } */
  function price(rows, ctx) {
    const jobs = new Map((ctx.jobs || []).map((j) => [j.job_number, j]));
    const employees = ctx.employees || {};
    const prefixes = prefixMap(ctx.prefixes);
    return rows.map((r) => {
      const e = employees[r.employee_number] || {};
      // the class the row itself carries (the labor history) stands for that row; else the person's; else the prefix
      const cclass = r.class_given || e.certified_class || classFromPrefix(r.employee_number, prefixes);
      const out = Object.assign({}, r, { certified_class: cclass, class_label: cclass ? classLabel(cclass) : null, week_ending: weekEnding(r.work_date),
        rate_table_code: null, status: "priced", reason: "", rate_cents: null, cost_cents: null, price_source: null });
      const pol = policyOf(r.pay_type_name, ctx.policy);
      const job = jobs.get(r.job_number);
      if (!job) return held(out, "unknown job", `${r.job_number} is not a job in Settings`);
      out.rate_table_code = job.rate_table_code || null;
      if (pol === "excluded") { out.status = "excluded"; out.reason = `${r.pay_type_name} is excluded by policy`; return out; }
      if (pol === "held_pto") return held(out, "PTO pay type", `${r.pay_type_name} has no billable rate`);
      // the labor history: the cost the old workbook gave the row is taken as its cost
      if (r.cost_given_cents != null) { out.cost_cents = r.cost_given_cents; out.price_source = "given"; return out; }
      if (!job.rate_table_code) return held(out, "no rate table", `job ${r.job_number} has no rate table assigned in Settings`);
      if (!cclass) return held(out, "no class", `employee ${r.employee_number} has no certified class in Settings and no known prefix`);
      const rate = findRate(ctx.rates, job.rate_table_code, cclass, r.pay_type, r.work_date);
      if (!rate) return held(out, "no rate", `no rate for ${rateKey(job.rate_table_code, cclass, r.pay_type)} on ${C.fmtDay(r.work_date)}`);
      out.rate_cents = rate.rate_cents;
      out.rate_id = rate.id || null;
      out.cost_cents = C.roundHalfUp(r.hours_x100 * rate.rate_cents / 100);
      out.price_source = "rate";
      return out;
    });
  }
  function held(row, why, detail) { row.status = "held:" + why; row.reason = detail; return row; }

  /** Totals a person can read off: rows, hours, cost, what is held and why. */
  function summarize(priced) {
    const s = { rows: 0, hoursX100: 0, costCents: 0,
      priced: { rows: 0, hoursX100: 0, costCents: 0 }, held: { rows: 0, hoursX100: 0, byReason: {} },
      excluded: { rows: 0, hoursX100: 0 }, byJob: {}, byWeek: {}, byClass: {} };
    for (const r of priced) {
      s.rows++; s.hoursX100 += r.hours_x100;
      const j = s.byJob[r.job_number] || (s.byJob[r.job_number] = { job_number: r.job_number, rows: 0, hoursX100: 0, costCents: 0, heldHoursX100: 0, heldRows: 0 });
      j.rows++; j.hoursX100 += r.hours_x100;
      const w = s.byWeek[r.week_ending] || (s.byWeek[r.week_ending] = { week_ending: r.week_ending, hoursX100: 0, costCents: 0, heldHoursX100: 0 });
      w.hoursX100 += r.hours_x100;
      if (r.status === "priced") {
        s.priced.rows++; s.priced.hoursX100 += r.hours_x100; s.priced.costCents += r.cost_cents; s.costCents += r.cost_cents;
        j.costCents += r.cost_cents; w.costCents += r.cost_cents;
        const tk = `${r.certified_class}|${r.pay_type}`;
        const t = s.byClass[tk] || (s.byClass[tk] = { certified_class: r.certified_class, pay_id: r.pay_type, hoursX100: 0, costCents: 0 });
        t.hoursX100 += r.hours_x100; t.costCents += r.cost_cents;
      } else if (r.status === "excluded") {
        s.excluded.rows++; s.excluded.hoursX100 += r.hours_x100;
      } else {
        const why = r.status.slice(5);
        s.held.rows++; s.held.hoursX100 += r.hours_x100; j.heldRows++; j.heldHoursX100 += r.hours_x100; w.heldHoursX100 += r.hours_x100;
        const b = s.held.byReason[why] || (s.held.byReason[why] = { rows: 0, hoursX100: 0 });
        b.rows++; b.hoursX100 += r.hours_x100;
      }
    }
    return s;
  }

  /** "412 rows, 3,214.5 hours, 7 held (5 no rate, 2 PTO pay type)" */
  function stamp(summary) {
    let t = `${C.fmtInt(summary.rows)} rows, ${C.fmtHours(summary.hoursX100)} hours`;
    if (summary.held.rows) {
      const parts = Object.entries(summary.held.byReason).map(([why, b]) => `${b.rows} ${why}`);
      t += `, ${summary.held.rows} held (${parts.join(", ")})`;
    }
    if (summary.excluded.rows) t += `, ${summary.excluded.rows} excluded`;
    return t;
  }

  /** The Sage rate table a job most likely uses: its code carries the job
      number's last six digits (#225008 for 50-60-225008, #225040MC for 50-60-225040). */
  function tableForJob(jobNumber, tableCodes) {
    const digits = String(jobNumber || "").replace(/\D/g, "").slice(-6);
    if (digits.length < 6) return null;
    const hits = (tableCodes || []).filter((c) => String(c).replace(/\D/g, "").endsWith(digits));
    return hits.length === 1 ? hits[0] : null;
  }

  return { PREFIX_CLASS, KNOWN_CLASSES, PTO_PAY_TYPES, POLICIES, prefixMap, classFromPrefix, classParts, classLabel, weekEnding, rateKey, findRate, policyOf, price, summarize, stamp, tableForJob };
}));
