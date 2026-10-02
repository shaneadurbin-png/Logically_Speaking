/* test_intake.js - a drop, card by card: hash, kind, stamp, refusal, zip. */
"use strict";
const fs = require("fs"), path = require("path");
const { checkAsync, eq, ok, done, C } = require("./lib.js");
const Intake = require("../app/intake.js");
const F = path.join(__dirname, "fixtures");
const b = (rel) => fs.readFileSync(path.join(F, rel));
const expected = JSON.parse(fs.readFileSync(path.join(F, "hh2/expected.json"), "utf8"));
const ratesJson = JSON.parse(fs.readFileSync(path.join(F, "rates/iowa_fy27.json"), "utf8"));
const employees = JSON.parse(fs.readFileSync(path.join(F, "rates/employees.json"), "utf8"));
const rates = [];
for (const table of Object.values(ratesJson.tables)) for (const r of ratesJson.table) if (!(r.except_tables || []).includes(table)) rates.push(Object.assign({ rate_table_code: table, effective_from: ratesJson.effective_from, effective_to: ratesJson.effective_to }, r));
const jobs = Object.entries(ratesJson.tables).map(([job_number, rate_table_code]) => ({ job_number, rate_table_code }));
const ctx = { labor: { rates, employees, policy: {}, jobs }, vendorSettings: {}, jobMap: { sunbelt: { "CDR DC4": "50-60-225121", "CDR DC5": "50-60-225120" } } };

(async () => {
  await checkAsync("HH2 card: ready, stamped, conserved, hashed", async () => {
    const c = await Intake.inspect(b("hh2/" + expected.file), expected.file, ctx);
    eq(c.status, "ready"); eq(c.kind, "hh2_labor");
    eq(c.stamp, "60 rows, 410 hours, 9 held (2 no rate, 3 no class, 1 unknown job, 3 PTO pay type)");
    eq(c.conservation, { rows: 60, hours_x100: 41000 }); eq(c.period, expected.range);
    ok(/^[0-9a-f]{64}$/.test(c.sha256)); eq(c.title, "HH2 labor, Sep 1, 2026 to Sep 30, 2026");
    ok(c.notes.some((n) => /3 exact duplicate rows kept/.test(n)), "duplicates noted");
  });
  await checkAsync("the same bytes hash the same, whatever the name", async () => {
    const a = await Intake.inspect(b("hh2/" + expected.file), "a.xlsx", ctx), c = await Intake.inspect(b("hh2/" + expected.file), "b.xlsx", ctx);
    eq(a.sha256, c.sha256);
  });
  await checkAsync("already on file: the card says who and when, and does not re-read", async () => {
    const existing = async (sha) => ({ file_name: "LaborDetails_9_1_2026_to_9_30_2026.xlsx", recorded_by_name: "Shane", recorded_at: "2026-09-30T14:00:00Z" });
    const c = await Intake.inspect(b("hh2/" + expected.file), expected.file, Object.assign({ existing }, ctx));
    eq(c.status, "already-on-file"); eq(c.reason, "already on file, recorded by Shane on Sep 30, 2026"); eq(c.doc, undefined);
  });
  await checkAsync("on-rent card: ready, with the month to the client and the unmatched job names noted", async () => {
    const c = await Intake.inspect(b("onrent/sunbelt_2026-09-26.csv"), "sunbelt_2026-09-26.csv", ctx);
    eq(c.status, "ready"); eq(c.kind, "onrent");
    eq(c.stamp, "Sunbelt Rentals, as of Sep 26, 2026: 5 on rent, $10,050.00 rent a month (1 with no monthly figure)");
    eq(c.unmapped, []); eq(c.conservation, { lines: 5, rent_cents: 1005000 });
    ok(c.notes.some((n) => /\$1,182,885\.00|\$11,828\.85 a month to the client across 2 jobs/.test(n)), "client total noted: " + c.notes.join(" | "));
    const c1 = await Intake.inspect(b("onrent/sunbelt_2026-09-19.csv"), "sunbelt_2026-09-19.csv", ctx);
    eq(c1.unmapped, ["Campus Lot 7"]); ok(c1.notes.some((n) => /"Campus Lot 7"/.test(n)));
  });
  await checkAsync("a report that does not say its day asks, and reads once told", async () => {
    const c = await Intake.inspect(b("onrent/sunbelt_account_export.csv"), "sunbelt_account_export.csv", ctx);
    eq(c.status, "needs-decision"); eq(c.need, "as_of"); ok(/does not say what day/.test(c.reason));
    const c2 = await Intake.inspect(b("onrent/sunbelt_account_export.csv"), "sunbelt_account_export.csv", Object.assign({ asOf: { "sunbelt_account_export.csv": "2026-10-01" } }, ctx));
    eq(c2.status, "ready"); eq(c2.doc.as_of, "2026-10-01"); ok(/repeat/.test(c2.notes.join(" ")));
  });
  await checkAsync("Sunbelt's all-jobs export: the day worked out from the data, the bulk lines without a quantity named", async () => {
    const c = await Intake.inspect(b("onrent/Equipment on Rent - All Jobs.csv"), "Equipment on Rent - All Jobs.csv", ctx);
    eq(c.status, "ready"); eq(c.doc.as_of, "2026-10-02"); eq(c.doc.asOfSource, "derived");
    eq(c.stamp, "Sunbelt Rentals, as of Oct 2, 2026: 8 on rent, $6,325.00 rent a month (3 with no monthly figure)");
    const notes = c.notes.join(" | ");
    ok(/worked out from Date Rented \+ Number of Days on Rent/.test(notes)); ok(/3 lines carry no quantity/.test(notes)); ok(/3 accounts in one file/.test(notes));
    ok(!/day or week rate/.test(notes), "the no-quantity lines are not called day-or-week lines");
  });
  await checkAsync("the Purchase Pro export: ready, and the POs with no job named, not refused", async () => {
    const c = await Intake.inspect(b("purchases/Tbl_PO1_2026-09-25.xlsx"), "Tbl_PO1_2026-09-25.xlsx", ctx);
    eq(c.status, "ready"); ok(/12 POs/.test(c.stamp));
    ok(c.notes.some((n) => /2 POs carry no job; 1 of them is a live order and waits for a decision/.test(n)), c.notes.join(" | "));
    ok(c.notes.some((n) => /1 PO number is on more than one order \(26\.01 on 2\); those 2 orders wait for a decision/.test(n)), c.notes.join(" | "));
  });
  await checkAsync("a Sage rate table export: ready, tables named, jobs matched by number", async () => {
    const c = await Intake.inspect(b("rates/Sage_Rate_Tables_2026.xlsx"), "Sage_Rate_Tables_2026.xlsx", ctx);
    eq(c.status, "ready"); eq(c.kind, "sage_rates"); eq(c.stamp, "2 rate tables, 27 rates"); eq(c.conservation, { rates: 27 });
    eq(c.matched, { "#225121": ["50-60-225121"] });
    ok(c.notes.some((n) => /#225121 CDR1 East DC4: 24 rates, 4 classes, in force from Jun 1, 2025, Jun 1, 2026; job 50-60-225121/.test(n)), c.notes.join(" | "));
    ok(c.notes.some((n) => /#224050 BWI: .*no job in Settings carries this number/.test(n)));
    ok(c.notes.some((n) => /1 catch-all row/.test(n)));
  });
  await checkAsync("a refused file keeps its reason; a system file is skipped; a PDF is refused for now", async () => {
    const c = await Intake.inspect(b("onrent/bad/unknown_layout.csv"), "unknown_layout.csv", ctx);
    eq(c.status, "refused"); ok(/not a layout this page reads/.test(c.reason), c.reason);
    eq((await Intake.inspect(Buffer.from("x"), "Thumbs.db", ctx)).status, "skipped");
    const p = await Intake.inspect(Buffer.from("%PDF-1.4"), "ticket.pdf", ctx);
    eq(p.status, "refused"); ok(/next release/.test(p.reason));
  });
  await checkAsync("a zip expands: stored and deflated entries read, system files skipped, nothing silent", async () => {
    const cards = await Intake.inspectAll([{ name: "drop.zip", bytes: b("drop.zip") }], ctx);
    eq(cards.map((c) => [c.name, c.status]), [["drop.zip", "zip"], ["sunbelt_2026-09-19.csv", "ready"], ["sunbelt_2026-09-26.csv", "ready"], ["notes.txt", "refused"]]);
    eq(cards[0].reason, "4 files inside"); eq(cards[1].fileName, "drop.zip/week 1/sunbelt_2026-09-19.csv");
    eq(cards[2].doc.as_of, "2026-09-26", "as-of from the entry's name");
  });
  await checkAsync("sortCards puts ready first, then decisions, refusals, already-on-file", async () => {
    const cards = [{ status: "refused", fileName: "b" }, { status: "ready", fileName: "z" }, { status: "already-on-file", fileName: "a" }, { status: "needs-decision", fileName: "c" }, { status: "ready", fileName: "a" }];
    eq(Intake.sortCards(cards).map((c) => c.status + ":" + c.fileName), ["ready:a", "ready:z", "needs-decision:c", "refused:b", "already-on-file:a"]);
  });
  await checkAsync("unzip refuses what is not a zip", async () => {
    let err = null; try { Intake.unzip(Buffer.from("not a zip at all, honestly")); } catch (e) { err = e; }
    ok(err instanceof C.Refusal); ok(/not a zip/.test(err.message));
  });
  done();
})();
