/* test_sage_rates.js - the Sage rate table export: tables, keys, escalations, catch-alls. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, refuses, done } = require("./lib.js");
const Sage = require("../app/sage_rates.js");
const F = path.join(__dirname, "fixtures/rates");
const X = JSON.parse(fs.readFileSync(path.join(F, "sage_expected.json"), "utf8"));
const doc = Sage.read(fs.readFileSync(path.join(F, X.file)), X.file);
const dc4 = doc.tables.find((t) => t.code === "#225121");

check("tables, rates, catch-alls left out and counted", () => {
  eq(doc.kind, "sage_rates"); eq(doc.totals.tables, X.tables); eq(doc.totals.rates, X.rates); eq(doc.totals.skipped, X.skipped);
  eq(doc.tables.map((t) => t.code), X.codes);
});
check("a table's description, classes and effective dates", () => {
  eq(dc4.description, "CDR1 East DC4"); eq(dc4.classes, X.dc4.classes); eq(dc4.effectiveDates, X.dc4.effectiveDates); eq(dc4.rates.length, X.dc4.rates); eq(dc4.latest, "2026-06-01");
});
check("each key's rates run until the next effective date; the last is open", () => {
  const a = dc4.rates.find((r) => r.certified_class === "#LAB-J" && r.pay_id === "UNION REG" && r.effective_from === X.labJReg2025.from);
  eq({ from: a.effective_from, to: a.effective_to, cents: a.rate_cents }, X.labJReg2025);
  const b = dc4.rates.find((r) => r.certified_class === "#LAB-J" && r.pay_id === "UNION REG" && r.effective_from === X.labJReg2026.from);
  eq({ from: b.effective_from, to: b.effective_to, cents: b.rate_cents }, X.labJReg2026);
});
check("padded Sage text is trimmed; classes and pay IDs upper-cased", () => {
  ok(dc4.rates.every((r) => r.certified_class === r.certified_class.trim() && r.pay_id === r.pay_id.trim()));
  eq(doc.tables[1].rates.map((r) => r.pay_id), ["UNION D/T", "UNION O/T", "UNION REG"]);
});
check("Sage's M-DD-YYYY dates read", () => { eq(Sage.effectiveDate(" 6-01-2025   "), "2025-06-01"); eq(Sage.effectiveDate("1-01-2027"), "2027-01-01"); eq(Sage.effectiveDate("2026-06-01"), "2026-06-01"); });
check("refuses a workbook without the Sage header", () => refuses(() => Sage.read(fs.readFileSync(path.join(__dirname, "fixtures/onrent/sunbelt_2026-09-19.csv")), "x.csv"), /not a Sage rate table export/));
check("refuses the same key set twice from one date", () => {
  const XLSX = require("../app/vendor/xlsx.full.min.js");
  const wb = XLSX.read(fs.readFileSync(path.join(F, X.file)), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  rows.push(rows[1].slice());
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(rows), "S");
  refuses(() => Sage.read(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }), "dup.xlsx"), /both set #LAB-J UNION REG in #225121/);
});
done();
