/* onrent.js - a vendor's on-rent report -> one dated SNAPSHOT of what is on
   rent, line by line, in cents.

   Every upload is a snapshot "as of" a day. What is on rent this month, and
   what went off rent, is read by comparing snapshots (rentals_model.js); the
   file itself is never edited. The as-of day comes from the file where the
   layout says it can (a Report Date column, an export time in the name); if
   the file does not say, the reader asks (NeedsDecision) rather than assume.

   A rental's identity is vendor + equipment # + contract # + the job label
   the vendor bills it under. Non-serialised items (frames, cords, planks)
   repeat that identity one line per unit, so repeats are NUMBERED in the
   order the report lists them, never dropped and never refused.

   A month's rent for a line is the first of these the layout provides:
   a monthly figure, the month rate x quantity, the 4-week rate x quantity.
   A line with only a day or week rate shows that rate and no monthly figure;
   converting it would be a guess. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"), require("./onrent_vendors.js"));
  else root.OnRent = factory(root.Common, root.OnRentVendors);
}(typeof self !== "undefined" ? self : this, function (C, V) {
  "use strict";

  const PERIODS = { day: "day", daily: "day", d: "day", week: "week", weekly: "week", wk: "week", w: "week",
    "4week": "4week", "4 week": "4week", "four week": "4week", "28 day": "4week", "28day": "4week", "4wk": "4week",
    month: "month", monthly: "month", mo: "month", m: "month" };
  // 2026-09-19, 9-19-2026, 9.19.26 (two-digit years only when nothing else is there)
  const DATE_IN_NAME = /(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})|(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/;
  const SHORT_DATE_IN_NAME = /(?<![\d.])(\d{1,2})[-_.](\d{1,2})[-_.](\d{2})(?!\.?\d)/;
  const pad2 = (n) => String(n).padStart(2, "0");

  function asOfFromName(fileName) {
    const name = String(fileName || "");
    let m = name.match(DATE_IN_NAME), iso = null;
    if (m) iso = m[1] ? `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}` : `${m[6]}-${pad2(+m[4])}-${pad2(+m[5])}`;
    else if ((m = name.match(SHORT_DATE_IN_NAME))) iso = `20${m[3]}-${pad2(+m[1])}-${pad2(+m[2])}`;
    if (!iso) return null;
    const d = C.parseDate(iso);
    return d && !Number.isNaN(d) ? d : null;
  }
  function periodOf(v) {
    const n = C.norm(v).replace(/\s+/g, " ");
    if (!n) return null;
    return PERIODS[n] || PERIODS[n.replace(/\s/g, "")] || NaN;
  }
  function flagOf(v) {
    const n = C.norm(v);
    if (!n) return false;
    if (["y", "yes", "true", "1", "liberty", "owned"].includes(n)) return true;
    if (["n", "no", "false", "0"].includes(n)) return false;
    return NaN;
  }
  // vendors write "-" or blank for nothing
  const blank = (v) => v == null || (typeof v === "string" && /^\s*(-+|n\/?a)?\s*$/i.test(v));

  function readWorkbook(wb, fileName = "this file", opts = {}) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = C.rowsOf(ws);
    const found = V.match(rows);
    if (!found) {
      const names = V.confirmed().map((l) => l.name).join("; ");
      throw new C.NotForThisPage(`${fileName} is not an on-rent layout this page reads (${names}). ` +
        `Still awaiting a real export: ${V.awaiting().map((l) => l.name).join("; ")}.`);
    }
    const { layout, rowIndex, col } = found;
    const cols = layout.columns;
    // a field's value: the first named column with something in it
    const pick = (r, field) => {
      const spec = cols[field];
      if (spec == null) return null;
      for (const name of [].concat(spec)) {
        const j = col[C.norm(name)];
        if (j != null && !blank(r[j])) return r[j];
      }
      return null;
    };
    const textOf = (r, f) => C.oneLine(pick(r, f));
    const moneyOf = (r, f, excelRow) => {
      const v = pick(r, f);
      const c = C.cents(v);
      if (Number.isNaN(c)) throw new C.UnknownFormat(`${fileName}: row ${excelRow}: ${[].concat(cols[f])[0]} "${C.str(v)}" is not money.`);
      return c;
    };
    const dateOf = (r, f, excelRow) => {
      const v = pick(r, f);
      const d = C.parseDate(v);
      if (Number.isNaN(d)) throw new C.UnknownFormat(`${fileName}: row ${excelRow}: ${[].concat(cols[f])[0]} "${C.str(v)}" is not a date.`);
      return d;
    };

    const lines = [], asOfs = new Set(), vendorsSeen = new Map(), idCount = new Map();
    let rent = 0, noMonthly = 0, skipped = 0, identified = 0, unidentified = [], noUnit = 0;
    const notCounted = {};
    for (let i = rowIndex + 1; i < rows.length; i++) {
      const r = rows[i];
      if (C.isBlankRow(r)) { skipped++; continue; }
      const excelRow = i + 1;
      const first = C.str(r[0]);
      if (layout.skip && layout.skip.some((s) => C.norm(first) === C.norm(s))) { skipped++; continue; }
      const where = `${fileName}: row ${excelRow}`;
      if (layout.identify) {
        const v = C.str(r[col[C.norm(layout.identify.column)]]);
        if (layout.identify.pattern.test(v)) identified++; else unidentified.push(v || "(blank)");
      }
      if (layout.only) {
        const v = C.str(r[col[C.norm(layout.only.column)]]);
        if (C.norm(v) !== C.norm(layout.only.value)) { notCounted[v || "(blank)"] = (notCounted[v || "(blank)"] || 0) + 1; continue; }
      }
      if (layout.layout === "generic") {
        const vendorText = textOf(r, "vendor");
        if (!vendorText) throw new C.UnknownFormat(`${where} has no Vendor.`);
        vendorsSeen.set(C.norm(vendorText), vendorText);
      }
      let equipment_no = textOf(r, "equipment_no"), equipmentFrom = "unit";
      if (!equipment_no && cols.equipment_fallback) {
        const parts = cols.equipment_fallback.map((name) => C.str(r[col[C.norm(name)]]));
        if (parts.every(Boolean)) { equipment_no = parts.join("-"); equipmentFrom = "cat-class"; noUnit++; }
      }
      const contract_no = textOf(r, "contract_no");
      let vendor_job_ref = textOf(r, "job_ref");
      if (!equipment_no) throw new C.UnknownFormat(`${where} has no equipment number (${[].concat(cols.equipment_no).join(" / ")}).`);
      if (!contract_no) throw new C.UnknownFormat(`${where} has no contract number.`);
      if (!vendor_job_ref) vendor_job_ref = "(no job named)";
      const qtyRaw = pick(r, "qty");
      let qty = C.toNumber(qtyRaw);
      if (qty == null) qty = 1;
      if (Number.isNaN(qty) || qty <= 0) throw new C.UnknownFormat(`${where}: quantity "${C.str(qtyRaw)}" is not a positive number.`);
      const on_rent_date = dateOf(r, "on_rent_date", excelRow);
      const day = moneyOf(r, "day_rate", excelRow), week = moneyOf(r, "week_rate", excelRow),
        four = moneyOf(r, "fourweek_rate", excelRow), month = moneyOf(r, "month_rate", excelRow);
      let rate_period = null, rate_cents = null, monthly_rent_cents = null;
      if (layout.monthly === "generic") {
        rate_period = periodOf(pick(r, "rate_period"));
        if (Number.isNaN(rate_period)) throw new C.UnknownFormat(`${where}: Rate Period "${C.str(pick(r, "rate_period"))}" is not day, week, 4week or month.`);
        rate_cents = moneyOf(r, "rate", excelRow);
        monthly_rent_cents = moneyOf(r, "monthly_rent", excelRow);
        if (monthly_rent_cents == null && rate_period === "month" && rate_cents != null) monthly_rent_cents = C.roundHalfUp(rate_cents * qty);
      } else if (month != null) { rate_period = "month"; rate_cents = month; monthly_rent_cents = C.roundHalfUp(month * qty); }
      else if (four != null) { rate_period = "4week"; rate_cents = four; monthly_rent_cents = C.roundHalfUp(four * qty); }
      else if (week != null) { rate_period = "week"; rate_cents = week; }
      else if (day != null) { rate_period = "day"; rate_cents = day; }
      const lo = flagOf(pick(r, "liberty_owned"));
      if (Number.isNaN(lo)) throw new C.UnknownFormat(`${where}: Liberty Owned "${C.str(pick(r, "liberty_owned"))}" must be Y or N.`);
      const asOfCell = dateOf(r, "as_of", excelRow);
      if (asOfCell) asOfs.add(asOfCell);
      const id = [equipment_no, contract_no, vendor_job_ref].join("|");
      const seq = (idCount.get(id) || 0) + 1;
      idCount.set(id, seq);
      const line = { row_index: excelRow, equipment_no, contract_no, vendor_job_ref, seq,
        line_ref: textOf(r, "line_ref") || null, description: textOf(r, "description"), qty,
        on_rent_date: on_rent_date || null, rate_period, rate_cents, monthly_rent_cents,
        day_rate_cents: day, week_rate_cents: week, fourweek_rate_cents: four, month_rate_cents: month,
        po: textOf(r, "po") || null, est_return: dateOf(r, "est_return", excelRow) || null,
        billed_through: dateOf(r, "billed_through", excelRow) || null, pickup_date: dateOf(r, "pickup_date", excelRow) || null,
        liberty_owned: lo, cost_code: textOf(r, "cost_code") || null,
        raw: { equipment_from: equipmentFrom === "unit" ? null : equipmentFrom, job_ref_alt: textOf(r, "job_ref_alt") || null, ordered_by: textOf(r, "ordered_by") || null, account: textOf(r, "account") || null,
          cat_class: textOf(r, "cat_class") || null, make: textOf(r, "make") || null, model: textOf(r, "model") || null, serial: textOf(r, "serial") || null,
          code1: textOf(r, "code1") || null, code1_label: textOf(r, "code1_label") || null, code2: textOf(r, "code2") || null, code2_label: textOf(r, "code2_label") || null,
          status: textOf(r, "status") || null, shift: textOf(r, "shift") || null, next_bill: dateOf(r, "next_bill", excelRow) || null,
          days_on_rent: C.toNumber(pick(r, "days_on_rent")), billed_to_date_cents: C.cents(pick(r, "billed_to_date")) },
      };
      for (const k of Object.keys(line.raw)) if (line.raw[k] == null || Number.isNaN(line.raw[k])) delete line.raw[k];
      if (monthly_rent_cents == null) noMonthly++; else rent += monthly_rent_cents;
      lines.push(line);
    }
    if (!lines.length) throw new C.UnknownFormat(`${fileName} has a header and no rental lines.`);
    if (layout.identify && !identified) {
      throw new C.UnknownFormat(`${fileName} has ${layout.name.split(" - ")[0]}'s columns, but its ${layout.identify.column} column reads ` +
        `"${unidentified[0]}" (${layout.identify.says}). Which vendor's report is it?`);
    }

    let vendor;
    if (layout.layout === "generic") {
      if (vendorsSeen.size > 1) throw new C.UnknownFormat(`${fileName} names ${vendorsSeen.size} vendors (${[...vendorsSeen.values()].join(", ")}). One on-rent report is one vendor's; split it.`);
      vendor = V.vendorFromName([...vendorsSeen.values()][0]);
    } else vendor = Object.assign({ known: true }, V.vendorFromName(layout.vendor_key), { vendor_key: layout.vendor_key, name: V.vendorName(layout.vendor_key) });
    if (vendor.liberty_owned) lines.forEach((l) => { l.liberty_owned = true; });

    let as_of = null, asOfSource = null;
    if (opts.as_of) { as_of = C.parseDate(opts.as_of); asOfSource = "given"; }
    else if (asOfs.size === 1) { as_of = [...asOfs][0]; asOfSource = "column"; }
    else if (asOfs.size > 1) throw new C.UnknownFormat(`${fileName}: the ${cols.as_of} column carries ${asOfs.size} different days; one report is as of one day.`);
    else if (layout.as_of.name && asOfFromName(fileName)) { as_of = asOfFromName(fileName); asOfSource = "name"; }
    if (!as_of || Number.isNaN(as_of)) {
      throw new C.NeedsDecision(`${fileName} does not say what day it is as of${layout.as_of.column ? ` (its ${layout.as_of.column} column is empty)` : ""}. Say the date and it reads.`,
        { need: "as_of", fileName, layout: layout.layout });
    }
    const repeats = [...idCount.values()].filter((n) => n > 1).length;
    const jobRefs = {};
    for (const l of lines) jobRefs[l.vendor_job_ref] = (jobRefs[l.vendor_job_ref] || 0) + 1;
    return {
      kind: "onrent", fileName, layout: layout.layout, layoutName: layout.name,
      vendor_key: vendor.vendor_key, vendor_name: vendor.name, vendorKnown: !!vendor.known,
      as_of, asOfSource, lines,
      totals: { lines: lines.length, rent_cents: rent, noMonthly, skipped, repeats, noUnit, notCounted,
        liberty_owned: lines.filter((l) => l.liberty_owned).length,
        jobRefs: Object.keys(jobRefs).sort(), jobRefCounts: jobRefs },
    };
  }
  const read = (data, fileName, opts) => readWorkbook(C.readBook(data), fileName, opts);
  const looksLike = (wb) => !!V.match(C.rowsOf(wb.Sheets[wb.SheetNames[0]], 25));

  return { PERIODS, asOfFromName, periodOf, looksLike, readWorkbook, read };
}));
