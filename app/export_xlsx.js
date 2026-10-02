/* export_xlsx.js - the workbooks the page hands out, built with SheetJS from
   the same figures the page shows. Cents become dollars here and nowhere
   else. Totals are written as numbers so Excel's own SUM agrees. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./vendor/xlsx.full.min.js"), require("./common.js"), require("./buckets.js"), require("./labor_model.js"));
  else root.ExportXlsx = factory(root.XLSX, root.Common, root.Buckets, root.LaborModel);
}(typeof self !== "undefined" ? self : this, function (XLSX, C, B, L) {
  "use strict";
  const classLabel = (c) => (c ? L.classLabel(c) : "");
  const $ = (c) => (c == null ? null : C.fromCents(c));
  const h = (x100) => (x100 == null ? null : x100 / 100);
  const money = "$#,##0.00", hours = "#,##0.00";

  function sheet(aoa, opts = {}) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (opts.widths) ws["!cols"] = opts.widths.map((w) => ({ wch: w }));
    if (opts.fmt) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = range.s.r; r <= range.e.r; r++) for (const [col, z] of Object.entries(opts.fmt)) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: +col })];
        if (cell && typeof cell.v === "number") cell.z = z;
      }
    }
    return ws;
  }
  const safeName = (s) => C.oneLine(s).replace(/[\[\]:*?/\\]/g, "-").slice(0, 31) || "Sheet";

  /* One job, one month.
     d = { job: {job_number, short_name, name}, month: "2026-09",
           labor: { summary, rows (priced) }, rentals: [statement...], purchases: [{vendor, doc_number, doc_date, description, cost_code, bucket, amount_cents, status, order_type}],
           recurring: [{vendor_name, description, units, rent_cents, tax_cents, markup_cents, total_cents, start_month, end_month, liberty_owned}] } */
  function jobMonth(d) {
    const wb = XLSX.utils.book_new();
    const title = `${d.job.short_name || d.job.job_number} - ${C.fmtMonth(d.month)}`;
    const lab = d.labor && d.labor.summary;
    const rentTotal = (d.rentals || []).reduce((t, s) => t + s.total.total, 0);
    const rentLO = (d.rentals || []).reduce((t, s) => t + s.total.liberty_owned, 0);
    const purch = (d.purchases || []).filter((p) => p.status !== "excluded" && p.order_type !== "Rental").reduce((t, p) => t + p.amount_cents, 0);
    const recur = (d.recurring || []).reduce((t, r) => t + r.total_cents, 0);
    const laborCost = lab ? lab.costCents : 0;
    const summary = [
      [title], [`Job ${d.job.job_number}${d.job.name ? " - " + d.job.name : ""}`], [`Exported ${C.fmtDay(C.todayIso())}`], [],
      ["Feed", "This month", "Note"],
      ["Labor", $(laborCost), lab ? `${C.fmtHours(lab.hoursX100)} hours priced${lab.held.rows ? `; ${C.fmtHours(lab.held.hoursX100)} hours held` : ""}` : "no HH2 on file"],
      ["Rentals (to client)", $(rentTotal), (d.rentals || []).length ? `rent + tax + markup, ${(d.rentals || []).map((s) => `${s.vendor_key} as of ${C.fmtDay(s.as_of)}`).join("; ")}` : "no on-rent report on file"],
      ["Liberty-owned equipment", $(rentLO), "rent only"],
      ["Recurring rentals", $(recur), (d.recurring || []).length ? `${(d.recurring || []).length} charges confirmed from the Job Cost To Date, with markup` : "none confirmed"],
      ["Purchases (material POs)", $(purch), `${(d.purchases || []).length} documents`],
      ["Total", $(laborCost + rentTotal + rentLO + recur + purch), ""],
    ];
    XLSX.utils.book_append_sheet(wb, sheet(summary, { widths: [28, 16, 60], fmt: { 1: money } }), "Summary");

    if (lab) {
      const byCode = {};
      for (const r of d.labor.rows) {
        const k = r.cost_code || "(no cost code)";
        const c = byCode[k] || (byCode[k] = { code: k, name: r.cost_code_name || "", hours: 0, cost: 0, held: 0 });
        c.hours += r.hours_x100; if (r.status === "priced") c.cost += r.cost_cents; else if (r.status !== "excluded") c.held += r.hours_x100;
      }
      const codes = [["Cost code", "Name", "Hours", "Labor cost", "Held hours"]]
        .concat(Object.values(byCode).sort((a, b) => (a.code < b.code ? -1 : 1)).map((c) => [c.code, c.name, h(c.hours), $(c.cost), h(c.held)]));
      codes.push(["Total", "", h(lab.hoursX100), $(lab.costCents), h(lab.held.hoursX100)]);
      XLSX.utils.book_append_sheet(wb, sheet(codes, { widths: [14, 36, 10, 14, 10], fmt: { 2: hours, 3: money, 4: hours } }), "Labor by code");
      const trades = [["Class", "Certified class", "Pay ID", "Hours", "Rate", "Labor cost"]];
      const tk = {};
      for (const r of d.labor.rows) if (r.status === "priced") {
        const k = `${r.certified_class}|${r.pay_type}`;
        const t = tk[k] || (tk[k] = { cclass: r.certified_class, pay: r.pay_type, rate: r.rate_cents, hours: 0, cost: 0 });
        t.hours += r.hours_x100; t.cost += r.cost_cents;
      }
      for (const t of Object.values(tk).sort((a, b) => (a.cclass + a.pay < b.cclass + b.pay ? -1 : 1))) trades.push([classLabel(t.cclass), t.cclass, t.pay, h(t.hours), $(t.rate), $(t.cost)]);
      trades.push(["Total", "", "", h(lab.priced.hoursX100), null, $(lab.costCents)]);
      XLSX.utils.book_append_sheet(wb, sheet(trades, { widths: [24, 12, 12, 10, 12, 14], fmt: { 3: hours, 4: money, 5: money } }), "Labor by class");
      const lines = [["Week ending", "Date", "Employee #", "Certified class", "Rate table", "Cost code", "Pay ID", "Pay type", "Hours", "Rate", "Labor cost", "Status", "Reason"]]
        .concat(d.labor.rows.map((r) => [r.week_ending, r.work_date, r.employee_number, r.certified_class || "", r.rate_table_code || "", r.cost_code, r.pay_type, r.pay_type_name, h(r.hours_x100), $(r.rate_cents), $(r.cost_cents), r.status, r.reason || ""]));
      XLSX.utils.book_append_sheet(wb, sheet(lines, { widths: [12, 12, 12, 12, 11, 12, 11, 11, 8, 10, 12, 16, 50], fmt: { 8: hours, 9: money, 10: money } }), "Labor lines");
    }
    for (const st of d.rentals || []) {
      const rows = [[`${st.vendor_key} on rent as of ${C.fmtDay(st.as_of)}`], [],
        ["Equipment #", "Contract #", "Description", "Qty", "On rent since", "Period", "Rate", "Monthly rent", "Tax", "Markup", "To client", "Liberty-owned"]]
        .concat(st.rows.map((r) => [r.equipment_no, r.contract_no, r.description, r.qty_unknown ? "?" : r.qty, r.on_rent_date || "", r.rate_period || "", $(r.rate_cents), $(r.monthly_rent_cents), $(r.tax_cents), $(r.markup_cents), $(r.total_cents), r.liberty_owned ? "Y" : ""]));
      rows.push(["Total", "", "", null, "", "", null, $(st.total.rent + st.total.liberty_owned), $(st.total.tax), $(st.total.markup), $(st.total.total), st.total.liberty_owned ? $(st.total.liberty_owned) : ""]);
      if (st.offRent.length) {
        rows.push([], ["Off rent since the previous report"], ["Equipment #", "Contract #", "Description", "", "Last seen", "Off rent"]);
        for (const l of st.offRent) rows.push([l.equipment_no, l.contract_no, l.description, null, l.last_seen, l.off_rent_date]);
      }
      XLSX.utils.book_append_sheet(wb, sheet(rows, { widths: [12, 12, 30, 5, 12, 8, 10, 12, 10, 10, 12, 8], fmt: { 6: money, 7: money, 8: money, 9: money, 10: money } }), safeName(`Rentals ${st.vendor_key}`));
    }
    if ((d.recurring || []).length) {
      const rr = [["Vendor", "Line", "Units", "A month", "Tax", "Markup", "Total", "From", "Until", "Liberty-owned"]]
        .concat(d.recurring.map((r) => [r.vendor_name, r.description, r.units, $(r.rent_cents), $(r.tax_cents), $(r.markup_cents), $(r.total_cents), String(r.start_month).slice(0, 7), r.end_month ? String(r.end_month).slice(0, 7) : "open", r.liberty_owned ? "Y" : ""]));
      rr.push(["Total", "", null, $(d.recurring.reduce((t, r) => t + r.rent_cents, 0)), $(d.recurring.reduce((t, r) => t + r.tax_cents, 0)), $(d.recurring.reduce((t, r) => t + r.markup_cents, 0)), $(recur), "", "", ""]);
      XLSX.utils.book_append_sheet(wb, sheet(rr, { widths: [28, 30, 6, 12, 10, 10, 12, 9, 9, 8], fmt: { 3: money, 4: money, 5: money, 6: money } }), "Recurring rentals");
    }
    if (d.site && (d.site.counts.classified || (d.site.dump || []).length || (d.site.pulls || []).length)) {
      const c = d.site.counts, r = c.restrooms;
      const rows = [["Site services", C.fmtMonth(d.month)], [], ["What", "Count", "Detail"],
        ["Restrooms", r.units, d.site.restroomLine || ""], ["Restroom trailers, static units, containers", r.trailers + r.static + r.containers, r.stations ? `${r.stations} stations` : ""],
        ["Sinks", r.sinks, ""], ["Holding tanks", r.holding_tanks, ""], ["Serviced", r.service_per_week ? `${r.service_per_week}x weekly` : "", ""],
        ["Trailers (buildings)", c.trailers.buildings, d.site.trailerLabel || ""], ["Storage containers", c.storage.container_units, Object.entries(c.storage.containers).map(([k, n]) => `${n} x ${k}`).join(", ")],
        ["Roll-offs on the rental reports", c.dumpsters.units, ""], [],
        ["Dumpsters: hauler", "Pulls", "Source", "Ledger lines", "Ledger spend", "Log cost"]]
        .concat((d.site.dump || []).map((x) => [x.vendor_name, x.pulls == null ? "" : x.pulls, x.source, x.ledger_lines, $(x.ledger_cents), $(x.log_cost_cents)]))
        .concat([[], ["Pull log: date", "Hauler", "Size yd", "Pulls", "Ticket", "Tons", "Cost", "Note"]], (d.site.pulls || []).map((p) => [p.pull_date, p.vendor_name, p.container_yd || "", p.pulls, p.ticket_no || "", p.tonnage || "", $(p.cost_cents), p.note || ""]));
      XLSX.utils.book_append_sheet(wb, sheet(rows, { widths: [34, 10, 60, 12, 14, 12, 12, 30], fmt: { 4: money, 5: money, 6: money } }), "Site services");
    }
    const p = [["Vendor", "Document", "Date", "Description", "Cost code", "Bucket", "Amount", "Status"]]
      .concat((d.purchases || []).map((x) => [x.vendor || "", x.doc_number || "", x.doc_date || "", x.description || "", x.cost_code || "", x.bucket || "", $(x.amount_cents), x.status]));
    XLSX.utils.book_append_sheet(wb, sheet(p, { widths: [22, 14, 12, 40, 12, 14, 12, 14], fmt: { 6: money } }), "Purchases");
    return wb;
  }

  /** The client's rental statement for one job and month. */
  function statement(st, job, month) {
    const wb = XLSX.utils.book_new();
    const rows = [[`${job.short_name || job.job_number} - Equipment on rent, ${C.fmtMonth(month)}`], [`As of ${C.fmtDay(st.as_of)}; rent plus ${st.settings.taxable ? st.settings.tax_bp / 100 + "% tax plus " : ""}${st.settings.markup_bp / 100}% markup`], [],
      ["Equipment #", "Description", "Qty", "On rent since", "Monthly rent", "Tax", "Markup", "Total"]]
      .concat(st.rows.map((r) => [r.equipment_no, r.description, r.qty_unknown ? "?" : r.qty, r.on_rent_date || "", $(r.monthly_rent_cents), $(r.tax_cents), $(r.markup_cents), $(r.total_cents)]));
    rows.push(["Total", "", null, "", $(st.total.rent + st.total.liberty_owned), $(st.total.tax), $(st.total.markup), $(st.total.total)]);
    XLSX.utils.book_append_sheet(wb, sheet(rows, { widths: [14, 36, 5, 12, 12, 10, 10, 12], fmt: { 4: money, 5: money, 6: money, 7: money } }), "Statement");
    return wb;
  }

  /** Monthly totals by bucket, the shape GRforecast imports: rows {job_number, month, bucket, cents}. */
  function monthBuckets(rows) {
    const wb = XLSX.utils.book_new();
    const aoa = [["Job", "Month", "Bucket", "Amount"]].concat(rows.map((r) => [r.job_number, r.month, r.bucket, $(r.cents)]));
    XLSX.utils.book_append_sheet(wb, sheet(aoa, { widths: [14, 10, 16, 14], fmt: { 3: money } }), "Month buckets");
    return wb;
  }

  const toBytes = (wb) => new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  function download(wb, fileName) {
    if (typeof document === "undefined") throw new Error("download needs a browser");
    const blob = new Blob([toBytes(wb)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const fileSafe = (s) => C.oneLine(s).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");

  return { jobMonth, statement, monthBuckets, toBytes, download, fileSafe };
}));
