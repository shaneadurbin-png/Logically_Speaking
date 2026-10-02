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

  // ---- the weekly cost workbook's Labor sheet: the labor HISTORY, priced by the old workbook ----
  // Loaded once as the baseline; the weekly HH2 files add to it. A row keeps the
  // cost the workbook gave it (cost_given_cents) and the class it carried then.
  const WCD_SHEET = "Labor", WCD_AUDIT = "Labor Audit";
  const WCD_COLUMNS = ["Week Ending", "Date", "Employee", "Employee #", "Trade", "Class", "Job #", "Job Name", "Cost Code", "Cost Code Name", "Pay Type", "Hours", "Labor Cost", "Labor Cost - Basis"];
  const TRADE_CODE = { laborer: "LAB", carpenter: "CARP", superintendent: "SUP" };
  const LEVEL_CODE = { jm: "J", j: "J", fm: "F", f: "F", gfm: "GF", gf: "GF", app: "A", a: "A", nu: "NU" };
  /** "Laborer" + "FM" -> "#LAB-F"; null when either word is not one the page knows */
  function classOf(trade, level) {
    const t = TRADE_CODE[C.norm(trade)], l = LEVEL_CODE[C.norm(level)];
    if (t === "SUP") return "#SUP";
    return t && l ? `#${t}-${l}` : null;
  }
  const headerIs = (row, want) => { const h = C.headerOf(row || []); return want.every((w, i) => h[i] === w); };
  function looksLikeWeekly(wb) {
    return wb.SheetNames.includes(WCD_SHEET) && headerIs(C.rowsOf(wb.Sheets[WCD_SHEET], 1)[0], WCD_COLUMNS);
  }
  function readWeekly(wb, fileName) {
    const main = C.rowsOf(wb.Sheets[WCD_SHEET]);
    if (!headerIs(main[0], WCD_COLUMNS)) throw new C.UnknownFormat(`${fileName}: the "${WCD_SHEET}" sheet does not carry the weekly cost workbook's columns (${WCD_COLUMNS.join(", ")}).`);
    const sheets = [{ name: WCD_SHEET, rows: main, start: 1, offset: 0, given: true, col: (k) => WCD_COLUMNS.indexOf(k) }];
    if (wb.SheetNames.includes(WCD_AUDIT)) {
      const a = C.rowsOf(wb.Sheets[WCD_AUDIT]);
      const hi = a.findIndex((r, i) => i < 8 && C.headerOf(r || [])[0] === "Source Row" && headerIs((r || []).slice(1), WCD_COLUMNS));
      if (hi < 0) throw new C.UnknownFormat(`${fileName}: the "${WCD_AUDIT}" sheet has no header row of Source Row, ${WCD_COLUMNS.join(", ")} in its first 8 rows.`);
      sheets.push({ name: WCD_AUDIT, rows: a, start: hi + 1, offset: 1, given: false, col: (k) => WCD_COLUMNS.indexOf(k) + 1 });
    }
    const rows = [], employees = {}, nameConflicts = [], seen = new Map(), byJob = {}, classes = {};
    let hoursX100 = 0, blank = 0, duplicates = 0, minDate = null, maxDate = null, costGiven = 0, rowsGiven = 0, auditRows = 0, noClass = 0;
    for (const sh of sheets) for (let i = sh.start; i < sh.rows.length; i++) {
      const r = sh.rows[i];
      if (C.isBlankRow(r)) { blank++; continue; }
      const excelRow = i + 1, where = `${fileName}: "${sh.name}" row ${excelRow}`;
      const get = (k) => r[sh.col(k)];
      const employee_number = C.str(get("Employee #"));
      if (!employee_number) throw new C.UnknownFormat(`${where} has no Employee #.`);
      const work_date = C.parseDate(get("Date"));
      if (!work_date || Number.isNaN(work_date)) throw new C.UnknownFormat(`${where}: Date "${C.str(get("Date"))}" is not a date.`);
      const week_ending = C.parseDate(get("Week Ending"));
      if (week_ending && !Number.isNaN(week_ending) && week_ending !== C.sundayOnOrAfter(work_date)) {
        throw new C.UnknownFormat(`${where}: Week Ending ${C.fmtDay(week_ending)} is not the Sunday on or after ${C.fmtDay(work_date)}; the row is not what the workbook says it is.`);
      }
      const job_number = C.str(get("Job #"));
      if (!job_number) throw new C.UnknownFormat(`${where} has no Job #.`);
      const pay = C.str(get("Pay Type"));
      if (!pay) throw new C.UnknownFormat(`${where} has no Pay Type.`);
      const h = C.toNumber(get("Hours"));
      if (h == null || Number.isNaN(h)) throw new C.UnknownFormat(`${where}: Hours "${C.str(get("Hours"))}" is not a number.`);
      const units = Math.round(h * 100);
      const cost = sh.given ? C.cents(get("Labor Cost")) : null;
      if (Number.isNaN(cost)) throw new C.UnknownFormat(`${where}: Labor Cost "${C.str(get("Labor Cost"))}" is not money.`);
      const name = C.oneLine(get("Employee"));
      if (name) {
        if (!(employee_number in employees)) employees[employee_number] = name;
        else if (employees[employee_number] !== name && !nameConflicts.some((c) => c.employee_number === employee_number && c.name === name)) nameConflicts.push({ employee_number, name, first: employees[employee_number] });
      }
      const class_given = classOf(get("Trade"), get("Class"));
      if (class_given) classes[class_given] = (classes[class_given] || 0) + 1; else noClass++;
      const row = { row_index: sh.offset * 1000000 + excelRow, employee_number, work_date, payroll_group: "", payroll_service_id: "",
        job_number, job_name: C.oneLine(get("Job Name")), child_job: "", child_job_name: "",
        cost_code: C.str(get("Cost Code")), cost_code_name: C.oneLine(get("Cost Code Name")), pay_type: pay, pay_type_name: pay, hours_x100: units,
        cost_given_cents: cost == null ? null : cost, class_given, source_layout: "weeklycostdata" };
      const key = [employee_number, work_date, job_number, row.cost_code, pay, units, cost].join("\u0001");
      if (seen.has(key)) duplicates++; else seen.set(key, excelRow);
      rows.push(row);
      hoursX100 += units;
      if (cost != null) { costGiven += cost; rowsGiven++; }
      if (!sh.given) auditRows++;
      if (!minDate || work_date < minDate) minDate = work_date;
      if (!maxDate || work_date > maxDate) maxDate = work_date;
      const j = byJob[job_number] || (byJob[job_number] = { job_number, job_name: row.job_name, rows: 0, hoursX100: 0 });
      j.rows++; j.hoursX100 += units;
    }
    if (!rows.length) throw new C.UnknownFormat(`${fileName}: "${WCD_SHEET}" has a header and no rows.`);
    return {
      kind: "hh2_labor", layout: "weeklycostdata", fileName,
      range: { start: minDate, end: maxDate }, rangeSource: "data", dataRange: { start: minDate, end: maxDate },
      rows, employees, nameConflicts, columns: WCD_COLUMNS.length,
      totals: { rows: rows.length, hoursX100, blank, duplicates, employees: Object.keys(employees).length, costGivenCents: costGiven, rowsGiven, auditRows, classes, noClass },
      byJob,
    };
  }

  /** Does this workbook carry the HH2 sheet and header, or the weekly cost workbook's Labor sheet? (for sniffing) */
  function looksLike(wb) {
    if (looksLikeWeekly(wb)) return true;
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
    if (!wb.SheetNames.includes(SHEET) && looksLikeWeekly(wb)) return readWeekly(wb, fileName);
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
      kind: "hh2_labor", layout: "hh2", fileName,
      range: named || { start: minDate, end: maxDate }, rangeSource: named ? "name" : "data",
      dataRange: { start: minDate, end: maxDate },
      rows, employees, nameConflicts,
      columns: columns.length,
      totals: { rows: rows.length, hoursX100, blank, duplicates, employees: Object.keys(employees).length },
      byJob,
    };
  }

  const read = (data, fileName) => readWorkbook(C.readBook(data), fileName);

  return { SHEET, COLUMNS, COLUMNS_CHILD, NAME_RE, WCD_SHEET, WCD_COLUMNS, classOf, rangeFromName, looksLike, looksLikeWeekly, readWorkbook, read };
}));
