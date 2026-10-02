/* test_purchase_pro.js - the Purchase Pro PO export and the Projects register. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, refuses, done } = require("./lib.js");
const PO = require("../app/purchase_pro.js"), Projects = require("../app/projects.js"), S = require("../app/sniff.js");
const F = path.join(__dirname, "fixtures");
const X = JSON.parse(fs.readFileSync(path.join(F, "purchases/expected.json"), "utf8"));
const doc = PO.read(fs.readFileSync(path.join(F, "purchases", X.file)), X.file);

check("POs, what counts, what is left out", () => {
  eq(doc.kind, "purchase_orders"); eq(doc.totals.pos, X.pos); eq(doc.totals.counted, X.counted); eq(doc.totals.committed_cents, X.committed_cents);
  eq(doc.totals.cancelled, X.cancelled); eq(doc.totals.quotes, X.quotes); eq(doc.totals.noAmount, X.noAmount); eq(doc.totals.byType, X.byType); eq(doc.totals.jobs, X.jobs);
});
check("as-of from the file name; a PO's fields", () => {
  eq(doc.as_of, X.as_of); eq(doc.asOfSource, "name");
  const p = doc.pos.find((x) => x.po_number === "26-011096");
  eq(p.order_type, "Rental"); eq(p.committed_cents, 127078); eq(p.supplier_code, "SUN050"); eq(p.raw.quote_ref, "267298157"); eq(p.order_date, "2026-09-14"); eq(p.bucket, "EQUIPMENT"); eq(p.raw.exported, true);
});
check("NONBILLABLE in the description lands in Non-Billables; a quote and a cancelled order are kept but excluded", () => {
  eq(doc.pos.find((x) => x.po_number === "26-011099").bucket, "NON_BILLABLE");
  const q = doc.pos.find((x) => x.po_number === "Q-26-011098"); eq(q.quote, true); eq(q.order_type, "Material"); eq(q.committed_cents, null);
  eq(doc.pos.find((x) => x.po_number === "26-011097").cancelled, true);
  eq(doc.pos.find((x) => x.po_number === "26-011094").committed_cents, null, "no amount yet stays null");
});
check("a PO with no job is never a refusal: a quote is left out as it would be, a live order waits", () => {
  eq(doc.totals.noJob, X.noJob); eq(doc.totals.noJobCounted, X.noJobCounted);
  const q = doc.pos.find((x) => x.po_number === "Q-26-011091"); eq(q.job_number, null); eq(q.quote, true);
  const p = doc.pos.find((x) => x.po_number === "26-011090"); eq(p.job_number, null); eq(p.committed_cents, 15000); eq(p.order_type, "Material");
  ok(!doc.totals.jobs.includes(null) && !("null" in doc.totals.byJob) && !("" in doc.totals.byJob), "no job is not a job");
  eq(doc.totals.counted, X.counted, "the live order without a job still counts in the export's total; the database holds it for a decision");
});
check("one PO number on two orders: both kept, both marked; the identity is OrderID + number", () => {
  const XLSX = require("../app/vendor/xlsx.full.min.js");
  const wb = XLSX.read(fs.readFileSync(path.join(F, "purchases", X.file)), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  const q = rows[1].slice(); q[rows[0].indexOf("Purchase_Order")] = "Q-" + q[rows[0].indexOf("Purchase_Order")]; q[rows[0].indexOf("OrdType")] = "Material_Quote"; rows.push(q);
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(rows), "S");
  const d = PO.read(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }), "quote_and_order.xlsx");
  eq(d.totals.pos, X.pos + 1, "a quote and the order it became share an OrderID and both read");
  eq(doc.totals.sharedNumbers, X.sharedNumbers); eq(doc.totals.sharedNumberPos, X.sharedNumberPos);
  const two = doc.pos.filter((x) => x.po_number === "26.01"); eq(two.length, 2); eq(two.map((x) => x.shared_number), [2, 2]); eq(two.map((x) => x.order_id), ["11089", "11088"]);
  eq(doc.pos.find((x) => x.po_number === "26-011095").shared_number, null); eq(doc.pos.find((x) => x.po_number === "26-011095").order_id, "11095");
});
check("without a date in the name, the latest order date stands in and says so", () => {
  const d = PO.read(fs.readFileSync(path.join(F, "purchases", X.file)), "Tbl_PO1.xlsx");
  eq(d.as_of, X.latestOrder); eq(d.asOfSource, "latest order");
  eq(PO.read(fs.readFileSync(path.join(F, "purchases", X.file)), "Tbl_PO1.xlsx", { as_of: "2026-10-01" }).asOfSource, "given");
});
check("a row repeated in the export is kept twice and both copies wait; a foreign layout refuses", () => {
  const XLSX = require("../app/vendor/xlsx.full.min.js");
  const wb = XLSX.read(fs.readFileSync(path.join(F, "purchases", X.file)), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null }); rows.push(rows[1].slice());
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(rows), "S");
  const d = PO.read(XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }), "dup.xlsx");
  eq(d.totals.pos, X.pos + 1); eq(d.totals.repeatedRows, [{ order_id: "11099", po_number: "26-011099", rows: 2 }]);
  eq(d.pos.filter((p) => p.po_number === "26-011099").map((p) => p.shared_number), [2, 2], "both copies are marked, so both wait");
  refuses(() => PO.read(fs.readFileSync(path.join(F, "onrent/sunbelt_2026-09-19.csv")), "x.csv"), /not a Purchase Pro PO export/);
});
check("the Projects register: jobs, repeats dropped, campuses counted", () => {
  const d = Projects.read(fs.readFileSync(path.join(F, "projects/Projects.xlsx")), "Projects.xlsx");
  eq(d.totals.jobs, 5); eq(d.totals.repeated, 1); eq(d.totals.campuses, { BWI: 1, CDR: 1, SBN: 1, AUS: 1, "(none)": 1 });
  const bwi = d.jobs.find((j) => j.job_number === "50-60-224050"); eq(bwi.name, "110"); eq(bwi.short_name, "110"); eq(bwi.campus, "BWI"); eq(bwi.region, "Baltimore, MD");
  eq(d.jobs.find((j) => j.job_number === "50-60-226094").campus, null);
});
check("sniff tells the two apart", () => {
  eq(S.sniff(fs.readFileSync(path.join(F, "purchases", X.file)), X.file).kind, "purchase_orders");
  eq(S.sniff(fs.readFileSync(path.join(F, "projects/Projects.xlsx")), "Projects.xlsx").kind, "projects");
});
done();
