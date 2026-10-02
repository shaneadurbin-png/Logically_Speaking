/* jctd.js - Sage's Job Cost To Date export: every cost transaction on a job
   to the day it was pulled. Payroll (PR cost), vendor invoices (AP cost),
   journal entries (JC cost) and Liberty's own equipment charged to the job
   (IV cost), 27 columns, one sheet.

   The reader keeps every row and refuses anything that is not this export,
   naming the first column that is wrong. A payroll row's Description is the
   employee's name: it goes to doc.employees, keyed by employee number, and
   the row keeps no name. The latest export per job stands for all of its
   history (it is cumulative), so the as-of matters: it comes from the file
   name ("CDR_DC4_9-29-26.xlsx"), else from the latest Date Stamp. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.JCTD = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const HEADER = ["Job", "Job Description", "Extra", "Cost Code", "Description", "Cat", "Transaction Type", "Period End Date", "Transaction Date", "Accounting Date",
    "Date Stamp", "Units", "Unit Cost", "Amount", "Pay ID", "PR Tax ID", "Fringe ID", "Employee", "JC_EE_UNION_ID", "JC_EE_UNION_LOC", "JC_EE_UNION_CLASS", "Batch",
    "Vendor", "Name", "Invoice", "Standard Item", "Description"];
  const TYPES = ["PR cost", "AP cost", "JC cost", "IV cost"];

  const headerOk = (row) => row && HEADER.every((h, i) => C.norm(row[i]) === C.norm(h));
  const looksLike = (wb) => { const first = C.rowsOf(wb.Sheets[wb.SheetNames[0]], 2); return headerOk(first[0]) && first[0].length >= HEADER.length && first[0].length <= HEADER.length + 2; };

  /** "CDR_DC4_9-29-26.xlsx" -> 2026-09-29; also 9-29-2026, 9.29.26, 2026-09-29 */
  function asOfFromName(name) {
    const base = String(name || "").split("/").pop();
    let m = base.match(/(?<![\d])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])/);
    if (m) return C.parseDate(`${m[1]}-${m[2]}-${m[3]}`) || null;
    m = base.match(/(?<![\d])(\d{1,2})([-.])(\d{1,2})\2(\d{4}|\d{2})(?![\d])/);
    if (m) { const d = C.parseDate(`${m[1]}/${m[3]}/${m[4]}`); return typeof d === "string" ? d : null; }
    return null;
  }
  /** Sage writes "9-25-2025" in Date Stamp and "2025-09-15" in the other date columns */
  function day(v) {
    const s = C.str(v);
    if (!s) return null;
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    const d = C.parseDate(m ? `${m[1]}/${m[2]}/${m[3]}` : s);
    return typeof d === "string" ? d : NaN;
  }

  function readWorkbook(wb, fileName = "this file", opts = {}) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = C.rowsOf(ws);
    const head = rows[0] || [];
    for (let i = 0; i < HEADER.length; i++) {
      if (C.norm(head[i]) !== C.norm(HEADER[i])) {
        throw new C.UnknownFormat(`${fileName}: column ${i + 1} of "${wb.SheetNames[0]}" reads "${C.str(head[i])}", expected "${HEADER[i]}". ` +
          `Sage's Job Cost To Date export has exactly these columns: ${HEADER.join(", ")}.`);
      }
    }
    const out = [], employees = {}, jobs = {}, byType = {}, byCat = {};
    let amount = 0, negatives = 0, blank = 0, first = null, last = null, stamp = null;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (C.isBlankRow(r)) { blank++; continue; }
      const excelRow = i + 1;
      const job_number = C.str(r[0]), trans_type = C.str(r[6]);
      if (!job_number) throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no Job.`);
      if (!TYPES.includes(trans_type)) throw new C.UnknownFormat(`${fileName}: row ${excelRow}: Transaction Type "${trans_type}" is not one of ${TYPES.join(", ")}.`);
      const trans_date = day(r[8]);
      if (!trans_date || Number.isNaN(trans_date)) throw new C.UnknownFormat(`${fileName}: row ${excelRow}: Transaction Date "${C.str(r[8])}" is not a date.`);
      const amt = r[13];
      if (amt == null || amt === "" || Number.isNaN(C.toNumber(amt))) throw new C.UnknownFormat(`${fileName}: row ${excelRow}: Amount "${C.str(amt)}" is not a number.`);
      const amount_cents = C.cents(amt);
      const employee_number = C.str(r[17]) || null;
      let description = C.str(r[26]);
      if (trans_type === "PR cost" && employee_number) { if (description && !employees[employee_number]) employees[employee_number] = description; description = ""; }
      const line = {
        row_index: excelRow, job_number, cost_code: C.str(r[3]), cost_code_name: C.str(r[4]), cat: C.str(r[5]), trans_type,
        period_end: day(r[7]) || null, trans_date, acct_date: day(r[9]) || null, date_stamp: day(r[10]) || null,
        units: r[11] == null || r[11] === "" ? null : C.toNumber(r[11]), unit_cost_cents: r[12] == null || r[12] === "" ? null : C.cents(r[12]), amount_cents,
        pay_id: C.str(r[14]) || null, employee_number, batch: C.str(r[21]) || null, vendor_code: C.str(r[22]) || null, vendor_name: C.str(r[23]) || null,
        invoice: C.str(r[24]) || null, item: C.str(r[25]) || null, description,
      };
      for (const k of ["period_end", "acct_date", "date_stamp"]) if (Number.isNaN(line[k])) line[k] = null;
      out.push(line);
      amount += amount_cents; if (amount_cents < 0) negatives++;
      jobs[job_number] = (jobs[job_number] || 0) + 1;
      const t = byType[trans_type] || (byType[trans_type] = { rows: 0, amount_cents: 0 }); t.rows++; t.amount_cents += amount_cents;
      byCat[line.cat] = (byCat[line.cat] || 0) + amount_cents;
      if (!first || trans_date < first) first = trans_date; if (!last || trans_date > last) last = trans_date;
      if (line.date_stamp && (!stamp || line.date_stamp > stamp)) stamp = line.date_stamp;
    }
    if (!out.length) throw new C.UnknownFormat(`${fileName} has the Job Cost To Date columns and no rows.`);
    let as_of = opts.as_of || null, asOfSource = as_of ? "given" : null;
    if (!as_of) { as_of = asOfFromName(fileName); asOfSource = as_of ? "name" : null; }
    if (!as_of) { as_of = stamp || last; asOfSource = stamp ? "stamp" : "data"; }
    const jobList = Object.keys(jobs).sort();
    return { kind: "jctd", fileName, job_number: jobList[0], jobs: jobList, range: { start: first, end: last }, as_of, asOfSource, rows: out, employees,
      totals: { rows: out.length, amount_cents: amount, byType, byCat, negatives, blank, employees: Object.keys(employees).length } };
  }
  const read = (data, fileName, opts) => readWorkbook(C.readBook(data), fileName, opts);

  return { HEADER, TYPES, looksLike, read, readWorkbook, asOfFromName };
}));
