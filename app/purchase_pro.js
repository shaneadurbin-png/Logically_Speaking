/* purchase_pro.js - Purchase Pro's PO table (Tbl_PO1) exported to Excel: the
   purchases feed, read as a SNAPSHOT of every PO.

   Columns (confirmed against Shane's Tbl_PO1 sample of 2026-09-28; the full
   export carries a few more, which are kept in raw):
     OrderID, Cor, Purchase_Order, OrdDate, OrdType, Supplier, Supplier_Name,
     Supplier_Contact, Supplier_QuoteOrder, Job, Brief_Description_of_Work,
     Requested_Delivery_Date, Comments, Actual_Delivery_Date, Cancelled,
     Exported, SageTotalCommitted

   What counts, the way WeeklyCostData's Committed and OffFeedRental sheets
   counted it: a Material or Rental order that is not cancelled, at Sage's
   committed total. Quotes (OrdType *_Quote) and cancelled orders are listed
   and left out. An order with no committed total yet is listed, counted as
   pending, and never guessed. A description that says NONBILLABLE lands in
   the Non-Billables bucket. A PO with no Job (quotes often have none) is
   never a refusal: a quote or a cancelled order is left out as it would be
   anyway; a counted order records with no job and waits for a decision,
   the same way an order on a job Settings does not know waits.

   Tbl_PO has no primary key. The same PO NUMBER can sit on two different
   orders (32 numbers do, on the export of 2026-10-02: "26.01" on five), and
   the same OrderID can sit on a quote and the order it became (7 do), and
   one export even carried the same OrderID and number twice with different
   details. Nothing here refuses: every row is kept, and every order whose
   number is on more than one row is marked and waits for a decision until
   Purchase Pro gives each its own number. A decision is about one order: it
   carries across exports by number AND OrderID. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.PurchasePro = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const REQUIRED = ["Purchase_Order", "OrdDate", "OrdType", "Supplier_Name", "Job", "SageTotalCommitted"];
  const OPTIONAL = ["OrderID", "Cor", "Company", "Supplier", "Supplier_Contact", "Supplier_QuoteOrder", "Brief_Description_of_Work", "Requested_Delivery_Date", "Comments", "Actual_Delivery_Date", "Cancelled", "Exported", "ReadytoExport", "Delivery_Status"];
  const BUCKET_OF = { Material: "MATERIALS", Rental: "EQUIPMENT" };
  const isTrue = (v) => v === true || /^(true|yes|y|1|-1|x)$/i.test(C.str(v));

  function headerIndex(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = (rows[i] || []).map((v) => C.norm(v));
      if (REQUIRED.every((h) => cells.includes(C.norm(h)))) return i;
    }
    return -1;
  }
  const looksLike = (wb) => headerIndex(C.rowsOf(wb.Sheets[wb.SheetNames[0]], 10)) >= 0;

  function readWorkbook(wb, fileName = "this file", opts = {}) {
    const rows = C.rowsOf(wb.Sheets[wb.SheetNames[0]]);
    const hi = headerIndex(rows);
    if (hi < 0) throw new C.UnknownFormat(`${fileName} is not a Purchase Pro PO export (no row with ${REQUIRED.join(", ")}).`);
    const col = {};
    (rows[hi] || []).forEach((v, j) => { const k = C.norm(v); if (k && !(k in col)) col[k] = j; });
    const at = (r, name) => { const j = col[C.norm(name)]; return j == null ? null : r[j]; };
    const pos = [], seen = new Map();
    let committed = 0, counted = 0, cancelled = 0, quotes = 0, noAmount = 0, blank = 0, noJob = 0, noJobCounted = 0;
    const byType = {}, byJob = {};
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (C.isBlankRow(r)) { blank++; continue; }
      const excelRow = i + 1;
      const po_number = C.str(at(r, "Purchase_Order"));
      if (!po_number) throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no Purchase_Order.`);
      const order_id = C.str(at(r, "OrderID")) || null;
      const key = `${order_id || ""}|${po_number}`;
      seen.set(key, (seen.get(key) || 0) + 1);
      const order_date = C.parseDate(at(r, "OrdDate"));
      if (!order_date || Number.isNaN(order_date)) throw new C.UnknownFormat(`${fileName}: row ${excelRow} (PO ${po_number}): OrdDate "${C.str(at(r, "OrdDate"))}" is not a date.`);
      const typeRaw = C.str(at(r, "OrdType"));
      const quote = /quote/i.test(typeRaw);
      const order_type = /rental/i.test(typeRaw) ? "Rental" : /material/i.test(typeRaw) ? "Material" : typeRaw;
      if (!["Rental", "Material"].includes(order_type)) throw new C.UnknownFormat(`${fileName}: row ${excelRow} (PO ${po_number}): OrdType "${typeRaw}" is not Material, Rental or a quote of either.`);
      const amt = C.cents(at(r, "SageTotalCommitted"));
      if (Number.isNaN(amt)) throw new C.UnknownFormat(`${fileName}: row ${excelRow} (PO ${po_number}): SageTotalCommitted "${C.str(at(r, "SageTotalCommitted"))}" is not money.`);
      const description = C.oneLine(at(r, "Brief_Description_of_Work"));
      const isCancelled = isTrue(at(r, "Cancelled"));
      const po = {
        row_index: excelRow, po_number, order_id, order_date, order_type, quote, cancelled: isCancelled,
        supplier_code: C.str(at(r, "Supplier")) || null, supplier_name: C.oneLine(at(r, "Supplier_Name")),
        job_number: C.str(at(r, "Job")) || null, description,
        bucket: /non-?billable/i.test(description) ? "NON_BILLABLE" : BUCKET_OF[order_type],
        committed_cents: amt,
        raw: { order_id: C.str(at(r, "OrderID")) || null, company: C.str(at(r, "Cor")) || C.str(at(r, "Company")) || null, quote_ref: C.str(at(r, "Supplier_QuoteOrder")) || null,
          requested_delivery: C.parseDate(at(r, "Requested_Delivery_Date")) || null, actual_delivery: C.parseDate(at(r, "Actual_Delivery_Date")) || null,
          exported: at(r, "Exported") == null ? null : isTrue(at(r, "Exported")), comments: C.oneLine(at(r, "Comments")) || null },
      };
      for (const k of Object.keys(po.raw)) if (po.raw[k] == null || Number.isNaN(po.raw[k])) delete po.raw[k];
      if (!po.job_number) noJob++;
      pos.push(po);
      if (isCancelled) { cancelled++; continue; }
      if (quote) { quotes++; continue; }
      if (amt == null) { noAmount++; continue; }
      counted++; committed += amt;
      byType[order_type] = (byType[order_type] || 0) + amt;
      if (!po.job_number) { noJobCounted++; continue; }
      const j = byJob[po.job_number] || (byJob[po.job_number] = { job_number: po.job_number, pos: 0, committed_cents: 0 });
      j.pos++; j.committed_cents += amt;
    }
    if (!pos.length) throw new C.UnknownFormat(`${fileName} has the header of a Purchase Pro export and no POs.`);
    // a number on more than one order: each order kept, each marked, none counted until decided
    const byNumber = new Map();
    for (const p of pos) byNumber.set(p.po_number, (byNumber.get(p.po_number) || 0) + 1);
    const sharedNumbers = [];
    for (const [n, c] of byNumber) if (c > 1) sharedNumbers.push({ po_number: n, orders: c });
    const repeatedRows = [...seen.entries()].filter(([, c]) => c > 1).map(([k, c]) => ({ order_id: k.split("|")[0] || null, po_number: k.split("|")[1], rows: c }));
    for (const p of pos) p.shared_number = byNumber.get(p.po_number) > 1 ? byNumber.get(p.po_number) : null;
    let as_of = opts.as_of ? C.parseDate(opts.as_of) : null, asOfSource = opts.as_of ? "given" : null;
    if (!as_of) { const m = String(fileName).match(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})|(\d{1,2})[-_.](\d{1,2})[-_.](\d{2,4})/); if (m) { const iso = m[1] ? `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}` : `${m[6].length === 2 ? "20" + m[6] : m[6]}-${String(+m[4]).padStart(2, "0")}-${String(+m[5]).padStart(2, "0")}`; const d = C.parseDate(iso); if (d && !Number.isNaN(d)) { as_of = d; asOfSource = "name"; } } }
    if (!as_of) { as_of = pos.map((p) => p.order_date).sort().pop(); asOfSource = "latest order"; }
    return {
      kind: "purchase_orders", fileName, as_of, asOfSource, pos,
      totals: { pos: pos.length, counted, committed_cents: committed, cancelled, quotes, noAmount, noJob, noJobCounted, blank, byType, byJob,
        sharedNumbers: sharedNumbers.sort((a, b) => b.orders - a.orders || (a.po_number < b.po_number ? -1 : 1)), sharedNumberPos: sharedNumbers.reduce((t, s) => t + s.orders, 0), repeatedRows,
        jobs: Object.keys(byJob).sort(), latestOrder: pos.map((p) => p.order_date).sort().pop() },
    };
  }
  const read = (data, fileName, opts) => readWorkbook(C.readBook(data), fileName, opts);
  return { REQUIRED, OPTIONAL, looksLike, readWorkbook, read };
}));
