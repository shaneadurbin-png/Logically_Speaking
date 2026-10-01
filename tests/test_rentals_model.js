/* test_rentals_model.js - snapshots to a month's cost: diff, tax, markup, statement. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, refuses, done } = require("./lib.js");
const OnRent = require("../app/onrent.js");
const R = require("../app/rentals_model.js");
const F = path.join(__dirname, "fixtures/onrent");
const X = JSON.parse(fs.readFileSync(path.join(F, "expected.json"), "utf8"));
const read = (f) => OnRent.read(fs.readFileSync(path.join(F, f)), f);
const wk1 = read(X.wk1.file), wk2 = read(X.wk2.file);
const d = R.diff(wk1, wk2);

check("diff: what came on, what went off, what stayed", () => {
  eq(d.added.map((l) => l.equipment_no), X.wk2.added); eq(d.dropped.map((l) => l.equipment_no), X.wk2.dropped); eq(d.kept.length, X.wk2.kept);
  eq(d.dropped[0].off_rent_date, X.wk2.as_of); eq(d.dropped[0].last_seen, X.wk1.as_of);
});
check("diff from nothing: everything is new", () => { const d0 = R.diff(null, wk1); eq(d0.added.length, 5); eq(d0.dropped, []); });
check("diff refuses an older report and another vendor's", () => {
  refuses(() => R.diff(wk2, wk1), /not newer/);
  refuses(() => R.diff(Object.assign({}, wk1, { vendor_key: "herc" }), wk2), /two vendors/);
});
check("cost: rent, 7% tax, 10% on rent plus tax, half-cents away from zero", () => {
  eq(R.cost(490000, R.DEFAULT_SETTINGS), { rent: 490000, tax: 34300, markup: 52430, total: 576730 });
  eq(R.cost(1, R.DEFAULT_SETTINGS), { rent: 1, tax: 0, markup: 0, total: 1 });
  eq(R.cost(7, R.DEFAULT_SETTINGS), { rent: 7, tax: 0, markup: 1, total: 8 });   // 7 * 0.07 = 0.49 -> 0; 7 * 0.10 = 0.7 -> 1
  eq(R.cost(0, R.DEFAULT_SETTINGS), { rent: 0, tax: 0, markup: 0, total: 0 });
});
check("cost settings: untaxed, markup on rent only", () => {
  eq(R.cost(100000, { taxable: false, tax_bp: 700, markup_bp: 1000, markup_base: "rent" }), { rent: 100000, tax: 0, markup: 10000, total: 110000 });
  eq(R.cost(100000, { taxable: true, tax_bp: 700, markup_bp: 1000, markup_base: "rent" }), { rent: 100000, tax: 7000, markup: 10000, total: 117000 });
  refuses(() => R.settingsFor({ jobs: { J: { markup_base: "nope" } } }, "sunbelt", "J"), /markup_base/);
});
check("tax is the job's, taxable is the vendor's, unmapped gets neither", () => {
  const S = { vendors: { mcw: { taxable: false } }, jobs: { "50-60-224197": { tax_bp: 0, markup_bp: 1000 }, "50-60-225121": { tax_bp: 700, markup_bp: 1000 } } };
  eq(R.settingsFor(S, "sunbelt", "50-60-224197").tax_bp, 0, "SBN is not taxed");
  eq(R.settingsFor(S, "sunbelt", "50-60-225121").tax_bp, 700, "CDR is");
  eq(R.settingsFor(S, "mcw", "50-60-225121").taxable, false, "Liberty-owned rent is never taxed");
  const u = R.settingsFor(S, "sunbelt", "unmapped"); eq(u.taxable, false); eq(u.markup_bp, 0);
});
check("monthCost by job through the vendor's job names", () => {
  const m = R.monthCost(wk2, {}, X.jobMap);
  const dc4 = m["50-60-225121"], dc5 = m["50-60-225120"];
  eq({ rent: dc4.rent, tax: dc4.tax, markup: dc4.markup, total: dc4.total, lines: dc4.lines, noMonthly: dc4.noMonthly }, X.dc4_wk2);
  eq({ rent: dc5.rent, tax: dc5.tax, markup: dc5.markup, total: dc5.total, lines: dc5.lines, noMonthly: dc5.noMonthly }, X.dc5_wk2);
  eq(Object.keys(m).sort(), ["50-60-225120", "50-60-225121"]);
});
check("a job name the map does not know lands under unmapped, never under a job", () => {
  const m = R.monthCost(wk1, {}, X.jobMap);
  eq(m.unmapped.lines, 1); eq(m.unmapped.rent, 120000); eq(m.unmapped.refs, ["Campus Lot 7"]); eq(m.unmapped.total, 120000, "no tax or markup under no job");
});
check("Liberty-owned rent is kept apart and never taxed or marked up", () => {
  const mcw = read(X.mcw.file);
  const m = R.monthCost(mcw, {}, X.jobMap)["50-60-225121"];
  eq(m.rent, 0); eq(m.liberty_owned_rent, 275000); eq(m.total, 0); eq(m.liberty_owned_lines, 2);
});
check("the snapshot for a month is the latest on or before its end", () => {
  const s = R.snapshotForMonth([wk1, wk2], "2026-09"); eq(s.as_of, "2026-09-26");
  eq(R.snapshotForMonth([wk1, wk2], "2026-08"), null);
  eq(R.snapshotForMonth([wk1, wk2], "2026-10").as_of, "2026-09-26");
  const wk2b = Object.assign({}, wk2, { fileName: "sunbelt_2026-09-26_later.csv" });
  eq(R.snapshotForMonth([wk1, wk2, wk2b], "2026-09") === wk2b, true, "two reports as of the same day: the one recorded last stands");
  eq(R.snapshotForMonth([wk1, wk2b, wk2], "2026-09") === wk2, true, "whichever order they were recorded in");
});
check("identity carries the sequence number, so numbered repeats are distinct", () => {
  const a = { equipment_no: "E", contract_no: "C", vendor_job_ref: "J", seq: 1 }, b = Object.assign({}, a, { seq: 2 });
  ok(R.identity("v", a) !== R.identity("v", b)); eq(R.identity("v", { equipment_no: "E", contract_no: "C", vendor_job_ref: "J" }), R.identity("v", a));
});
check("United Rentals' real layout through monthCost: only the mapped job is billed", () => {
  const ur = OnRent.read(fs.readFileSync(path.join(F, X.ur.file)), X.ur.file);
  const m = R.monthCost(ur, {}, X.urJobMap);
  const dc4 = m["50-60-225121"];
  eq({ lines: dc4.lines, rent: dc4.rent, tax: dc4.tax, markup: dc4.markup, total: dc4.total }, X.ur_dc4);
  eq(m.unmapped.lines, 4); eq(m.unmapped.refs, ["CDR E1 - LOENBRO", "CDR-SCCI-DC4.DC5"]);
});
check("statement rows for one job, with off-rent listed", () => {
  const st = R.statement(wk2, {}, X.jobMap, "50-60-225121", d.dropped);
  eq(st.rows.map((r) => r.equipment_no), ["1002", "1001", "1006"]);   // by description
  eq(st.total, { rent: 490000, tax: 34300, markup: 52430, total: 576730, liberty_owned: 0 });
  eq(st.noMonthly, 1); eq(st.rows[0].total_cents, null);
  eq(st.offRent, []);                                                   // 1005 was at Campus Lot 7, unmapped
  eq(R.statement(wk2, {}, X.jobMap, "unmapped", d.dropped).offRent.map((l) => l.equipment_no), ["1005"]);
});
done();
