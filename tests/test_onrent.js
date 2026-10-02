/* test_onrent.js - the on-rent reader: content-matched layouts, cents, as-of, refusals.
   The three vendor layouts are the real ones (headers copied from Shane's
   exports of 2026-10-01); the rows are made up. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, refuses, done, C } = require("./lib.js");
const OnRent = require("../app/onrent.js");
const V = require("../app/onrent_vendors.js");
const F = path.join(__dirname, "fixtures/onrent");
const X = JSON.parse(fs.readFileSync(path.join(F, "expected.json"), "utf8"));
const bytes = (rel) => fs.readFileSync(path.join(F, rel));
const wk1 = OnRent.read(bytes(X.wk1.file), X.wk1.file);

// ---- the page's own layout ---------------------------------------------------
check("generic: vendor from the Vendor column, matched by alias", () => { eq(wk1.layout, "generic"); eq(wk1.vendor_key, X.wk1.vendor_key); eq(wk1.vendor_name, "Sunbelt Rentals"); ok(wk1.vendorKnown); });
check("generic: as-of from the file name when there is no column", () => { eq(wk1.as_of, X.wk1.as_of); eq(wk1.asOfSource, "name"); });
check("generic: lines, rent in cents, lines with no monthly figure", () => {
  eq(wk1.totals.lines, X.wk1.lines); eq(wk1.totals.rent_cents, X.wk1.rent_cents); eq(wk1.totals.noMonthly, X.wk1.noMonthly); eq(wk1.totals.jobRefs, X.wk1.jobRefs);
});
check("money text with $ and commas reads as cents", () => { eq(wk1.lines[2].rate_cents, 320000); eq(wk1.lines[2].monthly_rent_cents, 320000); });
check("a monthly rate with no monthly figure is rate x qty", () => { eq(wk1.lines[3].qty, 3); eq(wk1.lines[3].monthly_rent_cents, 195000); });
check("a 4-week rate in the generic layout is kept as it is, no monthly figure invented", () => { eq(wk1.lines[1].rate_period, "4week"); eq(wk1.lines[1].monthly_rent_cents, null); });
check("dates and periods normalise", () => { eq(wk1.lines[0].on_rent_date, "2026-08-03"); eq(wk1.lines[0].rate_period, "month"); eq(OnRent.periodOf("Weekly"), "week"); eq(OnRent.periodOf("28 Day"), "4week"); ok(Number.isNaN(OnRent.periodOf("Fortnightly"))); });
check("generic xlsx with a title row above the header (As Of column, Liberty Owned N)", () => {
  const g = OnRent.read(bytes(X.ur_generic.file), X.ur_generic.file);
  eq(g.layout, "generic"); eq(g.vendor_key, X.ur_generic.vendor_key); eq(g.as_of, X.ur_generic.as_of); eq(g.asOfSource, "column");
  eq(g.totals.lines, X.ur_generic.lines); eq(g.totals.rent_cents, X.ur_generic.rent_cents); eq(g.totals.noMonthly, X.ur_generic.noMonthly); eq(g.lines[0].liberty_owned, false);
});
check("Liberty-owned vendor marks every line Liberty-owned", () => {
  const m = OnRent.read(bytes(X.mcw.file), X.mcw.file);
  eq(m.vendor_key, X.mcw.vendor_key); eq(m.totals.liberty_owned, X.mcw.liberty_owned); eq(m.totals.rent_cents, X.mcw.rent_cents);
});
check("an as-of given by the person wins", () => eq(OnRent.read(bytes(X.wk1.file), X.wk1.file, { as_of: "2026-09-20" }).asOfSource, "given"));
check("an unknown vendor name still reads, with a slug key and known:false", () => {
  const txt = fs.readFileSync(path.join(F, X.wk1.file), "utf8").replace(/Sunbelt/g, "Acme Lifts LLC");
  const d = OnRent.read(Buffer.from(txt), X.wk1.file);
  eq(d.vendor_key, "acme_lifts_llc"); eq(d.vendorKnown, false);
});
check("a rental listed twice is numbered, never dropped or refused", () => {
  const d = OnRent.read(bytes("bad/dup_identity_2026-09-26.csv"), "dup_identity_2026-09-26.csv");
  eq(d.lines.map((l) => l.seq), [1, 2]); eq(d.totals.repeats, 1); eq(d.totals.lines, 2);
});
check("asOfFromName", () => { eq(OnRent.asOfFromName("sunbelt_2026-09-19.csv"), "2026-09-19"); eq(OnRent.asOfFromName("UR On Rent 9-26-2026.xlsx"), "2026-09-26"); eq(OnRent.asOfFromName("report.csv"), null); });

// ---- Sunbelt's account export ---------------------------------------------------
check("Sunbelt: recognised by its columns and its customer name; asks for the day", () => {
  const e = refuses(() => OnRent.read(bytes(X.sunbelt.file), X.sunbelt.file), /does not say what day it is as of/);
  ok(e instanceof C.NeedsDecision); eq(e.need, "as_of"); eq(e.layout, "sunbelt");
});
const snb = OnRent.read(bytes(X.sunbelt.file), X.sunbelt.file, { as_of: "2026-10-01" });
check("Sunbelt: vendor, lines, 4-week rate x qty as the month, job names", () => {
  eq(snb.layout, X.sunbelt.layout); eq(snb.vendor_key, X.sunbelt.vendor_key); ok(snb.vendorKnown);
  eq(snb.totals.lines, X.sunbelt.lines); eq(snb.totals.rent_cents, X.sunbelt.rent_cents); eq(snb.totals.noMonthly, X.sunbelt.noMonthly);
  eq(snb.lines.every((l) => l.rate_period === "4week"), true); eq(snb.totals.jobRefs, X.sunbelt.jobRefs);
  eq(snb.lines[0].monthly_rent_cents, 295000); eq(snb.lines[0].fourweek_rate_cents, 295000); eq(snb.lines[0].day_rate_cents, 65000);
  eq(snb.lines[1].monthly_rent_cents, 0, "a $0 accessory is a $0 line"); eq(snb.lines[1].qty, 4);
});
check("Sunbelt: repeated identity numbered, PO and dates carried", () => {
  eq(snb.lines.map((l) => l.seq), X.sunbelt.seqs); eq(snb.totals.repeats, X.sunbelt.repeats);
  eq(snb.lines[0].po, "QTS DC4"); eq(snb.lines[0].on_rent_date, "2025-10-27"); eq(snb.lines[0].billed_through, "2026-09-28"); eq(snb.lines[0].est_return, "2026-11-24");
  eq(snb.lines[0].raw.job_ref_alt, "1 - LIBERTY CDR"); eq(snb.lines[0].line_ref, "1");
});
check("Sunbelt: the columns with another customer's name refuse", () =>
  refuses(() => OnRent.read(bytes("bad/sunbelt_other_customer.csv"), "sunbelt_other_customer.csv", { as_of: "2026-10-01" }), /Customer Name column reads "ACME CO"/));

// ---- Sunbelt's all-jobs export ----------------------------------------------------
const sa = OnRent.read(bytes(X.sunbelt_all.file), X.sunbelt_all.file);
check("Sunbelt all jobs: its own layout (no Quantity, no Customer Name), the vendor by its codes, the day from Date Rented + days on rent", () => {
  eq(sa.layout, X.sunbelt_all.layout); eq(sa.vendor_key, X.sunbelt_all.vendor_key); ok(sa.vendorKnown);
  eq(sa.as_of, X.sunbelt_all.as_of); eq(sa.asOfSource, "derived"); eq(sa.totals.accounts, X.sunbelt_all.accounts);
});
check("Sunbelt all jobs: a serial number is one unit; a bulk line without one shows its rate and is not counted; $0 stays $0", () => {
  eq(sa.totals.lines, X.sunbelt_all.lines); eq(sa.totals.rent_cents, X.sunbelt_all.rent_cents); eq(sa.totals.noMonthly, X.sunbelt_all.noMonthly); eq(sa.totals.qtyUnknown, X.sunbelt_all.qtyUnknown);
  eq(sa.lines.map((l) => l.monthly_rent_cents), X.sunbelt_all.monthly); eq(sa.lines.map((l) => l.equipment_no), X.sunbelt_all.equipment);
  eq(sa.lines.every((l) => l.qty === 1), true); eq(sa.lines.map((l) => !!l.raw.qty_unknown), [false, false, true, true, true, true, false, false], "every line without a serial says its quantity is unknown; only the ones with a rate are left uncounted");
  eq(sa.lines[2].rate_period, "4week"); eq(sa.lines[2].rate_cents, 10000); eq(sa.lines[2].fourweek_rate_cents, 10000);
});
check("Sunbelt all jobs: repeats numbered, job names, PO, location and days carried", () => {
  eq(sa.lines.map((l) => l.seq), X.sunbelt_all.seqs); eq(sa.totals.repeats, X.sunbelt_all.repeats); eq(sa.totals.jobRefs, X.sunbelt_all.jobRefs);
  eq(sa.lines[0].po, "7050984"); eq(sa.lines[0].on_rent_date, "2025-08-20"); eq(sa.lines[0].raw.days_on_rent, 408); eq(sa.lines[0].raw.account, "550106");
  eq(sa.lines[0].raw.job_location, "1 HARBORSIDE DR, BOSTON"); eq(sa.lines[0].raw.job_ref_alt, "01821"); eq(sa.lines[0].raw.serial, "LE980LEDV-T-487617"); eq(sa.lines[0].raw.cat_class, "012-0317");
});
check("Sunbelt all jobs: lines that disagree on the day make the card ask; a given day wins", () => {
  const e = refuses(() => OnRent.read(bytes("bad/sunbelt_all_jobs_days_disagree.csv"), "sunbelt_all_jobs_days_disagree.csv"), /lands on 2 different days: 2026-10-01, 2026-10-02/);
  ok(e instanceof C.NeedsDecision); eq(e.need, "as_of");
  eq(OnRent.read(bytes("bad/sunbelt_all_jobs_days_disagree.csv"), "sunbelt_all_jobs_days_disagree.csv", { as_of: "2026-10-02" }).asOfSource, "given");
});
check("Sunbelt all jobs: the columns with codes that are not Sunbelt's refuse", () =>
  refuses(() => OnRent.read(bytes("bad/sunbelt_all_jobs_other_codes.csv"), "sunbelt_all_jobs_other_codes.csv"), /Cat-Class column reads "X-1"/));
check("Sunbelt all jobs: the account export still reads as the account export (its Quantity column counts)", () => eq(snb.layout, "sunbelt"));

// ---- Herc's summary -------------------------------------------------------------
const herc = OnRent.read(bytes(X.herc.file), X.herc.file);
check("Herc: header on row 4, Totals row skipped, Report Date is the as-of", () => {
  eq(herc.layout, "herc"); eq(herc.vendor_key, "herc"); eq(herc.as_of, X.herc.as_of); eq(herc.asOfSource, "column"); eq(herc.totals.skipped, X.herc.skipped);
});
check("Herc: month rate x quantity, serial or IC number as the unit, repeats numbered", () => {
  eq(herc.totals.lines, X.herc.lines); eq(herc.totals.rent_cents, X.herc.rent_cents); eq(herc.totals.repeats, X.herc.repeats);
  eq(herc.lines.map((l) => l.equipment_no), X.herc.equipment); eq(herc.lines.map((l) => l.seq), X.herc.seqs);
  eq(herc.lines[3].qty, 4); eq(herc.lines[3].monthly_rent_cents, 20000); eq(herc.lines[2].line_ref, "36693862-001"); eq(herc.lines[2].vendor_job_ref, "DC BUILDING 202");
  eq(herc.lines[0].on_rent_date, "2026-03-26"); eq(herc.lines[0].po, "50-60-225009");
});
check("Herc: the file name's date is NOT used (a saved report's name carries the day it was set up)", () => {
  ok(herc.as_of !== "2026-06-24");
});
check("Herc: the columns with another vendor's name refuse", () =>
  refuses(() => OnRent.read(bytes("bad/herc_other_vendor.xlsx"), "herc_other_vendor.xlsx"), /Vendor column reads "Other Co"/));

// ---- United Rentals' Total Control export ------------------------------------------
const ur = OnRent.read(bytes(X.ur.file), X.ur.file);
check("United Rentals: recognised by its columns and Equipment Source; as-of from the export time in the name", () => {
  eq(ur.layout, "united_rentals"); eq(ur.vendor_key, "united_rentals"); eq(ur.as_of, X.ur.as_of); eq(ur.asOfSource, "name");
});
check("United Rentals: padded unit numbers trimmed, bulk lines by category-class, repeats numbered", () => {
  eq(ur.totals.lines, X.ur.lines); eq(ur.totals.rent_cents, X.ur.rent_cents); eq(ur.totals.repeats, X.ur.repeats); eq(ur.totals.noUnit, X.ur.noUnit);
  eq(ur.lines.map((l) => l.equipment_no), X.ur.equipment); eq(ur.lines.map((l) => l.seq), [1, 1, 1, 2, 3, 1, 1]);
  eq(ur.lines[1].raw.equipment_from, "cat-class"); eq(ur.lines[1].monthly_rent_cents, 15000); eq(ur.lines[1].qty, 2);
  eq(ur.totals.jobRefs, X.ur.jobRefs); eq(ur.lines[0].vendor_job_ref, "CDR-SCCI-DC4"); eq(ur.lines[0].description, "TELEHANDLER 10K 55'");
  eq(ur.lines[0].on_rent_date, "2026-08-21"); eq(ur.lines[6].pickup_date, "2026-09-24");
  eq(ur.lines[5].raw.code1, "LOENBRO"); eq(ur.lines[5].raw.code2, "50-63-125007"); eq(ur.lines[5].raw.account, "LIBERTY BUILDS CDR");
});

// ---- EquipmentShare's rentals export ----------------------------------------------------
const es = OnRent.read(bytes(X.es.file), X.es.file);
check("EquipmentShare: recognised by its columns and Vendor; as-of from the short date in the name", () => {
  eq(es.layout, "equipmentshare"); eq(es.vendor_key, "equipmentshare"); eq(es.as_of, X.es.as_of); eq(es.asOfSource, "name");
});
check("EquipmentShare: only On-rent rows count; the rest are counted by status", () => {
  eq(es.totals.lines, X.es.lines); eq(es.totals.rent_cents, X.es.rent_cents); eq(es.totals.notCounted, X.es.notCounted);
  eq(es.lines.map((l) => l.equipment_no), X.es.equipment); eq(es.totals.jobRefs, X.es.jobRefs);
  eq(es.lines[2].qty, 8); eq(es.lines[2].monthly_rent_cents, 22400); eq(es.lines[3].month_rate_cents, 78150); eq(es.lines[3].raw.shift, "Double");
  eq(es.lines[0].contract_no, "7364017"); eq(es.lines[0].line_ref, "4229608"); eq(es.lines[0].po, "26-010424"); eq(es.lines[0].on_rent_date, "2026-08-05"); eq(es.lines[0].raw.next_bill, "2026-09-02");
});
check("asOfFromName: two-digit years only as a last resort, never from a version-like number", () => {
  eq(OnRent.asOfFromName("EquipShare_rentals-export_9.4.26.csv"), "2026-09-04");
  eq(OnRent.asOfFromName("rentals-export.csv"), null);
  eq(OnRent.asOfFromName("Equipment_On_Rent_-_All_Jobs_2026-10-01-04.21.10.775885.XLS"), "2026-10-01");
});

// ---- refusals and the registry ---------------------------------------------------------
check("refuses: a layout nobody confirmed, naming the ones that read and the ones awaited", () =>
  refuses(() => OnRent.read(bytes("bad/unknown_layout.csv"), "unknown_layout.csv"), /not an on-rent layout this page reads \(GR Cost on-rent CSV; Sunbelt .*awaiting a real export: Mission Critical/));
check("refuses: two vendors in one generic report", () => refuses(() => OnRent.read(bytes("bad/mixed_vendors_2026-09-26.csv"), "mixed_vendors_2026-09-26.csv"), /names 2 vendors \(Sunbelt, Herc\)/));
check("asks: generic with no as-of anywhere", () => {
  const e = refuses(() => OnRent.read(bytes("bad/sunbelt_report.csv"), "sunbelt_report.csv"), /does not say what day it is as of/);
  ok(e instanceof C.NeedsDecision); eq(e.need, "as_of");
});
check("refuses: a rate period it does not know", () => refuses(() => OnRent.read(bytes("bad/bad_period_2026-09-26.csv"), "bad_period_2026-09-26.csv"), /Rate Period "Fortnightly"/));
check("registry: six confirmed layouts, one awaiting; every confirmed one says what it was confirmed from", () => {
  eq(V.confirmed().map((l) => l.layout), ["generic", "sunbelt", "sunbelt_all_jobs", "herc", "united_rentals", "equipmentshare"]);
  eq(V.awaiting().map((l) => l.layout), ["mcw"]);
  ok(V.confirmed().every((l) => l.confirmed_from));
  eq(V.vendorFromName("UNITED RENTALS").vendor_key, "united_rentals"); eq(V.vendorFromName("T3").vendor_key, "equipmentshare"); eq(V.vendorFromName("SNB").vendor_key, "sunbelt");
});
done();
