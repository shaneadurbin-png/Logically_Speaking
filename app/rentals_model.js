/* rentals_model.js - from snapshots to what a month of rentals costs the client.

   Rent is what the vendor charges for a month. The client is billed rent, plus
   sales tax where the job's site taxes rentals (7% at CDR, none at SBN) and
   the vendor's rental is taxable, plus Liberty's markup - the same arithmetic
   GRforecast's on-rent calculator does and WeeklyCostData carried per row.
   Tax and markup are the JOB's settings; whether a vendor's rent is taxed at
   all is the vendor's. Lines under no job carry neither. All of it in integer
   cents, rounded half away from zero.

   A month's rentals are what the LATEST snapshot on or before the month's
   end shows on rent (run-rate). Items on an earlier snapshot that this one
   lacks went off rent, and are listed, not prorated. Proration is a setting
   for a later release, decided by a person, not here. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.RentalsModel = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({ taxable: true, tax_bp: 700, markup_bp: 1000, markup_base: "rent_plus_tax" });
  const identity = (vendor_key, l) => [vendor_key, l.equipment_no, l.contract_no, l.vendor_job_ref, l.seq || 1].join("|");

  /** settings = { vendors: {vendor_key: {taxable, liberty_owned}}, jobs: {job_number: {tax_bp, markup_bp, markup_base}} }
      (an old-style flat {vendor_key: {...}} still reads). "unmapped" gets no tax and no markup. */
  function settingsFor(settings, vendor_key, job_number) {
    const S = settings || {};
    const v = (S.vendors && S.vendors[vendor_key]) || (!S.vendors && !S.jobs && S[vendor_key]) || {};
    const j = (S.jobs && S.jobs[job_number]) || {};
    const out = { taxable: v.taxable != null ? !!v.taxable : DEFAULT_SETTINGS.taxable,
      tax_bp: j.tax_bp != null ? j.tax_bp : (v.tax_bp != null ? v.tax_bp : DEFAULT_SETTINGS.tax_bp),
      markup_bp: j.markup_bp != null ? j.markup_bp : (v.markup_bp != null ? v.markup_bp : DEFAULT_SETTINGS.markup_bp),
      markup_base: j.markup_base || v.markup_base || DEFAULT_SETTINGS.markup_base };
    if (!job_number || job_number === "unmapped") { out.taxable = false; out.markup_bp = 0; }
    if (!["rent", "rent_plus_tax"].includes(out.markup_base)) throw new C.Refusal(`markup_base must be rent or rent_plus_tax, not ${out.markup_base}`);
    return out;
  }

  /** rent cents -> {rent, tax, markup, total} cents under one vendor's settings. */
  function cost(rentCents, s) {
    const rent = rentCents || 0;
    const tax = s.taxable ? C.bp(rent, s.tax_bp) : 0;
    const markup = C.bp(rent + (s.markup_base === "rent_plus_tax" ? tax : 0), s.markup_bp);
    return { rent, tax, markup, total: rent + tax + markup };
  }

  /** What changed between two snapshots of one vendor. prev may be null. */
  function diff(prev, cur) {
    if (prev && prev.vendor_key !== cur.vendor_key) throw new C.Refusal(`snapshots are from two vendors (${prev.vendor_key}, ${cur.vendor_key}).`);
    if (prev && cur.as_of <= prev.as_of) {
      throw new C.Refusal(`the ${C.fmtDay(cur.as_of)} report is not newer than the ${C.fmtDay(prev.as_of)} one already on file.`);
    }
    const before = new Map((prev ? prev.lines : []).map((l) => [identity(cur.vendor_key, l), l]));
    const after = new Map(cur.lines.map((l) => [identity(cur.vendor_key, l), l]));
    const added = [], kept = [], dropped = [];
    for (const [id, l] of after) (before.has(id) ? kept : added).push(l);
    for (const [id, l] of before) if (!after.has(id)) dropped.push(Object.assign({}, l, { off_rent_date: cur.as_of, last_seen: prev.as_of }));
    return { added, kept, dropped };
  }

  /** The snapshot that stands for a month: the latest as_of on or before the
      month's last day. null when none is. */
  function snapshotForMonth(snapshots, ym) {
    const end = C.monthEnd(ym);
    let best = null;
    // snapshots arrive in the order they were recorded: of two as of the same day, the one recorded last stands
    for (const s of snapshots || []) if (s.as_of <= end && (!best || s.as_of >= best.as_of)) best = s;
    return best;
  }

  /* lines of one vendor's snapshot -> per job: rent, tax, markup, total,
     Liberty-owned rent apart, lines with no monthly figure counted.
     jobMap: {vendor_job_ref: job_number}; a ref not in it lands under "unmapped". */
  function monthCost(snapshot, settings, jobMap) {
    const byJob = {};
    for (const l of snapshot.lines) {
      const job = (jobMap && jobMap[l.vendor_job_ref]) || "unmapped";
      const j = byJob[job] || (byJob[job] = { job_number: job, vendor_key: snapshot.vendor_key, as_of: snapshot.as_of,
        lines: 0, noMonthly: 0, rent: 0, liberty_owned_rent: 0, liberty_owned_lines: 0, refs: new Set() });
      j.lines++; j.refs.add(l.vendor_job_ref);
      if (l.monthly_rent_cents == null) { j.noMonthly++; continue; }
      if (l.liberty_owned) { j.liberty_owned_rent += l.monthly_rent_cents; j.liberty_owned_lines++; }
      else j.rent += l.monthly_rent_cents;
    }
    for (const j of Object.values(byJob)) {
      const s = settingsFor(settings, snapshot.vendor_key, j.job_number);
      Object.assign(j, cost(j.rent, s));
      j.refs = [...j.refs].sort();
      j.settings = s;
    }
    return byJob;
  }

  /** Rows for the client's monthly statement for one job: one per rental, then a total. */
  function statement(snapshot, settings, jobMap, job_number, dropped) {
    const s = settingsFor(settings, snapshot.vendor_key, job_number);
    const rows = [];
    for (const l of snapshot.lines) {
      const job = (jobMap && jobMap[l.vendor_job_ref]) || "unmapped";
      if (job !== job_number) continue;
      const c = l.monthly_rent_cents == null ? null : (l.liberty_owned ? { rent: l.monthly_rent_cents, tax: 0, markup: 0, total: l.monthly_rent_cents } : cost(l.monthly_rent_cents, s));
      rows.push({ equipment_no: l.equipment_no, contract_no: l.contract_no, description: l.description, qty: l.qty,
        on_rent_date: l.on_rent_date, rate_period: l.rate_period, rate_cents: l.rate_cents,
        liberty_owned: l.liberty_owned, monthly_rent_cents: l.monthly_rent_cents,
        tax_cents: c ? c.tax : null, markup_cents: c ? c.markup : null, total_cents: c ? c.total : null });
    }
    rows.sort((a, b) => (a.description < b.description ? -1 : a.description > b.description ? 1 : a.equipment_no < b.equipment_no ? -1 : 1));
    const total = rows.reduce((t, r) => ({ rent: t.rent + (r.liberty_owned ? 0 : r.monthly_rent_cents || 0), tax: t.tax + (r.tax_cents || 0),
      markup: t.markup + (r.markup_cents || 0), total: t.total + (r.total_cents || 0),
      liberty_owned: t.liberty_owned + (r.liberty_owned ? r.monthly_rent_cents || 0 : 0) }), { rent: 0, tax: 0, markup: 0, total: 0, liberty_owned: 0 });
    const off = (dropped || []).filter((l) => ((jobMap && jobMap[l.vendor_job_ref]) || "unmapped") === job_number);
    return { job_number, vendor_key: snapshot.vendor_key, as_of: snapshot.as_of, settings: s, rows, total, offRent: off,
      noMonthly: rows.filter((r) => r.monthly_rent_cents == null).length };
  }

  return { DEFAULT_SETTINGS, identity, settingsFor, cost, diff, snapshotForMonth, monthCost, statement };
}));
