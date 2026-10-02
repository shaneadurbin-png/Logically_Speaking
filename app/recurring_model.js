/* recurring_model.js - the charges on a Job Cost To Date that come back
   every month: the same vendor, the same line, the same amount, month after
   month. Those are the rentals no on-rent report covers (an office trailer,
   a contract minimum, a generator from a dealer, Liberty's own equipment
   charged to the job) and, for the vendors that do send reports, a check on
   the report's run-rate.

   A candidate is a group of equipment lines (Cat EQU: vendor invoices and
   IV cost, Liberty's internal charges) with one exact amount, seen in two
   or more months with at most one month missing between the first and the
   last. Reversals net out first: a credit cancels the earliest charge on
   the same invoice with the same line and amount. Units are the line count
   in the latest month seen (the current run-rate), and a month with more
   than twice that many lines means it is not one charge a month, so no.
   The same rule, in SQL, is app.recurring_candidates; the tests hold the
   two to each other. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.RecurringModel = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  /** "POLARIS RANGER C~1M03/29-04/25" -> "POLARIS RANGER C~1M"; "CDR DC4 7/1-7/31/26" -> "CDR DC4" */
  function normDesc(s) {
    return C.str(s).toUpperCase()
      .replace(/^\(REV\)\s*/, "")
      .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*-\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, " ")
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  const monthIndex = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m - 1; };
  const LIBERTY = "LIBERTY";
  const vendorOf = (l) => l.vendor_code || (l.trans_type === "IV cost" ? LIBERTY : null);
  const keyOf = (job, vendor, desc, amt) => `${job}|${vendor}|${desc}|${amt}`;

  /** lines (jctd rows) -> candidates, largest monthly first.
      opts: { onFeed: (vendor_name) => bool, latestMonth: "YYYY-MM" (default: the latest month on the job's ledger) } */
  function candidates(lines, opts = {}) {
    const onFeed = opts.onFeed || (() => false);
    const eq = (lines || []).filter((l) => (l.trans_type === "AP cost" || l.trans_type === "IV cost") && l.cat === "EQU" && l.amount_cents && vendorOf(l));
    // net reversals: per (job, vendor, invoice, line, amount), a credit cancels the earliest charge
    const pos = {}, neg = {};
    for (const l of eq) {
      const k = [l.job_number, vendorOf(l), l.invoice || "", normDesc(l.description), Math.abs(l.amount_cents)].join("|");
      (l.amount_cents > 0 ? pos : neg)[k] = ((l.amount_cents > 0 ? pos : neg)[k] || []).concat([l]);
    }
    const kept = [];
    for (const [k, ls] of Object.entries(pos)) {
      ls.sort((a, b) => (a.trans_date < b.trans_date ? -1 : a.trans_date > b.trans_date ? 1 : a.row_index - b.row_index));
      kept.push(...ls.slice((neg[k] || []).length));
    }
    // the latest month on the ledger, per job: a charge last seen that month or the one before is current
    const latestBy = {};
    for (const l of eq) { const m = l.trans_date.slice(0, 7); if (!latestBy[l.job_number] || m > latestBy[l.job_number]) latestBy[l.job_number] = m; }
    const groups = {};
    for (const l of kept) {
      const vendor = vendorOf(l), desc = normDesc(l.description), k = keyOf(l.job_number, vendor, desc, l.amount_cents);
      const g = groups[k] || (groups[k] = { key: k, job_number: l.job_number, vendor_code: vendor, vendor_name: l.vendor_name || (vendor === LIBERTY ? "Liberty-owned (internal)" : vendor),
        description: desc, amount_cents: l.amount_cents, liberty_owned: l.trans_type === "IV cost", cost_code: l.cost_code, months: {}, first: l.trans_date, last: l.trans_date, invoices: new Set(), lines: 0 });
      const m = l.trans_date.slice(0, 7);
      g.months[m] = (g.months[m] || 0) + 1; g.lines++;
      if (l.trans_date < g.first) g.first = l.trans_date; if (l.trans_date > g.last) g.last = l.trans_date;
      if (l.invoice) g.invoices.add(l.invoice);
    }
    const out = [];
    for (const g of Object.values(groups)) {
      const months = Object.keys(g.months).sort();
      if (months.length < 2) continue;
      const span = monthIndex(months[months.length - 1]) - monthIndex(months[0]) + 1;
      if (span - months.length > 1) continue;
      const units = g.months[months[months.length - 1]];
      if (Math.max(...Object.values(g.months)) > units * 2) continue;
      const lastMonth = months[months.length - 1];
      out.push({ key: g.key, job_number: g.job_number, vendor_code: g.vendor_code, vendor_name: g.vendor_name, description: g.description, cost_code: g.cost_code,
        amount_cents: g.amount_cents, units, monthly_cents: g.amount_cents * units, months, months_seen: months.length, first_month: months[0], last_month: lastMonth,
        first_date: g.first, last_date: g.last, lines: g.lines, invoices: [...g.invoices].sort().slice(0, 6), liberty_owned: g.liberty_owned,
        on_feed: !g.liberty_owned && !!onFeed(g.vendor_name), current: monthIndex(opts.latestMonth || latestBy[g.job_number]) - monthIndex(lastMonth) <= 1 });
    }
    out.sort((a, b) => b.monthly_cents - a.monthly_cents || (a.key < b.key ? -1 : 1));
    return out;
  }
  function summary(cands) {
    const off = cands.filter((c) => !c.on_feed), on = cands.filter((c) => c.on_feed);
    const sum = (xs) => xs.reduce((t, c) => t + c.monthly_cents, 0);
    return { total: cands.length, off_feed: off.length, on_feed: on.length, off_feed_monthly_cents: sum(off.filter((c) => c.current)), on_feed_monthly_cents: sum(on.filter((c) => c.current)),
      current: cands.filter((c) => c.current).length, liberty_owned: cands.filter((c) => c.liberty_owned).length };
  }
  /** a confirmed charge's month figure: markup on the amount; tax only when the amount does not already carry it */
  function monthCost(charge, job) {
    const rent = charge.monthly_cents;
    const tax = charge.amount_includes_tax === false && job && job.tax_bp ? C.roundHalfUp(rent * job.tax_bp / 10000) : 0;
    const markupBp = charge.liberty_owned ? 0 : (job && job.markup_bp != null ? job.markup_bp : 0);
    const base = job && job.markup_base === "rent" ? rent : rent + tax;
    const markup = C.roundHalfUp(base * markupBp / 10000);
    return { rent, tax, markup, total: rent + tax + markup };
  }
  /** is the charge in force in month ym? start_month..end_month inclusive (end null = open) */
  const inForce = (charge, ym) => (!charge.start_month || charge.start_month.slice(0, 7) <= ym) && (!charge.end_month || charge.end_month.slice(0, 7) >= ym);

  return { normDesc, candidates, summary, monthCost, inForce, keyOf, LIBERTY };
}));
