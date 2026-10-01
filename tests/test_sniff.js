/* test_sniff.js - a file's kind comes from its contents. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, refuses, done } = require("./lib.js");
const S = require("../app/sniff.js");
const F = path.join(__dirname, "fixtures");
const b = (rel) => fs.readFileSync(path.join(F, rel));

check("family from the name", () => {
  eq(S.familyOf("x/LaborDetails_9_1_2026_to_9_30_2026.xlsx"), "workbook"); eq(S.familyOf("a.CSV"), "workbook"); eq(S.familyOf("req.pdf"), "pdf");
  eq(S.familyOf("drop.zip"), "zip"); eq(S.familyOf("~$open.xlsx"), "system"); eq(S.familyOf("__MACOSX/._a.xlsx"), "system"); eq(S.familyOf("notes.txt"), "other");
});
check("HH2 export sniffs as hh2_labor", () => eq(S.sniff(b("hh2/LaborDetails_9_1_2026_to_9_30_2026.xlsx"), "LaborDetails_9_1_2026_to_9_30_2026.xlsx").kind, "hh2_labor"));
check("an HH2 file with the wrong columns is still HH2 (the reader says what is wrong)", () => eq(S.sniff(b("hh2/bad/wrong_columns.xlsx"), "w.xlsx").kind, "hh2_labor"));
check("on-rent CSV and xlsx sniff as onrent with the layout", () => {
  const r = S.sniff(b("onrent/sunbelt_2026-09-19.csv"), "sunbelt_2026-09-19.csv"); eq(r.kind, "onrent"); eq(r.layout, "generic");
  eq(S.sniff(b("onrent/united_rentals_report.xlsx"), "united_rentals_report.xlsx").kind, "onrent");
});
check("a Sage rate table export sniffs as sage_rates", () => eq(S.sniff(b("rates/Sage_Rate_Tables_2026.xlsx"), "Sage_Rate_Tables_2026.xlsx").kind, "sage_rates"));
check("a workbook of no known kind is refused, saying what was looked for", () =>
  refuses(() => S.sniff(b("hh2/bad/renamed_sheet.xlsx"), "renamed_sheet.xlsx"), /not HH2's Labor Detail export .* not a Sage rate table export, not a Purchase Pro PO export, not a Projects register, and not an on-rent report .* Its sheets: Sheet1/));
check("PDFs and other files are refused with the reason", () => {
  refuses(() => S.sniff(Buffer.from("%PDF-1.4"), "req.pdf"), /next release/);
  refuses(() => S.sniff(Buffer.from("hi"), "notes.txt"), /not a workbook/);
});
check("zips and system files are passed through as kinds", () => { eq(S.sniff(Buffer.alloc(0), "a.zip").kind, "zip"); eq(S.sniff(Buffer.alloc(0), "Thumbs.db").kind, "system"); });
done();
