/* test_hh2.js - the HH2 reader against the fixture and its refusals. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, refuses, done, C } = require("./lib.js");
const HH2 = require("../app/hh2.js");
const F = path.join(__dirname, "fixtures/hh2");
const expected = JSON.parse(fs.readFileSync(path.join(F, "expected.json"), "utf8"));
const bytes = (rel) => fs.readFileSync(path.join(F, rel));

const doc = HH2.read(bytes(expected.file), expected.file);

check("row count is conserved, duplicates included", () => eq(doc.totals.rows, expected.rows));
check("hours are conserved to the hundredth", () => eq(doc.totals.hoursX100, expected.hoursX100));
check("exact duplicates are counted and kept", () => {
  eq(doc.totals.duplicates, expected.duplicates);
  eq(doc.rows.length, expected.rows, "rows kept");
});
check("every row has the twelve fields (no child job in the real export)", () => {
  const r = doc.rows[0];
  eq(doc.columns, 12);
  eq(Object.keys(r).sort(), ["child_job", "child_job_name", "cost_code", "cost_code_name", "employee_number", "hours_x100",
    "job_name", "job_number", "pay_type", "pay_type_name", "payroll_group", "payroll_service_id", "row_index", "work_date"]);
  eq(r.employee_number, "FB5001"); eq(r.work_date, "2026-09-01"); eq(r.hours_x100, 800); eq(r.pay_type, "REG"); eq(r.pay_type_name, "Regular");
  eq(r.child_job, ""); eq(r.payroll_group, "MC - CDR1 East DC4 TM (60-225121)");
  ok(doc.rows.some((x) => x.pay_type === "UNION REG" && x.pay_type_name === "REG"), "union codes name REG");
  ok(doc.rows.some((x) => x.employee_number === "TTR-10001"), "a dashed TTR number");
});
check("names come back apart from the rows", () => {
  eq(Object.keys(doc.employees).length, expected.employees);
  eq(doc.employees.FB5001, "Lopez, Maria");
  ok(!("employee_name" in doc.rows[0]), "rows must not carry names");
  eq(doc.nameConflicts, []);
});
check("totals by job match the spec", () => {
  for (const [job, j] of Object.entries(expected.byJob)) { eq(doc.byJob[job].rows, j.rows, job + " rows"); eq(doc.byJob[job].hoursX100, j.hoursX100, job + " hours"); }
});
check("range comes from the file name and the data lies inside it", () => {
  eq(doc.range, expected.range); eq(doc.rangeSource, "name");
  eq(doc.dataRange, { start: "2026-09-01", end: "2026-09-30" });
});
check("negative and zero hours pass through", () => {
  ok(doc.rows.some((r) => r.hours_x100 === -800 && r.pay_type_name === "Vacation"), "the -8 Vacation row");
  ok(doc.rows.some((r) => r.hours_x100 === 0 && r.pay_type_name === "Holiday"), "the 0 Holiday row");
});
check("the fourteen-column export (with ChildJob) reads too, and keeps the child job", () => {
  const d14 = HH2.read(bytes(expected.childFile), expected.childFile);
  eq(d14.columns, 14); eq(d14.totals.rows, expected.rows); eq(d14.totals.hoursX100, expected.hoursX100);
  const r = d14.rows.find((x) => x.child_job);
  eq(r.child_job, "50-60-225121-01"); eq(r.child_job_name, "DC4 TFO"); eq(r.job_number, "50-60-225121");
  eq(doc.rows.filter((x) => x.child_job).length, 0, "the twelve-column file has none");
});
check("row_index is the Excel row", () => { eq(doc.rows[0].row_index, 2); eq(doc.rows[doc.rows.length - 1].row_index, expected.rows + 1); });
check("rangeFromName", () => {
  eq(HH2.rangeFromName("LaborDetails_9_1_2026_to_9_30_2026.xlsx"), { start: "2026-09-01", end: "2026-09-30" });
  eq(HH2.rangeFromName("LaborDetails_12_29_2025_to_1_25_2026 (1).xlsx"), { start: "2025-12-29", end: "2026-01-25" });
  eq(HH2.rangeFromName("something.xlsx"), null);
});
check("a name without the range falls back to the data", () => {
  const d = HH2.read(bytes(expected.file), "export.xlsx");
  eq(d.rangeSource, "data"); eq(d.range, { start: "2026-09-01", end: "2026-09-30" });
});
check("looksLike", () => {
  ok(HH2.looksLike(C.readBook(bytes(expected.file))));
  ok(!HH2.looksLike(C.readBook(bytes("bad/renamed_sheet.xlsx"))));
});
check("refuses: no Labor Details sheet", () => refuses(() => HH2.read(bytes("bad/renamed_sheet.xlsx"), "renamed_sheet.xlsx"), /no "Labor Details" sheet/));
check("refuses: a missing column, naming the first difference", () =>
  refuses(() => HH2.read(bytes("bad/wrong_columns.xlsx"), "wrong_columns.xlsx"), /column 5 .* reads "Job", expected "PayrollServiceId"/));
check("refuses: a row with no Units, naming the row", () =>
  refuses(() => HH2.read(bytes("bad/missing_units.xlsx"), "missing_units.xlsx"), /row 8 has no readable Units/));
check("refuses: the name says September, the rows are October", () =>
  refuses(() => HH2.read(bytes("bad/mismatch/" + expected.file), expected.file), /name says Sep 1, 2026 to Sep 30, 2026 but the rows run Oct 1, 2026/));
check("refuses: not a workbook at all", () => refuses(() => HH2.read(Buffer.from("hello"), "hello.txt")));
done();
