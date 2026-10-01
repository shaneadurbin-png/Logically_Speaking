/* hh2.js - the HH2 "Labor Detail" export, read exactly.

   The export HH2 produces (RemotePayroll > Labor Detail > Excel File) is one
   sheet, "Labor Details", with a header in row 1 and these twelve columns
   in this order (confirmed against the real 8/24-8/30/2026 export):

     EmployeeNumber, EmployeeName, Date, PayrollGroup, PayrollServiceId,
     Job, JobName, CostCode, CostCodeName, PayType, PayTypeName, Units
                                                      (Units = hours)
   An export run with child jobs carries two more, ChildJob and ChildJobName,
   right after JobName. Both forms read; anything else is refused.

   Its name says the range it was pulled for:
     LaborDetails_9_1_2026_to_9_30_2026.xlsx

   THREE RULES, each learned the hard way in the labor skills:
     1. Never dedupe. HH2 writes real repeated rows (split entries); one pull
        carried 43 exact duplicates that were all paid hours. The reader
        counts them and keeps them.
     2. Conservation. What goes in is what comes out: row count and the sum
        of Units are returned so the database can recount after the write
        and refuse a mismatch.
     3. A layout that is not this one is refused with the first difference
        named - never read around.

   Names stay apart from rows: `employees` maps number -> name so the page can
   keep names where only editors see them. Rows carry the number only. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.HH2 = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const SHEET = "Labor Details";
  const COLUMNS = ["EmployeeNumber", "EmployeeName", "Date", "PayrollGroup", "PayrollServiceId",
    "Job", "JobName", "CostCode", "CostCodeName", "PayType", "PayTypeName", "Units"];
  const COLUMNS_CHILD = ["EmployeeNumber", "EmployeeName", "Date", "PayrollGroup", "PayrollServiceId",
    "Job", "JobName", "ChildJob", "ChildJobName", "CostCode", "CostCodeName", "PayType", "PayTypeName", "Units"];
  const NAME_RE = /LaborDetails?_(\d{1,2})_(\d{1,2})_(\d{4})_to_(\d{1,2})_(\d{1,2})_(\d{4})/i;
  const pad2 = (n) => String(n).padStart(2, "0");

  /** {start, end} from the file's name, or null when the name is not HH2's. */
  function rangeFromName(fileName) {
    const m = String(fileName || "").match(NAME_RE);
    if (!m) return null;
    const a = C.parseDate(`${m[3]}-${pad2(+m[1])}-${pad2(+m[2])}`);
    const b = C.parseDate(`${m[6]}-${pad2(+m[4])}-${pad2(+m[5])}`);
    if (!a || !b || Number.isNaN(a) || Number.isNaN(b)) return null;
    return { start: a, end: b };
  }

  /** Does this workbook carry the HH2 sheet and header? (for sniffing) */
  function looksLike(wb) {
    if (!wb.SheetNames.includes(SHEET)) return false;
    const h = C.headerOf(C.rowsOf(wb.Sheets[SHEET], 1)[0]);
    return h.length >= 3 && h[0] === COLUMNS[0] && h[1] === COLUMNS[1] && h[2] === COLUMNS[2];
  }

  /** Which column list the header is, or a refusal naming the first difference. */
  function checkHeader(header, fileName) {
    const want = header[7] === "ChildJob" ? COLUMNS_CHILD : COLUMNS;
    for (let i = 0; i < want.length; i++) {
      if (header[i] !== want[i]) {
        throw new C.UnknownFormat(`${fileName}: column ${i + 1} of "${SHEET}" reads "${header[i] || ""}", ` +
          `expected "${want[i]}". HH2's Labor Detail export has exactly these columns: ${want.join(", ")}.`);
      }
    }
    if (header.length > want.length) {
      throw new C.UnknownFormat(`${fileName}: "${SHEET}" has ${header.length} columns; HH2's Labor Detail export ` +
        `has ${want.length}. The extra one is "${header[want.length]}".`);
    }
    return want;
  }

  function readWorkbook(wb, fileName = "this file") {
    if (!wb.SheetNames.includes(SHEET)) {
      throw new C.UnknownFormat(`${fileName} has no "${SHEET}" sheet, so it is not HH2's Labor Detail export ` +
        `(its sheets: ${wb.SheetNames.join(", ")}).`);
    }
    const all = C.rowsOf(wb.Sheets[SHEET]);
    if (!all.length) throw new C.UnknownFormat(`${fileName}: "${SHEET}" is empty.`);
    const columns = checkHeader(C.headerOf(all[0]), fileName);

    const rows = [], employees = {}, nameConflicts = [], seen = new Map();
    let hoursX100 = 0, blank = 0, duplicates = 0, minDate = null, maxDate = null;
    for (let i = 1; i < all.length; i++) {
      const r = all[i];
      if (C.isBlankRow(r)) { blank++; continue; }
      const excelRow = i + 1;
      const get = (k) => { const j = columns.indexOf(k); return j < 0 ? null : r[j]; };
      const employee_number = C.str(get("EmployeeNumber"));
      if (!employee_number) throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no EmployeeNumber.`);
      const work_date = C.parseDate(get("Date"));
      if (!work_date || Number.isNaN(work_date)) {
        throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no readable Date (${C.str(get("Date")) || "blank"}).`);
      }
      const job_number = C.str(get("Job"));
      if (!job_number) throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no Job.`);
      const units = C.hoursX100(get("Units"));
      if (units == null || Number.isNaN(units)) {
        throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no readable Units (${C.str(get("Units")) || "blank"}). ` +
          `Zero hours are written as 0, never left blank.`);
      }
      const pay_type_name = C.str(get("PayTypeName"));
      if (!pay_type_name) throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no PayTypeName; the rate key needs it.`);
      const name = C.oneLine(get("EmployeeName"));
      if (name) {
        if (!(employee_number in employees)) employees[employee_number] = name;
        else if (employees[employee_number] !== name && !nameConflicts.some((c) => c.employee_number === employee_number && c.name === name)) {
          nameConflicts.push({ employee_number, name, first: employees[employee_number] });
        }
      }
      const row = {
        row_index: excelRow, employee_number, work_date,
        payroll_group: C.str(get("PayrollGroup")), payroll_service_id: C.str(get("PayrollServiceId")),
        job_number, job_name: C.oneLine(get("JobName")),
        child_job: C.str(get("ChildJob")), child_job_name: C.oneLine(get("ChildJobName")),
        cost_code: C.str(get("CostCode")), cost_code_name: C.oneLine(get("CostCodeName")),
        pay_type: C.str(get("PayType")), pay_type_name, hours_x100: units,
      };
      const key = [employee_number, work_date, job_number, row.child_job, row.cost_code, row.pay_type, pay_type_name, units].join("\u0001");
      if (seen.has(key)) duplicates++; else seen.set(key, excelRow);
      rows.push(row);
      hoursX100 += units;
      if (!minDate || work_date < minDate) minDate = work_date;
      if (!maxDate || work_date > maxDate) maxDate = work_date;
    }
    if (!rows.length) throw new C.UnknownFormat(`${fileName}: "${SHEET}" has a header and no rows.`);

    const named = rangeFromName(fileName);
    if (named && (minDate < named.start || maxDate > named.end)) {
      throw new C.UnknownFormat(`${fileName}: the name says ${C.fmtDay(named.start)} to ${C.fmtDay(named.end)} ` +
        `but the rows run ${C.fmtDay(minDate)} to ${C.fmtDay(maxDate)}. One of them is the wrong file.`);
    }
    const byJob = {};
    for (const r of rows) {
      const j = byJob[r.job_number] || (byJob[r.job_number] = { job_number: r.job_number, job_name: r.job_name, rows: 0, hoursX100: 0 });
      j.rows++; j.hoursX100 += r.hours_x100;
    }
    return {
      kind: "hh2_labor", fileName,
      range: named || { start: minDate, end: maxDate }, rangeSource: named ? "name" : "data",
      dataRange: { start: minDate, end: maxDate },
      rows, employees, nameConflicts,
      columns: columns.length,
      totals: { rows: rows.length, hoursX100, blank, duplicates, employees: Object.keys(employees).length },
      byJob,
    };
  }

  const read = (data, fileName) => readWorkbook(C.readBook(data), fileName);

  return { SHEET, COLUMNS, COLUMNS_CHILD, NAME_RE, rangeFromName, looksLike, readWorkbook, read };
}));
