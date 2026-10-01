/* test_export_xlsx.js - the workbooks the page hands out add up to what the page shows. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, done } = require("./lib.js");
const XLSX = require("../app/vendor/xlsx.full.min.js");
const HH2 = require("../app/hh2.js"), L = require("../app/labor_model.js"), OnRent = require("../app/onrent.js"), R = require("../app/rentals_model.js");
const E = require("../app/export_xlsx.js");
const F = path.join(__dirname, "fixtures");
const expected = JSON.parse(fs.readFileSync(path.join(F, "hh2/expected.json"), "utf8"));
const ratesJson = JSON.parse(fs.readFileSync(path.join(F, "rates/iowa_fy27.json"), "utf8"));
const employees = JSON.parse(fs.readFileSync(path.join(F, "rates/employees.json"), "utf8"));
const X = JSON.parse(fs.readFileSync(path.join(F, "onrent/expected.json"), "utf8"));
const rates = [];
for (const table of Object.values(ratesJson.tables)) for (const r of ratesJson.table) if (!(r.except_tables || []).includes(table)) rates.push(Object.assign({ rate_table_code: table, effective_from: ratesJson.effective_from, effective_to: ratesJson.effective_to }, r));
const jobs = Object.entries(ratesJson.tables).map(([job_number, rate_table_code]) => ({ job_number, rate_table_code }));

const doc = HH2.read(fs.readFileSync(path.join(F, "hh2", expected.file)), expected.file);
const DC4 = "50-60-225121";
const rows = L.price(doc.rows.filter((r) => r.job_number === DC4), { rates, employees, policy: {}, jobs });
const summary = L.summarize(rows);
const wk2 = OnRent.read(fs.readFileSync(path.join(F, "onrent", X.wk2.file)), X.wk2.file);
const st = R.statement(wk2, {}, X.jobMap, DC4, []);
const purchases = [{ vendor: "Colony Hardware", doc_number: "INV-1", doc_date: "2026-09-12", description: "Anchors", cost_code: "01-02-0001", bucket: "MATERIALS", amount_cents: 12345, status: "confirmed" },
  { vendor: "Uline", doc_number: "ORD-2", doc_date: "2026-09-15", description: "Tape", cost_code: "01-20-0001", bucket: "MATERIALS", amount_cents: 999, status: "excluded" }];
const wb = E.jobMonth({ job: { job_number: DC4, short_name: "DC4", name: "CDR1 East DC4" }, month: "2026-09", labor: { summary, rows }, rentals: [st], purchases });
const bytes = E.toBytes(wb);
const back = XLSX.read(bytes, { type: "array" });
const aoa = (name) => XLSX.utils.sheet_to_json(back.Sheets[name], { header: 1, raw: true, defval: null });

check("the workbook round-trips with the expected sheets", () => {
  eq(back.SheetNames, ["Summary", "Labor by code", "Labor by class", "Labor lines", "Rentals sunbelt", "Purchases"]);
  ok(bytes.length > 2000);
});
check("Summary: labor, rentals and purchases in dollars, and the total is their sum", () => {
  const s = aoa("Summary");
  eq(s[0][0], "DC4 - Sep 2026");
  const row = (label) => s.find((r) => r[0] === label);
  eq(row("Labor")[1], summary.costCents / 100); eq(row("Rentals (to client)")[1], st.total.total / 100);
  eq(row("Purchases")[1], 123.45, "excluded purchase left out");
  eq(row("Total")[1], (summary.costCents + st.total.total + 12345) / 100);
});
check("Labor lines: one row per HH2 row, employee number only, never a name", () => {
  const l = aoa("Labor lines");
  eq(l.length - 1, rows.length);
  eq(l[0], ["Week ending", "Date", "Employee #", "Certified class", "Rate table", "Cost code", "Pay ID", "Pay type", "Hours", "Rate", "Labor cost", "Status", "Reason"]);
  ok(!JSON.stringify(l).includes("Lopez"), "no names");
  const held = l.slice(1).filter((r) => String(r[11]).startsWith("held"));
  ok(held.every((r) => r[10] == null), "held rows carry no cost");
  const c = aoa("Labor by class"); const gf = c.find((r) => r[1] === "#LAB-GF" && r[2] === "REG"); eq(gf[0], "Laborer General Foreman"); eq(gf[4], 108.25);
});
check("Labor by code totals tie to the summary", () => {
  const c = aoa("Labor by code"), tot = c[c.length - 1];
  eq(tot[0], "Total"); eq(tot[2], summary.hoursX100 / 100); eq(tot[3], summary.costCents / 100);
  const sumCost = c.slice(1, -1).reduce((t, r) => t + (r[3] || 0), 0);
  ok(Math.abs(sumCost - summary.costCents / 100) < 0.005, "code rows add to the total");
});
check("Rentals sheet: rows, totals with tax and markup", () => {
  const r = aoa("Rentals sunbelt");
  const tot = r.find((x) => x[0] === "Total");
  eq(tot[7], 4900); eq(tot[8], 343); eq(tot[9], 524.3); eq(tot[10], 5767.3);
  eq(r.filter((x) => x[0] && /^\d{4}$/.test(String(x[0]))).length, 3);
});
check("the statement workbook stands alone", () => {
  const s = XLSX.read(E.toBytes(E.statement(st, { job_number: DC4, short_name: "DC4" }, "2026-09")), { type: "array" });
  const a = XLSX.utils.sheet_to_json(s.Sheets.Statement, { header: 1, raw: true, defval: null });
  eq(a[0][0], "DC4 - Equipment on rent, Sep 2026"); ok(/7% tax plus 10% markup/.test(a[1][0]));
  eq(a[a.length - 1].slice(4), [4900, 343, 524.3, 5767.3]);
});
check("month buckets: the GRforecast import shape", () => {
  const s = XLSX.read(E.toBytes(E.monthBuckets([{ job_number: DC4, month: "2026-09", bucket: "LABOR", cents: 123456 }, { job_number: DC4, month: "2026-09", bucket: "EQUIPMENT", cents: 576730 }])), { type: "array" });
  eq(XLSX.utils.sheet_to_json(s.Sheets["Month buckets"], { header: 1, raw: true }), [["Job", "Month", "Bucket", "Amount"], [DC4, "2026-09", "LABOR", 1234.56], [DC4, "2026-09", "EQUIPMENT", 5767.3]]);
});
check("fileSafe strips what a file name cannot hold", () => eq(E.fileSafe('DC4: Sep/2026 "cost"'), "DC4- Sep-2026 -cost-"));
done();
