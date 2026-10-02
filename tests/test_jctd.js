/* test_jctd.js - Sage's Job Cost To Date export, and the recurring charges found on it. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, checkAsync, eq, ok, refuses, done } = require("./lib.js");
const JCTD = require("../app/jctd.js"), Rec = require("../app/recurring_model.js"), S = require("../app/sniff.js"), V = require("../app/onrent_vendors.js"), Intake = require("../app/intake.js");
const F = path.join(__dirname, "fixtures/jctd");
const X = JSON.parse(fs.readFileSync(path.join(F, "expected.json"), "utf8"));
const bytes = fs.readFileSync(path.join(F, X.file));
const doc = JCTD.read(bytes, X.file);

check("every row kept, to the cent, by transaction type", () => {
  eq(doc.kind, "jctd"); eq(doc.job_number, X.job); eq(doc.jobs, [X.job]); eq(doc.totals.rows, X.rows); eq(doc.totals.amount_cents, X.amount_cents);
  eq(Object.fromEntries(Object.entries(doc.totals.byType).map(([k, v]) => [k, v.rows])), X.byType); eq(doc.totals.negatives, X.negatives); eq(doc.range, X.range);
});
check("as-of from the name, else the latest Date Stamp; dates in both of Sage's spellings", () => {
  eq(doc.as_of, X.as_of); eq(doc.asOfSource, "name");
  const d2 = JCTD.read(bytes, "whatever.xlsx"); eq(d2.asOfSource, "stamp"); eq(d2.as_of, JCTD.asOfFromName("x_" + X.latestStamp + ".xlsx"));
  eq(JCTD.read(bytes, "whatever.xlsx", { as_of: "2026-10-01" }).asOfSource, "given");
  eq(JCTD.asOfFromName("CDR_Site_9-3-26.xlsx"), "2026-09-03"); eq(JCTD.asOfFromName("CDR DC4 JCTD 9-3-26.xlsx"), "2026-09-03"); eq(JCTD.asOfFromName("JCTD.xlsx"), null);
  const pr = doc.rows.find((r) => r.trans_type === "PR cost"); eq(pr.date_stamp, C_addDays(pr.trans_date, 7)); eq(pr.period_end, "2026-09-06");
});
function C_addDays(d, n) { return require("../app/common.js").addDays(d, n); }
check("a payroll row's name goes to employees, never stays on the line", () => {
  eq(doc.employees, X.employees); eq(doc.totals.employees, 2);
  ok(doc.rows.filter((r) => r.trans_type === "PR cost").every((r) => r.description === "" && r.employee_number), "PR rows carry the number, not the name");
  ok(doc.rows.filter((r) => r.trans_type === "AP cost").every((r) => r.description !== undefined), "AP rows keep their line description");
  const ap = doc.rows.find((r) => r.vendor_code === "MOB200"); eq(ap.vendor_name, "Mobile Air & Power Rentals"); eq(ap.amount_cents, 49346394); eq(ap.cat, "EQU"); eq(ap.invoice, "218084");
});
check("refuses a foreign layout, naming the column", () => {
  const XLSX = require("../app/vendor/xlsx.full.min.js");
  const wb = XLSX.read(bytes, { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }); rows[0][6] = "Type";
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  refuses(() => JCTD.read(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }), "x.xlsx"), /column 7 of "Sheet1" reads "Type", expected "Transaction Type"/);
  refuses(() => JCTD.read(fs.readFileSync(path.join(__dirname, "fixtures/purchases/Tbl_PO1_2026-09-25.xlsx")), "po.xlsx"), /expected "Job"/);
  eq(S.sniff(bytes, X.file).kind, "jctd");
  eq(S.sniff(fs.readFileSync(path.join(__dirname, "fixtures/projects/Projects.xlsx")), "Projects.xlsx").kind, "projects", "the register still reads as itself");
});
const onFeed = (name) => !!V.vendorFromText(name);
const cands = Rec.candidates(doc.rows, { onFeed });
check("the recurring charges, largest first: vendor, amount, units, months, feed, Liberty-owned, current", () => {
  eq(cands.map((c) => [c.vendor_name, c.amount_cents, c.units, c.months, c.on_feed, c.liberty_owned, c.current]), X.candidates);
  for (const n of X.notCandidates) ok(!cands.some((c) => c.vendor_name === n), `${n} is not a candidate`);
  const mob = cands[0]; eq(mob.monthly_cents, 49346394); eq(mob.key, `${X.job}|MOB200|CONTRACT MIN5097539|49346394`); eq(mob.invoices, ["218084", "221281"]); eq(mob.first_month, "2026-07"); eq(mob.last_month, "2026-08");
  const polaris = cands.find((c) => c.liberty_owned); eq(polaris.vendor_code, "LIBERTY"); eq(polaris.description, "POLARIS RANGER C~1M"); eq(polaris.monthly_cents, 370000); eq(polaris.cost_code, "01-13-0001");
});
check("a reversal nets against the earliest charge on its invoice; a '(Rev)' prefix is the same line", () => {
  const alt = cands.find((c) => c.vendor_code === "ALT100"); eq(alt.units, 1); eq(alt.lines, 3); eq(alt.months_seen, 3);
  eq(Rec.normDesc("(Rev)26-004809"), "26-004809"); eq(Rec.normDesc("POLARIS RANGER C~1M03/29-04/25"), "POLARIS RANGER C~1M"); eq(Rec.normDesc("CDR DC4 7/1-7/31/26"), "CDR DC4"); eq(Rec.normDesc(" cdr  dc4 "), "CDR DC4");
});
check("the summary the card shows", () => { eq(Rec.summary(cands), X.summary); });
check("a confirmed charge's month: markup on the amount; tax only when the amount does not carry it; Liberty-owned is rent only", () => {
  const job = { tax_bp: 700, markup_bp: 1000, markup_base: "rent_plus_tax" };
  eq(Rec.monthCost({ monthly_cents: 100000, amount_includes_tax: true }, job), { rent: 100000, tax: 0, markup: 10000, total: 110000 });
  eq(Rec.monthCost({ monthly_cents: 100000, amount_includes_tax: false }, job), { rent: 100000, tax: 7000, markup: 10700, total: 117700 });
  eq(Rec.monthCost({ monthly_cents: 100000, amount_includes_tax: false }, Object.assign({}, job, { markup_base: "rent" })), { rent: 100000, tax: 7000, markup: 10000, total: 117000 });
  eq(Rec.monthCost({ monthly_cents: 100000, liberty_owned: true }, job), { rent: 100000, tax: 0, markup: 0, total: 100000 });
  eq(Rec.inForce({ start_month: "2026-07-01", end_month: null }, "2026-09"), true); eq(Rec.inForce({ start_month: "2026-07-01", end_month: "2026-08-01" }, "2026-09"), false); eq(Rec.inForce({ start_month: "2026-07-01" }, "2026-06"), false);
});
check("the feed check reads names as Sage spells them", () => {
  ok(onFeed("United Rentals (North America)")); ok(onFeed("Sunbelt Rentals")); ok(onFeed("Herc Rentals")); ok(!onFeed("Mobile Air & Power Rentals")); ok(!onFeed("Altorfer Inc")); ok(!onFeed(""));
});
(async () => {
  await checkAsync("the Update card: stamp, notes, conservation", async () => {
    const card = await Intake.inspect(bytes, X.file, { labor: { jobs: [{ job_number: X.job, short_name: "DC4" }] } });
    eq(card.status, "ready"); eq(card.kind, "jctd"); eq(card.title, "Job Cost To Date, DC4 through Sep 17, 2026");
    ok(/^\d+ rows, \$[\d,.]+; 6 recurring charges \(3 off feed\)$/.test(card.stamp), card.stamp);
    eq(card.conservation, { rows: X.rows, amount_cents: X.amount_cents }); eq(card.candidates.length, 6);
    ok(card.notes.some((n) => /off feed, this month: \$497,163\.94 a month in 3 recurring charges \(1 Liberty-owned\)/.test(n)), card.notes.join(" / "));
    const unknown = await Intake.inspect(bytes, X.file, { labor: { jobs: [] } }); ok(unknown.notes.some((n) => /not in Settings/.test(n)));
  });
  done();
})();
