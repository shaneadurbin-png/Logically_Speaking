/* test_labor_model.js - pricing: the exact key, what is held and why, never $0. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, refuses, done } = require("./lib.js");
const HH2 = require("../app/hh2.js");
const L = require("../app/labor_model.js");
const F = path.join(__dirname, "fixtures");
const expected = JSON.parse(fs.readFileSync(path.join(F, "hh2/expected.json"), "utf8"));
const ratesJson = JSON.parse(fs.readFileSync(path.join(F, "rates/iowa_fy27.json"), "utf8"));
const employees = JSON.parse(fs.readFileSync(path.join(F, "rates/employees.json"), "utf8"));

/** the rate tables flattened, the way the database holds them */
function rateRows(j) {
  const out = [];
  for (const table of Object.values(j.tables)) for (const r of j.table) {
    if ((r.except_tables || []).includes(table)) continue;
    out.push({ id: out.length + 1, rate_table_code: table, certified_class: r.certified_class, pay_id: r.pay_id,
      rate_cents: r.rate_cents, effective_from: j.effective_from, effective_to: j.effective_to, retired_at: null });
  }
  return out;
}
const rates = rateRows(ratesJson);
const jobs = Object.entries(ratesJson.tables).map(([job_number, rate_table_code]) => ({ job_number, rate_table_code }));
const doc = HH2.read(fs.readFileSync(path.join(F, "hh2", expected.file)), expected.file);
const ctx = { rates, employees, policy: {}, jobs };
const priced = L.price(doc.rows, ctx);
const sum = L.summarize(priced);

check("week ending is the Sunday on or after", () => {
  eq(L.weekEnding("2026-09-06"), "2026-09-06"); eq(L.weekEnding("2026-09-07"), "2026-09-13");
  eq(L.weekEnding("2026-09-12"), "2026-09-13"); eq(L.weekEnding("2026-09-30"), "2026-10-04");
});
check("certified class from the employee-number prefix; safety has no default", () => {
  eq(L.classFromPrefix("FB5012"), "#LAB-J"); eq(L.classFromPrefix("fb8001"), "#CARP-J"); eq(L.classFromPrefix("FB1001"), null);
  eq(L.classFromPrefix("TTR-10073"), "#LAB-J"); eq(L.classFromPrefix("FE9001"), null); eq(L.classFromPrefix(""), null);
});
check("the prefix defaults are a setting: rows from Settings read, the longest listed prefix wins, none listed means none guessed", () => {
  eq(L.classFromPrefix("FE60067", { FE: "#SUP" }), "#SUP"); eq(L.classFromPrefix("FB5001", { FB: "#LAB-J", FB5: "#LAB-F" }), "#LAB-F"); eq(L.classFromPrefix("FB2001", { FB: "#LAB-J", FB5: "#LAB-F" }), "#LAB-J");
  eq(L.classFromPrefix("FB5001", [{ prefix: "fb5", certified_class: "#LAB-J" }]), "#LAB-J"); eq(L.classFromPrefix("FB5001", {}), null); eq(L.classFromPrefix("FB5001", []), null);
  eq(L.prefixMap([{ prefix: "FB8", certified_class: "#CARP-J" }, { prefix: "", certified_class: "#SUP" }]), { FB8: "#CARP-J" }); eq(L.prefixMap(undefined), L.PREFIX_CLASS);
  const none = L.price(doc.rows, Object.assign({}, ctx, { prefixes: [] }));
  const before = Object.fromEntries(priced.map((r) => [r.row_index, r.status]));
  const fb5 = none.filter((r) => r.employee_number.startsWith("FB5") && r.employee_number !== "FB5003" && /^(priced|held:no rate)$/.test(before[r.row_index]));
  ok(fb5.length > 0 && fb5.every((r) => r.status === "held:no class"), "with no prefixes listed, FB5 rows without a set class are held (PTO rows stay PTO)");
  eq(none.find((r) => r.employee_number === "FB5003" && r.pay_type === "REG").status, "priced", "a class set on the person still prices");
  const fe = L.price(doc.rows, Object.assign({}, ctx, { prefixes: [{ prefix: "FB1", certified_class: "#LAB-J" }].concat(Object.entries(L.PREFIX_CLASS).map(([prefix, certified_class]) => ({ prefix, certified_class }))) }));
  ok(fe.filter((r) => r.employee_number.startsWith("FB1")).every((r) => r.status !== "held:no class"), "listing FB1 takes its rows out of no class");
});
check("class codes read as words", () => {
  eq(L.classLabel("#CARP-GF"), "Carpenter General Foreman"); eq(L.classLabel("#LAB-J"), "Laborer Journeyman"); eq(L.classLabel("#SUP"), "Superintendent"); eq(L.classLabel("#LAB-NU"), "Laborer Non-union");
});
check("the Sage table for a job carries its last six digits", () => {
  const codes = ["#225008", "#225040MC", "#224050", "#100381MC"];
  eq(L.tableForJob("50-60-225008", codes), "#225008"); eq(L.tableForJob("50-60-225040", codes), "#225040MC"); eq(L.tableForJob("60-26-100381", codes), "#100381MC");
  eq(L.tableForJob("50-60-225121", codes), null); eq(L.tableForJob("50-60-225040", codes.concat(["#225040"])), null, "two candidates is no answer");
});
check("every row gets the status the spec intends", () => {
  const bad = [];
  for (const e of expected.rowStatus) {
    const r = priced.find((x) => x.row_index === e.row_index);
    if (!r) { bad.push(`row ${e.row_index} missing`); continue; }
    if (r.status !== e.status) bad.push(`row ${e.row_index} ${r.employee_number} ${r.work_date}: ${r.status} (${r.reason}) expected ${e.status}`);
    if (r.cost_cents !== e.cost_cents) bad.push(`row ${e.row_index}: cost ${r.cost_cents} expected ${e.cost_cents}`);
  }
  if (bad.length) throw new Error(bad.join("\n       "));
});
check("held rows: count and reasons", () => {
  eq(sum.held.rows, expected.held);
  eq(Object.fromEntries(Object.entries(sum.held.byReason).map(([k, v]) => [k, v.rows])), expected.heldByReason);
});
check("held is never priced at zero: cost is null, rate is null", () => {
  for (const r of priced) if (r.status !== "priced") { eq(r.cost_cents, null, r.status); eq(r.rate_cents, null, r.status); }
});
check("totals: cost, hours, rows", () => {
  eq(sum.costCents, expected.costCents); eq(sum.hoursX100, expected.hoursX100); eq(sum.rows, expected.rows);
  eq(sum.priced.rows + sum.held.rows + sum.excluded.rows, expected.rows);
});
check("by job matches the spec", () => {
  for (const [job, j] of Object.entries(expected.byJob)) eq(sum.byJob[job].costCents, j.costCents, job);
});
check("the class set in Settings beats the prefix default", () => {
  const r = priced.find((x) => x.employee_number === "FB5003" && x.pay_type === "REG");
  eq(r.certified_class, "#LAB-GF"); eq(r.rate_cents, 10825); eq(r.cost_cents, 86600); eq(r.rate_table_code, "#225121");
});
check("UNION REG and REG are two pay IDs", () => {
  const a = priced.find((x) => x.employee_number === "FB5002" && x.pay_type === "UNION REG");
  const b = priced.find((x) => x.employee_number === "FB5001" && x.pay_type === "REG");
  eq(a.status, "priced"); eq(b.status, "priced");
  const only = rates.filter((x) => x.pay_id !== "UNION REG");
  const p2 = L.price([a], { rates: only, employees, policy: {}, jobs });
  eq(p2[0].status, "held:no rate"); ok(/UNION REG/.test(p2[0].reason));
});
check("a job with no rate table is held for that, before any rate is looked for", () => {
  const p = L.price(doc.rows.filter((r) => r.job_number === "50-60-225121").slice(0, 1), { rates, employees, policy: {}, jobs: [{ job_number: "50-60-225121", rate_table_code: null }] });
  eq(p[0].status, "held:no rate table");
});
check("policy from Settings wins over the built-in PTO list", () => {
  const hol = doc.rows.find((r) => r.pay_type_name === "Holiday");
  eq(L.price([hol], { rates, employees, policy: { Holiday: "excluded" }, jobs })[0].status, "excluded");
  const rated = L.price([hol], { rates, employees, policy: { Holiday: "rated" }, jobs })[0];
  eq(rated.status, "held:no rate"); ok(/HOL/.test(rated.reason), "a rated Holiday still needs a rate for pay ID HOL");
});
check("effective dates: from is inclusive, to is exclusive, retired is ignored", () => {
  const r = { rate_table_code: "#1", certified_class: "#LAB-J", pay_id: "REG", rate_cents: 100, effective_from: "2026-07-01", effective_to: "2026-08-01", retired_at: null };
  ok(L.findRate([r], "#1", "#LAB-J", "REG", "2026-07-01"));
  eq(L.findRate([r], "#1", "#LAB-J", "REG", "2026-08-01"), null);
  eq(L.findRate([r], "#1", "#LAB-J", "REG", "2026-06-30"), null);
  eq(L.findRate([Object.assign({}, r, { retired_at: "2026-07-15" })], "#1", "#LAB-J", "REG", "2026-07-10"), null);
});
check("two rates in force at once is refused, not picked", () => {
  const r = { rate_table_code: "#1", certified_class: "#LAB-J", pay_id: "REG", rate_cents: 100, effective_from: "2026-07-01", effective_to: null, retired_at: null };
  refuses(() => L.findRate([r, Object.assign({}, r, { rate_cents: 200 })], "#1", "#LAB-J", "REG", "2026-07-10"), /two rates/);
});
check("half a cent rounds away from zero, like Postgres", () => {
  const row = { row_index: 1, employee_number: "FB5001", work_date: "2026-09-01", job_number: "J", pay_type: "REG", pay_type_name: "Regular", hours_x100: 850 };
  const p = L.price([row], { rates: [{ rate_table_code: "#1", certified_class: "#LAB-J", pay_id: "REG", rate_cents: 8725 }], employees: {}, policy: {}, jobs: [{ job_number: "J", rate_table_code: "#1" }] });
  eq(p[0].cost_cents, 74163);   // 8.5 * 87.25 = 741.625
});
check("the stamp reads plainly", () => {
  eq(L.stamp(sum), "60 rows, 410 hours, 9 held (2 no rate, 3 no class, 1 unknown job, 3 PTO pay type)");
});
done();
