/* make_fixtures.js - writes the fixture files the tests read.
   `node tests/fixtures/make_fixtures.js`
   The rows are spelled out here with the status each one is MEANT to get, so
   expected.json is a spec the readers are held to, not a copy of their output. */
"use strict";
const fs = require("fs"), path = require("path");
const XLSX = require("../../app/vendor/xlsx.full.min.js");
const C = require("../../app/common.js");
const here = __dirname;
const write = (rel, data) => { const p = path.join(here, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); console.log("wrote", rel); };

// ---- HH2 Labor Detail --------------------------------------------------------
const DC4 = "50-60-225121", DC5 = "50-60-225120", DC7 = "50-60-226021", CAMP = "50-60-225104", OUT = "50-61-000001";
const JOBNAME = { [DC4]: "CDR DC4", [DC5]: "CDR DC5", [DC7]: "CDR DC7", [CAMP]: "CDR Campus", [OUT]: "Some Other Job" };
const EMP = {
  FB5001: "Lopez, Maria", FB5002: "Nguyen, An", FB5003: "Garcia, Luis", FB8001: "Okafor, Chidi", FB8002: "Smith, Jordan",
  FB7001: "Rivera, Sam", FB2001: "Chen, Wei", FB1001: "Patel, Dev", "TTR-10001": "Brown, Casey", FE9001: "Quinn, Avery",
};
// PayType -> PayTypeName exactly as HH2 writes them (union codes name REG/O/T/D/T; others Regular/Overtime/Doubletime)
const PAY = { "REG": "Regular", "O/T": "Overtime", "DOUBLETIME": "Doubletime", "UNION REG": "REG", "UNION O/T": "O/T",
  "UNION D/T": "D/T", "VAC": "Vacation", "HOL": "Holiday", "SICK": "Sick Time" };
const CC = { "01-02-0001": "Construction Materials DC", "01-99-0083": "CE#83 Excavating", "01-01-0001": "General Conditions", "01-09-0001": "Safety" };
const rates = JSON.parse(fs.readFileSync(path.join(here, "rates/iowa_fy27.json"), "utf8"));
const employees = JSON.parse(fs.readFileSync(path.join(here, "rates/employees.json"), "utf8"));
const PREFIX = { FB2: "#LAB-J", FB5: "#LAB-J", TTR: "#LAB-J", FB7: "#CARP-J", FB8: "#CARP-J" };
function rateFor(job, emp, payId) {
  const e = employees[emp] || {};
  const cclass = e.certified_class || PREFIX[emp.slice(0, 3)];
  const table = rates.tables[job];
  if (!cclass || !table) return null;
  const r = rates.table.find((x) => x.certified_class === cclass && x.pay_id === payId && !(x.except_tables || []).includes(table));
  return r ? r.rate_cents : null;
}
// [employee, date, job, cost code, PayType, hours, intended status, childJob?]
const R = [];
const add = (emp, d, job, cc, pt, h, status, child) => R.push({ emp, d, job, cc, pt, h, status, child: child || "" });
["01", "02", "03", "04"].forEach((d) => add("FB5001", "2026-09-" + d, DC4, "01-02-0001", "REG", 8, "priced"));
["01", "02"].forEach((d) => add("FB5001", "2026-09-" + d, DC4, "01-02-0001", "O/T", 2, "priced"));
["01", "02", "03", "04"].forEach((d) => add("FB5002", "2026-09-" + d, DC7, "01-02-0001", "UNION REG", 8, "priced"));
add("FB5002", "2026-09-03", DC7, "01-02-0001", "UNION O/T", 2, "priced");
add("FB5002", "2026-09-05", DC7, "01-02-0001", "UNION D/T", 4, "held:no rate");          // DC7 has no Laborer JM D/T
["08", "09", "10", "11"].forEach((d) => add("FB8001", "2026-09-" + d, DC5, "01-99-0083", "REG", 8, "priced"));
add("FB8001", "2026-09-12", DC5, "01-99-0083", "DOUBLETIME", 6, "priced");
["08", "09", "10", "11"].forEach((d) => add("FB8002", "2026-09-" + d, DC4, "01-02-0001", "REG", 8, "priced"));
add("FB8002", "2026-09-08", DC4, "01-02-0001", "O/T", 2, "priced");
add("FB8002", "2026-09-08", DC4, "01-02-0001", "REG", 8, "priced");                       // exact duplicate 1
["14", "15", "16", "17", "18"].forEach((d) => add("FB2001", "2026-09-" + d, CAMP, "01-01-0001", "REG", 8, "priced"));
add("FB2001", "2026-09-15", CAMP, "01-01-0001", "UNION O/T", 2, "priced");
["14", "15", "16"].forEach((d) => add("FB7001", "2026-09-" + d, DC5, "01-99-0083", "UNION REG", 8, "priced"));
add("FB7001", "2026-09-14", DC5, "01-99-0083", "UNION REG", 8, "priced");                 // exact duplicate 2
["21", "22", "23", "24"].forEach((d) => add("TTR-10001", "2026-09-" + d, DC4, "01-02-0001", "REG", 8, "priced"));
add("TTR-10001", "2026-09-21", DC4, "01-02-0001", "REG", 8, "priced");                       // exact duplicate 3
["21", "22", "23"].forEach((d) => add("FB5003", "2026-09-" + d, DC4, "01-02-0001", "REG", 8, "priced"));   // GF via employees.json
add("FB5003", "2026-09-22", DC4, "01-02-0001", "O/T", 2, "priced");
add("FB5003", "2026-09-26", DC4, "01-02-0001", "DOUBLETIME", 4, "held:no rate");         // no GF double time rate
["28", "29", "30"].forEach((d) => add("FB1001", "2026-09-" + d, DC4, "01-09-0001", "REG", 8, "held:no class"));  // FB1 has no default class
add("FE9001", "2026-09-28", OUT, "01-02-0001", "REG", 8, "held:unknown job");
add("FB5001", "2026-09-07", DC4, "01-02-0001", "HOL", 0, "held:PTO pay type");
add("FB5002", "2026-09-21", DC7, "01-02-0001", "VAC", -8, "held:PTO pay type");
add("FB8001", "2026-09-14", DC5, "01-99-0083", "SICK", 8, "held:PTO pay type");
add("FB5001", "2026-09-08", DC4, "01-02-0001", "REG", 8, "priced", DC4 + "-01");           // a ChildJob row
["09", "10", "11"].forEach((d) => add("FB5001", "2026-09-" + d, DC4, "01-02-0001", "REG", 8, "priced"));
["14", "15", "16"].forEach((d) => add("FB8002", "2026-09-" + d, DC4, "01-02-0001", "REG", 8, "priced"));
["21", "22", "23"].forEach((d) => add("FB2001", "2026-09-" + d, CAMP, "01-01-0001", "REG", 8, "priced"));

const HEAD12 = ["EmployeeNumber", "EmployeeName", "Date", "PayrollGroup", "PayrollServiceId", "Job", "JobName", "CostCode", "CostCodeName", "PayType", "PayTypeName", "Units"];
const HEAD14 = ["EmployeeNumber", "EmployeeName", "Date", "PayrollGroup", "PayrollServiceId", "Job", "JobName", "ChildJob", "ChildJobName", "CostCode", "CostCodeName", "PayType", "PayTypeName", "Units"];
const dateCell = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const GROUP = { [DC4]: "MC - CDR1 East DC4 TM (60-225121)", [DC5]: "MC - CDR1 East DC5 TM (60-225120)", [DC7]: "MC - CDR1 East DC7 (60-226021)", [CAMP]: "MC - CDR1 Campus TM (60-225104)", [OUT]: "MC - Other (61-000001)" };
function aoaOf(rows, shiftDays = 0, child = false) {
  return [child ? HEAD14 : HEAD12].concat(rows.map((r) => {
    const d = shiftDays ? C.addDays(r.d, shiftDays) : r.d;
    const base = [r.emp, EMP[r.emp], dateCell(d), GROUP[r.job], "", r.job, JOBNAME[r.job]];
    const tail = [r.cc, CC[r.cc], r.pt, PAY[r.pt], r.h];
    return child ? base.concat([r.child, r.child ? "DC4 TFO" : ""], tail) : base.concat(tail);
  }));
}
function book(aoa, sheet = "Labor Details") {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
}
write("hh2/LaborDetails_9_1_2026_to_9_30_2026.xlsx", book(aoaOf(R)));
write("hh2/LaborDetails_9_1_2026_to_9_30_2026_childjobs.xlsx", book(aoaOf(R, 0, true)));
write("hh2/bad/mismatch/LaborDetails_9_1_2026_to_9_30_2026.xlsx", book(aoaOf(R, 30)));
write("hh2/bad/renamed_sheet.xlsx", book(aoaOf(R), "Sheet1"));
write("hh2/bad/wrong_columns.xlsx", book(aoaOf(R).map((row) => row.filter((_, i) => i !== 4))));
write("hh2/bad/missing_units.xlsx", book(aoaOf(R).map((row, i) => (i === 7 ? row.slice(0, 11).concat([null]) : row))));

// the spec, independent of the reader
const byJob = {}, byStatus = {}, byReason = {};
let hoursX100 = 0, costCents = 0;
const rowStatus = [];
R.forEach((r, i) => {
  const hx = Math.round(r.h * 100);
  hoursX100 += hx;
  const j = byJob[r.job] || (byJob[r.job] = { rows: 0, hoursX100: 0, costCents: 0 });
  j.rows++; j.hoursX100 += hx;
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  if (r.status.startsWith("held:")) byReason[r.status.slice(5)] = (byReason[r.status.slice(5)] || 0) + 1;
  let cost = null;
  if (r.status === "priced") {
    const rate = rateFor(r.job, r.emp, r.pt);
    if (rate == null) throw new Error(`spec says priced but no rate: ${r.emp} ${r.job} ${r.pt}`);
    cost = C.roundHalfUp(hx * rate / 100);
    costCents += cost; j.costCents += cost;
  }
  rowStatus.push({ row_index: i + 2, employee_number: r.emp, work_date: r.d, status: r.status, cost_cents: cost });
});
const seen = new Set(); let duplicates = 0;
for (const r of R) { const k = JSON.stringify([r.emp, r.d, r.job, r.child, r.cc, r.pt, r.h]); if (seen.has(k)) duplicates++; else seen.add(k); }
write("hh2/expected.json", JSON.stringify({
  file: "LaborDetails_9_1_2026_to_9_30_2026.xlsx", childFile: "LaborDetails_9_1_2026_to_9_30_2026_childjobs.xlsx",
  range: { start: "2026-09-01", end: "2026-09-30" },
  rows: R.length, hoursX100, duplicates, employees: Object.keys(EMP).length, costCents,
  byJob, byStatus, heldByReason: byReason, held: Object.values(byReason).reduce((a, b) => a + b, 0),
  rowStatus,
}, null, 2));

// ---- On-rent reports (the page's own CSV layout) -------------------------------
const OH = ["Vendor", "Equipment #", "Contract #", "Job", "Description", "Qty", "On Rent Date", "Rate Period", "Rate", "Monthly Rent"];
const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const csv = (rows) => rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
const SB = "Sunbelt";
const wk1 = [
  [SB, "1001", "C-500", "CDR DC4", "Telehandler 10K", 1, "2026-08-03", "Monthly", "4,500.00", "4,500.00"],
  [SB, "1002", "C-500", "CDR DC4", "Scissor Lift 26'", 2, "2026-08-10", "4 Week", "900.00", ""],        // no monthly figure, never converted
  [SB, "1003", "C-501", "CDR DC5", "Generator 100kW", 1, "2026-07-15", "Monthly", "$3,200.00", "$3,200.00"],
  [SB, "1004", "C-501", "CDR DC5", "Light Tower", 3, "2026-07-15", "Monthly", "650.00", ""],             // monthly = rate x qty
  [SB, "1005", "C-502", "Campus Lot 7", "Office Trailer", 1, "2026-06-01", "Monthly", "1,200.00", "1,200.00"],
];
const wk2 = wk1.filter((r) => r[1] !== "1005").concat([[SB, "1006", "C-500", "CDR DC4", "Welder", 1, "2026-09-22", "Monthly", "400.00", "400.00"]]);
write("onrent/sunbelt_2026-09-19.csv", csv([OH].concat(wk1)));
write("onrent/sunbelt_2026-09-26.csv", csv([OH].concat(wk2)));
const URH = OH.concat(["As Of", "Liberty Owned"]);
const urGeneric = [
  ["United Rentals", "88-1", "UR-7001", "DC4 - CDR", "Boom Lift 60'", 1, "2026-09-01", "Monthly", 5100, 5100, "2026-09-26", "N"],
  ["United Rentals", "88-2", "UR-7001", "DC4 - CDR", "Fuel Cube", 1, "2026-09-01", "Weekly", 150, "", "2026-09-26", "N"],
];
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["United Rentals - Equipment On Rent"], [], URH].concat(urGeneric)), "OnRent");
  write("onrent/united_rentals_report.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
write("onrent/mcw_2026-09-26.csv", csv([OH].concat([
  ["Mission Critical Warehouse", "MCW-12", "1-SL-2201", "CDR DC4", "Liberty Stair Tower", 1, "2026-05-01", "Monthly", "2,000.00", "2,000.00"],
  ["Mission Critical Warehouse", "MCW-19", "1-SL-2201", "CDR DC4", "Liberty Break Tent", 1, "2026-05-01", "Monthly", "750.00", "750.00"],
])));
write("onrent/bad/unknown_layout.csv", csv([["Equipment", "Site", "Amount"], ["X", "DC4", "100"]]));
write("onrent/bad/mixed_vendors_2026-09-26.csv", csv([OH, wk1[0], ["Herc", "H1", "H-1", "CDR DC4", "Pump", 1, "", "Monthly", "100", "100"]]));
write("onrent/bad/sunbelt_report.csv", csv([OH].concat(wk1)));                                  // no As Of, no date in the name
write("onrent/bad/dup_identity_2026-09-26.csv", csv([OH, wk1[0], wk1[0]]));
write("onrent/bad/bad_period_2026-09-26.csv", csv([OH, [SB, "1", "C", "CDR DC4", "Thing", 1, "", "Fortnightly", "10", ""]]));
write("onrent/expected.json", JSON.stringify({
  jobMap: { "CDR DC4": "50-60-225121", "CDR DC5": "50-60-225120" },
  wk1: { file: "sunbelt_2026-09-19.csv", as_of: "2026-09-19", vendor_key: "sunbelt", lines: 5, rent_cents: 1085000, noMonthly: 1, jobRefs: ["CDR DC4", "CDR DC5", "Campus Lot 7"] },
  wk2: { file: "sunbelt_2026-09-26.csv", as_of: "2026-09-26", lines: 5, rent_cents: 1005000, noMonthly: 1, added: ["1006"], dropped: ["1005"], kept: 4 },
  dc4_wk2: { rent: 490000, tax: 34300, markup: 52430, total: 576730, lines: 3, noMonthly: 1 },
  dc5_wk2: { rent: 515000, tax: 36050, markup: 55105, total: 606155, lines: 2, noMonthly: 0 },
  ur_generic: { file: "united_rentals_report.xlsx", as_of: "2026-09-26", vendor_key: "united_rentals", lines: 2, rent_cents: 510000, noMonthly: 1 },
  mcw: { file: "mcw_2026-09-26.csv", vendor_key: "mcw", liberty_owned: 2, rent_cents: 275000 },
}, null, 2));

// ---- the three vendors' own layouts (real headers, made-up rows) --------------
const SNB_H = ["Account #", "Contract #", "Job #", "Job_Location", "Ordered By", "PO_Number", "Equipment Type", "Equipment #", "Make", "Model", "Quantity", "Est Return Date", "Day Rate", "Week Rate", "4 Week Rate", "Billed Through", "Date Rented", "Customer Name", "Customer Address1", "Customer Address2", "Customer City", "Customer State", "Customer ZIP", "Last Invoice Sequence Number", "Branch #", "Job Name", "Job Address1", "Job Address2", "Job City", "Job State", "Job ZIP", "Job Contact", "Job Phone#", "Cat-Class", "Class Name", "Serial #", "Model Year", "Replacement Value", "Parent Account #", "Total Billed", "Number of Days on Rent", "Starting Hours Meter", "Pickup Ticket Number", "Pickup Date", "Contract Line", "Pickup Ordered By", "Extra PO Info", "Exchange Date"];
function snb(o) {
  const r = Object.fromEntries(SNB_H.map((h) => [h, ""]));
  Object.assign(r, { "Account #": "1011435", "Customer Name": "LIBERTY BUILDS-SNB", "Customer City": "BOSTON", "Customer State": "MA", "Branch #": "1082", "Quantity": "1", "Day Rate": "$0.00", "Week Rate": "$0.00", "4 Week Rate": "$0.00", "Billed Through": "9/28/2026", "Date Rented": "10/27/2025", "Est Return Date": "11/24/2026", "Contract Line": "1" }, o);
  return SNB_H.map((h) => r[h]);
}
const snbRows = [
  snb({ "Contract #": "176153591", "Job #": "1 - LIBERTY CDR", "Job Name": "LIBERTY - CEDAR RAPIDS LT1", "PO_Number": "QTS DC4", "Equipment Type": "009-0040 36KW DIESEL GENERATOR", "Equipment #": "10246242", "Make": "MQ POWER", "Day Rate": "$650.00", "Week Rate": "$1,200.00", "4 Week Rate": "$2,950.00", "Cat-Class": "009-0040" }),
  snb({ "Contract #": "176153591", "Job #": "1 - LIBERTY CDR", "Job Name": "LIBERTY - CEDAR RAPIDS LT1", "PO_Number": "QTS DC4", "Equipment Type": "155-0069 #2 BANDED 5-WIRE FEMALE TAIL", "Equipment #": "BNDWR2FMTL", "Quantity": "4", "Contract Line": "2" }),
  snb({ "Contract #": "181921023", "Job #": "2 - QTS", "Job Name": "QTS DC4", "PO_Number": "01-99-1139", "Equipment Type": "056-0636 12K 55' HVAC TELEHANDLER FORKLIFT", "Equipment #": "11258433", "Make": "JCB", "Day Rate": "$825.00", "Week Rate": "$2,155.00", "4 Week Rate": "$4,775.00", "Date Rented": "3/31/2026" }),
  snb({ "Contract #": "183444399", "Job #": "3 - SBN", "Job Name": "SBN 201-204", "Equipment Type": "040-0200 SCRUBBER MICRO RIDE-ON BATTERY", "Equipment #": "Z10163410", "Day Rate": "$350.00", "Week Rate": "$940.00", "4 Week Rate": "$1,585.00", "Date Rented": "5/5/2026" }),
  snb({ "Contract #": "177114336", "Job #": "3 - SBN", "Job Name": "SBN 201-204", "Equipment Type": "154-0145 DURADECK - LINK SINGLE", "Equipment #": "DDBG4X8", "Day Rate": "$15.00", "Week Rate": "$45.00", "4 Week Rate": "$120.00", "Contract Line": "1" }),
  snb({ "Contract #": "177114336", "Job #": "3 - SBN", "Job Name": "SBN 201-204", "Equipment Type": "154-0145 DURADECK - LINK SINGLE", "Equipment #": "DDBG4X8", "Day Rate": "$15.00", "Week Rate": "$45.00", "4 Week Rate": "$120.00", "Contract Line": "2" }),
];
write("onrent/sunbelt_account_export.csv", csv([SNB_H].concat(snbRows)));
write("onrent/bad/sunbelt_other_customer.csv", csv([SNB_H].concat(snbRows.map((r) => r.map((v) => (v === "LIBERTY BUILDS-SNB" ? "ACME CO" : v))))));

// Sunbelt's company-wide export (real header of 2026-10-02): a line per contract line, no Quantity column,
// and no date of its own; Date Rented + Number of Days on Rent is the day it ran, on every line.
const SNBA_H = ["Account #", "Contract #", "Job #", "Job_Location", "Job Name", "PO_Number", "Equipment Type", "Cat-Class", "Equipment #", "Make", "Model", "Serial #", "Est Return Date", "Day Rate", "Week Rate", "4 Week Rate", "Date Rented", "Number of Days on Rent"];
function snba(o) {
  const r = Object.fromEntries(SNBA_H.map((h) => [h, ""]));
  Object.assign(r, { "Account #": "1011435", "Job_Location": "4310 76TH AVE SW, FAIRFAX", "Serial #": "N/A", "Est Return Date": "11/24/2026", "Day Rate": "$0.00", "Week Rate": "$0.00", "4 Week Rate": "$0.00", "Date Rented": "3/31/2026", "Number of Days on Rent": "185" }, o);
  return SNBA_H.map((h) => r[h]);
}
const snbaRows = [
  // serialised units: one each, the 4-week rate is the month
  snba({ "Account #": "550106", "Contract #": "173109837", "Job #": "01821", "Job_Location": "1 HARBORSIDE DR, BOSTON", "Job Name": "TERMINAL E DEMO", "PO_Number": "7050984", "Equipment Type": "012-0317 4000 WATT (EQUIVALENT) LED LIGHT CART", "Cat-Class": "012-0317", "Equipment #": "10516425", "Make": "LIND", "Model": "LE980LEDV-T4-SB", "Serial #": "LE980LEDV-T-487617", "Est Return Date": "4/1/2026", "Day Rate": "$65.00", "Week Rate": "$150.00", "4 Week Rate": "$350.00", "Date Rented": "8/20/2025", "Number of Days on Rent": "408" }),
  snba({ "Account #": "550106", "Contract #": "173338704", "Job #": "01821", "Job_Location": "1 HARBORSIDE DR, BOSTON", "Job Name": "TERMINAL E DEMO", "PO_Number": "7051010", "Equipment Type": "012-0405 4000W NARROW VERTICAL MAST LIGHT TOWER", "Cat-Class": "012-0405", "Equipment #": "10601596", "Make": "WACKER", "Model": "LTV6L", "Serial #": "WNCLTV01EPUM14140", "Est Return Date": "9/22/2025", "Day Rate": "$175.00", "Week Rate": "$385.00", "4 Week Rate": "$580.00", "Date Rented": "8/25/2025", "Number of Days on Rent": "403" }),
  // a bulk line with a rate and no serial: how many mats is not in this export, so the month is not counted
  snba({ "Account #": "633837", "Contract #": "175090343", "Job #": "1", "Job_Location": "1000 JAMES L TURNAGE BLVD, WEST PALM BEA", "Job Name": "PBIA", "PO_Number": "TURNAGE BLVD", "Equipment Type": "154-0294 MEGADECK PLUS MAT - 7X14", "Cat-Class": "154-0294", "Equipment #": "1540294", "Est Return Date": "12/26/2025", "Day Rate": "$10.00", "Week Rate": "$45.00", "4 Week Rate": "$100.00", "Date Rented": "10/3/2025", "Number of Days on Rent": "364" }),
  // a $0 accessory with no serial: its quantity is unknown too, but there is nothing to count, so it is not among the uncounted
  snba({ "Account #": "633837", "Contract #": "175090343", "Job #": "1", "Job_Location": "1000 JAMES L TURNAGE BLVD, WEST PALM BEA", "Job Name": "PBIA", "PO_Number": "TURNAGE BLVD", "Equipment Type": "154-0400 MEGADECK PLUS LOCKING PIN", "Cat-Class": "154-0400", "Equipment #": "1540400", "Est Return Date": "12/26/2025", "Date Rented": "10/3/2025", "Number of Days on Rent": "364" }),
  // the same bulk identity twice (two contract lines): numbered, both without a quantity
  snba({ "Contract #": "187028599", "Job #": "2 - QTS", "Job Name": "QTS DC4", "PO_Number": "01-99-1139", "Equipment Type": "150-0805 100' SPIDERBOX CABLE 6/4", "Cat-Class": "150-0805", "Equipment #": "SPIDER100", "Day Rate": "$42.64", "Week Rate": "$102.96", "4 Week Rate": "$267.28", "Date Rented": "7/27/2026", "Number of Days on Rent": "67" }),
  snba({ "Contract #": "187028599", "Job #": "2 - QTS", "Job Name": "QTS DC4", "PO_Number": "01-99-1139", "Equipment Type": "150-0805 100' SPIDERBOX CABLE 6/4", "Cat-Class": "150-0805", "Equipment #": "SPIDER100", "Day Rate": "$42.64", "Week Rate": "$102.96", "4 Week Rate": "$267.28", "Date Rented": "7/27/2026", "Number of Days on Rent": "67" }),
  snba({ "Contract #": "181921023", "Job #": "2 - QTS", "Job Name": "QTS DC4", "PO_Number": "01-99-1139", "Equipment Type": "056-0636 12K 55' HVAC TELEHANDLER FORKLIFT", "Cat-Class": "056-0636", "Equipment #": "11258433", "Make": "JCB", "Model": "51256", "Serial #": "JCB5AAEFG02881113", "Day Rate": "$825.00", "Week Rate": "$2,155.00", "4 Week Rate": "$4,775.00" }),
  snba({ "Contract #": "165537746", "Job #": "4 - LIBERTY BUILDS -", "Job_Location": "31100 IN-2, NEW CARLISLE", "Job Name": "SBN 201-204", "PO_Number": "71402093", "Equipment Type": "059-0570 UTILITY VEHICLE 4 SEAT 4WD GAS CAB", "Cat-Class": "059-0570", "Equipment #": "10676725", "Make": "POLARIS", "Model": "D22M4G57B4", "Serial #": "3NSM4G572NG123456", "Day Rate": "$185.00", "Week Rate": "$350.00", "4 Week Rate": "$620.00", "Date Rented": "2/17/2025", "Number of Days on Rent": "592" }),
];
write("onrent/Equipment on Rent - All Jobs.csv", csv([SNBA_H].concat(snbaRows)));
// one line's day count off by one: the lines no longer agree on the day, so the card asks
write("onrent/bad/sunbelt_all_jobs_days_disagree.csv", csv([SNBA_H].concat(snbaRows.map((r, i) => (i === 1 ? r.map((v, j) => (SNBA_H[j] === "Number of Days on Rent" ? "402" : v)) : r)))));
// the columns with codes that are not Sunbelt's
write("onrent/bad/sunbelt_all_jobs_other_codes.csv", csv([SNBA_H].concat(snbaRows.map((r) => r.map((v, j) => (SNBA_H[j] === "Cat-Class" ? "X-1" : v))))));

const HERC_H = ["Account Name", "Account Number", "Asset Utilization", "Branch", "Cat Class", "Cat Class Description", "Contract Number", "Cycle Bills", "Date Out", "Day Rate $", "Days On Rent", "Days On Rent Last Month", "Days Until Next Cycle", "Est. Charges To Date $", "Estimated Return Date", "GPS Address (Last Known)", "GPS Coordinates (Last Known)", "GPS Reporting (Last Known)", "GPS Reporting Status", "Herc Plus Name", "Herc Plus Number", "Hr/Miles", "Hr/Miles Out", "IC Description", "IC Number", "Invalid PO", "Invoice Number", "Job Address", "Job City", "Job Contact", "Job Country", "Job Location", "Job Name", "Job Number", "Job State", "Job Zip", "Last Bill Date", "License Plate", "Make", "Major Category", "Odometer", "Model", "Month", "Month Rate $", "Next Bill Date", "On Pick Up Ticket", "Ordered By", "Overdue Status", "Purchase Order", "Equipment Quantity", "Report Date", "Serial Number", "Start Date", "Start Time", "Total Est. Rental Charges $", "Total Rental Spend $", "Vendor", "Vin", "Week Rate $", "Pickup Ticket", "Scheduled Time For Pickup", "Total Hours Used on Contract (180 Days)"];
function herc(o) {
  const r = Object.fromEntries(HERC_H.map((h) => [h, "-"]));
  Object.assign(r, { "Account Name": "LIBERTY COMPANIES LLC", "Account Number": "2863499", "Vendor": "Herc Rentals", "Report Date": "10/01/2026", "Equipment Quantity": 1, "Job Name": "DC BUILDING 201", "Job Number": "DC BUILDING 201", "Date Out": "03/26/2026", "Day Rate $": "165.00", "Week Rate $": "415.00", "Month Rate $": "720.00", "Estimated Return Date": "08/28/2026", "Purchase Order": "50-60-225009" }, o);
  return HERC_H.map((h) => r[h]);
}
const hercRows = [
  herc({ "Contract Number": "36462466", "Invoice Number": "36462466-001", "Cat Class": "510-1055", "Cat Class Description": "LIGHT TOWER VERT MAST LED TRAILER", "IC Number": "9253354", "IC Description": "LIGHT TOWER VERT MAST LED TRAILER" }),
  herc({ "Contract Number": "36462466", "Invoice Number": "36462466-002", "Cat Class": "510-1055", "Cat Class Description": "LIGHT TOWER VERT MAST LED TRAILER", "IC Number": "9253354", "IC Description": "LIGHT TOWER VERT MAST LED TRAILER" }),
  herc({ "Contract Number": "36693862", "Invoice Number": "36693862-001", "Cat Class": "460-1045", "Cat Class Description": "TELEHANDLER 8000LB 42-44FT LIFT CAB", "Serial Number": "138385", "IC Number": "800552777", "Day Rate $": "535.00", "Week Rate $": "615.00", "Month Rate $": "1100.00", "Job Name": "DC BUILDING 202", "Job Number": "DC BUILDING 202" }),
  herc({ "Contract Number": "36840216", "Invoice Number": "36840216-001", "Cat Class": "925-3354", "Cat Class Description": "DEHUMIDIFIER LGR 130-160 PPD ELEC", "IC Number": "9253354", "Equipment Quantity": 4, "Day Rate $": "50.00", "Week Rate $": "20.00", "Month Rate $": "50.00" }),
];
{
  const wb = XLSX.utils.book_new();
  const totals = HERC_H.map(() => ""); totals[0] = "Totals"; totals[HERC_H.indexOf("Month Rate $")] = 2740;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], [], HERC_H, totals].concat(hercRows)), "Sheet 1");
  write("onrent/Equipment_On_Rent_Summary-06-24-2026_175716.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([[], [], [], HERC_H, totals].concat(hercRows.map((r) => r.map((v) => (v === "Herc Rentals" ? "Other Co" : v))))), "Sheet 1");
  write("onrent/bad/herc_other_vendor.xlsx", XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }));
}

const UR_H = ["BranchNumber", "ContractNumber", "EquipmentNumber", "EquipmentMake", "EquipmentModel", "EquipmentSerialNum", "EquipmentCategory", "EquipmentClass", "EqpDescription", "DateOut", "TimeOut", "EstimatedReturnDate", "EstimatedReturnTime", "CallOffNumber", "LastBilledDate", "PickupDate", "PickupTime", "Quantity", "MeterCode", "MeterReadingOut", "Jobsite ID", "JobName", "PurchaseOrderNumber", "DailyRate", "CurrencyCode", "WeeklyRate", "MonthlyRate", "AccountNumber", "AccountAddress1", "AccountName", "AccountAddress2", "AccountCity", "AccountState", "AccountZip", "OrderedBy", "LastServiceDate", "ServiceMeterReading", "LeniencyDate", "Request#", "RequestBy", "Approver", "AcctDesc1", "AcctCode1", "AcctDesc2", "AcctCode2", "AcctDesc3", "AcctCode3", "AcctDesc4", "AcctCode4", "AcctDesc5", "AcctCode5", "AcctDesc6", "AcctCode6", "ReqDesc1", "ReqCode1", "ReqDesc2", "ReqCode2", "ReqDesc3", "ReqCode3", "ReqDesc4", "ReqCode4", "Equipment Source", "Days on Rent", "TotalAmountBilled", "JobZip"];
function ur(o) {
  const r = Object.fromEntries(UR_H.map((h) => [h, ""]));
  Object.assign(r, { BranchNumber: "HF0", EquipmentSerialNum: "                    ", Quantity: 1, "Jobsite ID": "                    ", JobName: "CDR-SCCI-DC4                  ", CurrencyCode: "USD", AccountNumber: 992997, AccountName: "LIBERTY BUILDS CDR SUFFOLK", "Equipment Source": "UNITED RENTALS", DateOut: new Date(2026, 7, 21), EstimatedReturnDate: new Date(2026, 9, 16), LastBilledDate: new Date(2026, 8, 28), AcctDesc1: "JOB NAME", AcctCode1: "SUFFOLK", AcctDesc2: "JOB #", AcctCode2: "50-60-225121", JobZip: "52404" }, o);
  return UR_H.map((h) => r[h]);
}
const urRows = [
  ur({ ContractNumber: 266450781, EquipmentNumber: "11334445                      ", EquipmentMake: "JLG", EquipmentCategory: 310, EquipmentClass: 1600, EqpDescription: "TELEHANDLER 10K 55'                     ", DailyRate: 525, WeeklyRate: 1450, MonthlyRate: 2900 }),
  ur({ ContractNumber: 257536984, EquipmentNumber: "                              ", EquipmentCategory: 535, EquipmentClass: 2020, EqpDescription: "HOSE 3X20 PVC SUCTION - CAMLOCK         ", Quantity: 2, DailyRate: 18, WeeklyRate: 28, MonthlyRate: 75, "Equipment Source": "                              " }),
  ur({ ContractNumber: 257436520, EquipmentNumber: "6002410                       ", EquipmentCategory: 920, EquipmentClass: 100, EqpDescription: "FRAME SCAFFOLD 5X5                      ", JobName: "CDR-SCCI-DC4.DC5              ", DailyRate: 2, WeeklyRate: 6, MonthlyRate: 20 }),
  ur({ ContractNumber: 257436520, EquipmentNumber: "6002410                       ", EquipmentCategory: 920, EquipmentClass: 100, EqpDescription: "FRAME SCAFFOLD 5X5                      ", JobName: "CDR-SCCI-DC4.DC5              ", DailyRate: 2, WeeklyRate: 6, MonthlyRate: 20 }),
  ur({ ContractNumber: 257436520, EquipmentNumber: "6002410                       ", EquipmentCategory: 920, EquipmentClass: 100, EqpDescription: "FRAME SCAFFOLD 5X5                      ", JobName: "CDR-SCCI-DC4.DC5              ", DailyRate: 2, WeeklyRate: 6, MonthlyRate: 20 }),
  ur({ ContractNumber: 267620007, EquipmentNumber: "PV1689647                     ", EquipmentCategory: 300, EquipmentClass: 4200, EqpDescription: "BOOM LIFT 60' 4WD                       ", JobName: "CDR E1 - LOENBRO              ", AccountName: "LIBERTY BUILDS CDR", AcctDesc1: "SUB NAME", AcctCode1: "LOENBRO", AcctDesc2: "LIBERTY JOB #", AcctCode2: "50-63-125007", DailyRate: 600, WeeklyRate: 1500, MonthlyRate: 3675 }),
  ur({ ContractNumber: 268000001, EquipmentNumber: "11999999                      ", EquipmentCategory: 500, EquipmentClass: 1000, EqpDescription: "LIGHT TOWER                             ", JobName: "CDR-SCCI-DC4                  ", DailyRate: 90, WeeklyRate: 195, MonthlyRate: 485, PickupDate: new Date(2026, 8, 24) }),
];
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([UR_H].concat(urRows), { cellDates: true }), "Sheet 1");
  write("onrent/Equipment_On_Rent_-_All_Jobs_2026-09-26-08.00.00.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }));
}
const ES_H = ["Product", "Devices", "Status", "Avg. Daily Utilization", "Class", "Make", "Model", "Qty", "Upcoming", "Rental ID", "Order ID", "Location Name", "Location Address", "Job", "Phase", "PO #", "Ordered By", "Approved By", "Sub-Renter Company", "Sub-Renter Requester", "Sub-Renter PO", "Next Billing", "Shift Type", "Start Date", "End Date", "Duration (days)", "Price Per Day ($)", "Price Per Week ($)", "Price Per Month ($)", "Salesperson", "Rental Branch", "Vendor", "Provider"];
function es(o) {
  const r = Object.fromEntries(ES_H.map((h) => [h, ""]));
  Object.assign(r, { Status: "On-rent", Qty: 1, "Location Name": "Cedar Rapids", "Location Address": "4310 76th Ave SW, Cedar Rapids, IA, 52404", "Sub-Renter Company": "'--", "Sub-Renter Requester": "'--", "Sub-Renter PO": "'--", "Shift Type": "Single", "Next Billing": "9/2/2026", "Start Date": "8/5/2026", "End Date": "1/20/2027", "Duration (days)": 168, Vendor: "EquipmentShare", Provider: "EquipmentShare", "Rental Branch": "De Witt, IA - Core Solutions" }, o);
  return ES_H.map((h) => r[h]);
}
const esRows = [
  es({ Product: "#748680", Class: "Rental Equipment Trailer", Make: "PACE AMERICAN", Model: "Outback DLX", "Rental ID": 4229608, "Order ID": 7364017, "PO #": "26-010424", "Price Per Day ($)": 150, "Price Per Week ($)": 450, "Price Per Month ($)": 895 }),
  es({ Product: "#742475", Class: "Pallet Jack 4,000 - 4,500 Lb Electric", Make: "BIG JOE", Model: "LPT45", "Rental ID": 4186835, "Order ID": 7303315, "PO #": "26-010257", "Price Per Day ($)": 134, "Price Per Week ($)": 336, "Price Per Month ($)": 671 }),
  es({ Product: "500-1203", Class: "CABLE #2 BANDED 5 5' CAMLOCK", Qty: 8, "Rental ID": 2872019, "Order ID": 5406721, "Location Name": "PDX-202", "Price Per Day ($)": 4, "Price Per Week ($)": 9, "Price Per Month ($)": 28 }),
  es({ Product: "#530093", Class: "Light Plant 2.4 - 4kW - LED", Make: "WACKER NEUSON", Model: "LTT4", "Rental ID": 3231953, "Order ID": 5966358, "Location Name": "PDX-203", "Shift Type": "Double", "Price Per Day ($)": 154.5, "Price Per Week ($)": 348, "Price Per Month ($)": 781.5 }),
  es({ Product: "#111376", Status: "Off-rent", Class: "Pallet Jack 4,000 - 4,500 Lb Electric", "Rental ID": 4150561, "Order ID": 7254039, "Price Per Day ($)": 147, "Price Per Week ($)": 368, "Price Per Month ($)": 735 }),
];
write("onrent/EquipShare_rentals-export_9.4.26.csv", csv([ES_H].concat(esRows)));
const X = JSON.parse(fs.readFileSync(path.join(here, "onrent/expected.json"), "utf8"));
Object.assign(X, {
  sunbelt: { file: "sunbelt_account_export.csv", vendor_key: "sunbelt", layout: "sunbelt", lines: 6, rent_cents: 955000, repeats: 1, noMonthly: 0,
    jobRefs: ["LIBERTY - CEDAR RAPIDS LT1", "QTS DC4", "SBN 201-204"], period: "4week", seqs: [1, 1, 1, 1, 1, 2] },
  herc: { file: "Equipment_On_Rent_Summary-06-24-2026_175716.xlsx", vendor_key: "herc", layout: "herc", lines: 4, rent_cents: 274000, repeats: 1, as_of: "2026-10-01", skipped: 1,
    equipment: ["9253354", "9253354", "138385", "9253354"], seqs: [1, 2, 1, 1] },
  ur: { file: "Equipment_On_Rent_-_All_Jobs_2026-09-26-08.00.00.xlsx", vendor_key: "united_rentals", layout: "united_rentals", lines: 7, rent_cents: 727000, repeats: 1, noUnit: 1, as_of: "2026-09-26",
    equipment: ["11334445", "535-2020", "6002410", "6002410", "6002410", "PV1689647", "11999999"], jobRefs: ["CDR E1 - LOENBRO", "CDR-SCCI-DC4", "CDR-SCCI-DC4.DC5"] },
  urJobMap: { "CDR-SCCI-DC4": "50-60-225121" },
  sunbelt_all: { file: "Equipment on Rent - All Jobs.csv", vendor_key: "sunbelt", layout: "sunbelt_all_jobs", lines: 8, rent_cents: 632500, noMonthly: 3, qtyUnknown: 3, repeats: 1, accounts: 3,
    as_of: "2026-10-02", jobRefs: ["PBIA", "QTS DC4", "SBN 201-204", "TERMINAL E DEMO"],
    equipment: ["10516425", "10601596", "1540294", "1540400", "SPIDER100", "SPIDER100", "11258433", "10676725"], seqs: [1, 1, 1, 1, 1, 2, 1, 1],
    monthly: [35000, 58000, null, 0, null, null, 477500, 62000] },
  es: { file: "EquipShare_rentals-export_9.4.26.csv", vendor_key: "equipmentshare", layout: "equipmentshare", lines: 4, rent_cents: 257150, as_of: "2026-09-04", notCounted: { "Off-rent": 1 },
    equipment: ["#748680", "#742475", "500-1203", "#530093"], jobRefs: ["Cedar Rapids", "PDX-202", "PDX-203"] },
  ur_dc4: { lines: 3, rent: 353500, tax: 24745, markup: 37825, total: 416070 },
});
write("onrent/expected.json", JSON.stringify(X, null, 2));

// ---- a Sage rate table export (real headers, made-up rows) -----------------------
const SAGE_H = ["Rate Table", "Rate Table Description", "Cost Type", "Rate Table", "Effective Date", "Unit Cost", "Unit Price", "Job", "Extra", "Cost Code", "Category", "Employee", "Certified Class", "Department", "Union", "Union Local", "Union Class", "PR Slip #", "Pay ID", "Pay Type", "Pass Through Cost", "Non-Billable"];
const sage = (code, desc, date, cclass, payId, price, extra) => { const r = Object.fromEntries(SAGE_H.map((h) => [h, "   "])); Object.assign(r, { "Rate Table": code, "Rate Table Description": desc, "Cost Type": "Labor   ", "Effective Date": " " + date + "   ", "Unit Cost": 0, "Unit Price": price, "Certified Class": cclass + "   ", "Pay ID": payId + "   ", "Pay Type": "*   " }, extra || {}); return SAGE_H.map((h) => r[h]); };
const sageRows = [];
for (const [cls, reg, ot, dt] of [["#LAB-J", 87.25, 120, 149.5], ["#LAB-GF", 108.25, 146.25, 184.5], ["#CARP-J", 98.5, 127.5, 156.5], ["#SUP", 125, 125, 125]]) {
  for (const [pid, p] of [["UNION REG", reg], ["UNION O/T", ot], ["UNION D/T", dt]]) sageRows.push(sage("#225121", "CDR1 East DC4", "6-01-2025", cls, pid, p));
  for (const [pid, p] of [["UNION REG", reg + 3], ["UNION O/T", ot + 4], ["UNION D/T", dt + 5]]) sageRows.push(sage("#225121", "CDR1 East DC4", "6-01-2026", cls, pid, p));
}
for (const [pid, p] of [["UNION REG", 66.75], ["UNION O/T", 94], ["UNION D/T", 121.25]]) sageRows.push(sage("#224050", "BWI", "6-01-2025", "#CARP-J", pid, p));
sageRows.push(sage("#224050", "BWI", "6-01-2025", "*", "*", 0, { "Pay Type": "Not used", "Non-Billable": "X" }));
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([SAGE_H].concat(sageRows)), "Sheet1");
  write("rates/Sage_Rate_Tables_2026.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  write("rates/sage_expected.json", JSON.stringify({ file: "Sage_Rate_Tables_2026.xlsx", tables: 2, rates: 27, skipped: 1,
    codes: ["#225121", "#224050"], dc4: { classes: ["#CARP-J", "#LAB-GF", "#LAB-J", "#SUP"], effectiveDates: ["2025-06-01", "2026-06-01"], rates: 24 },
    labJReg2025: { from: "2025-06-01", to: "2026-06-01", cents: 8725 }, labJReg2026: { from: "2026-06-01", to: null, cents: 9025 } }, null, 2));
}

// ---- Purchase Pro's PO table (real headers, made-up rows) and a Projects register ---
const PO_H = ["OrderID", "Cor", "Purchase_Order", "OrdDate", "OrdType", "Supplier", "Supplier_Name", "Supplier_Contact", "Supplier_QuoteOrder", "Job", "Brief_Description_of_Work", "Requested_Delivery_Date", "Comments", "Actual_Delivery_Date", "Cancelled", "Exported", "SageTotalCommitted"];
const po = (id, poNo, date, type, code, name, job, desc, cancelled, exported, amt, quoteRef) => [id, "FB", poNo, dateCell(date), type, code, name, "", quoteRef || "", job, desc, dateCell(C.addDays(date, 3)), "", "", cancelled, exported, amt];
const poRows = [
  po(11099, "26-011099", "2026-09-06", "Material", "502674", "Environmental Alternatives LLC", DC4, "NONBILLABLE - KEYBOX AND TOOLS", false, true, 312.5),
  po(11098, "Q-26-011098", "2026-08-03", "Material_Quote", "501033", "HDS White Cap Const Supply", CAMP, "CE #88 trailer relocation", false, false, ""),
  po(11097, "26-011097", "2026-09-14", "Rental", "UNI100", "United Rentals (North America)", CAMP, "Temp fence panels DC7", true, false, 900),
  po(11096, "26-011096", "2026-09-14", "Rental", "SUN050", "Sunbelt Rentals", CAMP, "CE 71 weather impact - ground thaw blankets", false, true, 1270.78, "267298157"),
  po(11095, "26-011095", "2026-09-18", "Material", "501033", "HDS White Cap Const Supply", DC5, "BREAK TENT 01-90-0007 AUS 5", false, true, 14069.96),
  po(11094, "26-011094", "2026-09-20", "Material", "500221", "Uline Shipping Supplies", DC4, "tape and bags", false, false, ""),
  po(11093, "26-011093", "2026-08-28", "Material", "500300", "Colony Hardware Supply Co Inc.", DC4, "anchors", false, true, 2000),
  po(11092, "26-011092", "2026-09-02", "Rental", "WSI001", "Williams Scotsman, Inc.", "50-63-125001", "office trailer", false, true, 3600),
];
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PO_H].concat(poRows), { cellDates: true }), "Copy of Tbl_PO1");
  write("purchases/Tbl_PO1_2026-09-25.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }));
  write("purchases/expected.json", JSON.stringify({ file: "Tbl_PO1_2026-09-25.xlsx", as_of: "2026-09-25", pos: 8, counted: 5, committed_cents: 2125324, cancelled: 1, quotes: 1, noAmount: 1,
    byType: { Material: 1638246, Rental: 487078 }, jobs: [DC4, DC5, CAMP, "50-63-125001"].sort(), dc4Sep: 31250, nbDc4: 31250, dc5Sep: 1406996 }, null, 2));
}
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Job #", "Project Name", "Campus", "Region"], ["50-60-224050", 110, "BWI", "Baltimore, MD"], ["50-60-225121", "DC4", "CDR E1", "Cedar Rapids, IA"],
    ["50-60-224050", 110, "BWI", "Baltimore, MD"], ["50-60-225008", 204, "SBN", "South Bend, IN"], ["60-26-100381", "AUS 4&5 Stampede (b)", "AUS", "Temple, TX"], ["50-60-226094", "Project Gravity", null, null]]), "Projects");
  write("projects/Projects.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

// ---- Sage's Job Cost To Date export (real headers and spellings, made-up rows) ---
const JCTD_H = ["Job", "Job Description", "Extra", "Cost Code", "Description", "Cat", "Transaction Type", "Period End Date", "Transaction Date", "Accounting Date", "Date Stamp", "Units", "Unit Cost", "Amount", "Pay ID", "PR Tax ID", "Fringe ID", "Employee", "JC_EE_UNION_ID", "JC_EE_UNION_LOC", "JC_EE_UNION_CLASS", "Batch", "Vendor", "Name", "Invoice", "Standard Item", "Description"];
const pad = (v) => (v == null || v === "" ? "   " : String(v) + "   ");
const stampOf = (d) => { const x = C.addDays(d, 7); return `${+x.slice(5, 7)}-${x.slice(8, 10)}-${x.slice(0, 4)}`; };
// one transaction: cat, type, date, amount, {code, codeName, vendor, name, inv, desc, units, pay, emp, pe}
const jrow = (cat, tt, td, amt, o = {}) => [pad(o.job || DC4), pad(o.jobName || "CDR1 East DC4"), pad(""), pad(o.code || "01-02-0001"), pad(o.codeName || "Construction Materials DC4"), pad(cat), pad(tt),
  pad(o.pe || ""), pad(td), pad(C.addDays(td, 9)), pad(stampOf(td)), o.units == null ? 1 : o.units, o.uc == null ? 0 : o.uc, amt, pad(o.pay || ""), pad(""), pad(""), pad(o.emp || ""), pad(""), pad(""), pad(""),
  pad(o.batch || "88441"), pad(o.vendor || ""), pad(o.name || ""), pad(o.inv || ""), pad(""), pad(o.desc || "")];
const SUN = { vendor: "SUN050", name: "Sunbelt Rentals" }, UNI = { vendor: "UNI100", name: "United Rentals (North America)" }, MOB = { vendor: "MOB200", name: "Mobile Air & Power Rentals" },
  ALT = { vendor: "ALT100", name: "Altorfer Inc" }, AMP = { vendor: "AMP100", name: "Amphibious Medics" }, WES = { vendor: "WES100", name: "Westdale Hotel2, LLC" },
  ULI = { vendor: "ULI100", name: "Uline Shipping Supplies" }, BAD = { vendor: "BAD100", name: "Badger Daylighting Corp" }, STA = { vendor: "STA100", name: "Star Equipment Ltd." }, GRA = { vendor: "GRA100", name: "Grainger Inc." };
const jctdRows = [];
// payroll: the Description is the employee's name; it must leave the row
jctdRows.push(jrow("LBR", "PR cost", "2026-09-01", 254.56, { code: "01-01-0001", codeName: "General Labor/Clean-Up DC4", units: 8, uc: 31.82, pay: "UNION REG", emp: "FB5001", desc: "Lopez; Maria", pe: "2026-09-06" }));
jctdRows.push(jrow("LBR", "PR cost", "2026-09-02", 254.56, { code: "01-01-0001", codeName: "General Labor/Clean-Up DC4", units: 8, uc: 31.82, pay: "UNION REG", emp: "FB5001", desc: "Lopez; Maria", pe: "2026-09-06" }));
jctdRows.push(jrow("LBR", "PR cost", "2026-09-01", 312, { code: "01-02-0001", units: 8, uc: 39, pay: "UNION REG", emp: "FB8001", desc: "Okafor; Chidi", pe: "2026-09-06" }));
jctdRows.push(jrow("PRT", "PR cost", "2026-09-01", 61.2, { code: "01-02-0001", units: 0, uc: 0, pay: "", emp: "FB8001", desc: "Okafor; Chidi", pe: "2026-09-06" }));
// Sunbelt, a cycle-billed frame: on a feed
[["2026-06-08", "178804573-0007"], ["2026-07-06", "178804573-0008"], ["2026-08-03", "178804573-0009"]].forEach(([d, inv]) => jctdRows.push(jrow("EQU", "AP cost", d, 6023.03, Object.assign({ code: "01-28-0001", codeName: "Scaffold DC4", inv, desc: "Rental Frame" }, SUN))));
// United Rentals, four modular sections a month, and a generator: on a feed
[["2026-07-01", "252427417-020"], ["2026-08-01", "252427417-021"], ["2026-09-01", "252427417-022"]].forEach(([d, inv]) => { for (let k = 0; k < 4; k++) jctdRows.push(jrow("EQU", "AP cost", d, 3023.12, Object.assign({ code: "01-06-0001", codeName: "Office Trailers DC4", inv, desc: "MODULAR BLDG FAST MIDDLE" }, UNI))); });
[["2026-06-03", "259208337-001"], ["2026-07-03", "259208337-002"], ["2026-08-03", "259208337-003"]].forEach(([d, inv]) => jctdRows.push(jrow("EQU", "AP cost", d, 7538, Object.assign({ code: "01-99-0074", codeName: "CE#74 Temp Power DC4", inv, desc: "GENERATOR 400-499 KVA" }, UNI))));
// Mobile Air: a contract minimum every month, no feed
[["2026-07-29", "218084"], ["2026-08-19", "221281"]].forEach(([d, inv]) => jctdRows.push(jrow("EQU", "AP cost", d, 493463.94, Object.assign({ code: "01-99-0074", codeName: "CE#74 Temp Power DC4", inv, desc: "CONTRACT MIN5097539" }, MOB))));
// Altorfer: a generator from the dealer, with a reversal pair on the first invoice (nets to one charge), then two more months
jctdRows.push(jrow("EQU", "AP cost", "2026-02-26", 29117.38, Object.assign({ code: "01-30-0048", codeName: "CE#48 Generators", inv: "C6452302", desc: "26-004809" }, ALT)));
jctdRows.push(jrow("EQU", "AP cost", "2026-02-26", -29117.38, Object.assign({ code: "01-30-0048", codeName: "CE#48 Generators", inv: "C6452302", desc: "(Rev)26-004809" }, ALT)));
jctdRows.push(jrow("EQU", "AP cost", "2026-02-26", 29117.38, Object.assign({ code: "01-30-0048", codeName: "CE#48 Generators", inv: "C6452302", desc: "26-004809" }, ALT)));
jctdRows.push(jrow("EQU", "AP cost", "2026-03-27", 29117.38, Object.assign({ code: "01-30-0048", codeName: "CE#48 Generators", inv: "C6452303", desc: "26-004809" }, ALT)));
jctdRows.push(jrow("EQU", "AP cost", "2026-04-28", 29117.38, Object.assign({ code: "01-30-0048", codeName: "CE#48 Generators", inv: "C6452304", desc: "26-004809" }, ALT)));
// Liberty's own two Polaris, charged to the job monthly (IV cost, no vendor)
[["2026-07-17", "06/29-07/26"], ["2026-08-17", "07/27-08/23"], ["2026-09-17", "08/24-09/20"]].forEach(([d, span]) => { for (let k = 0; k < 2; k++) jctdRows.push(jrow("EQU", "IV cost", d, 1850, { code: "01-13-0001", codeName: "UTV Rentals DC4", desc: "POLARIS RANGER C~1M" + span })); });
// recurring but not equipment: medics (SUB), lodging (OTH); not candidates
jctdRows.push(jrow("SUB", "AP cost", "2026-07-16", 24284.42, Object.assign({ code: "01-14-0001", codeName: "Site Medic DC4", inv: "27822", desc: "CDR DC4 6/1-6/30/26" }, AMP)));
jctdRows.push(jrow("SUB", "AP cost", "2026-08-18", 27928.71, Object.assign({ code: "01-14-0001", codeName: "Site Medic DC4", inv: "27961", desc: "CDR DC4 7/1-7/31/26" }, AMP)));
jctdRows.push(jrow("OTH", "AP cost", "2026-07-28", 5703, Object.assign({ code: "01-05-0010", codeName: "Per Diem / Lodging", inv: "1785256148", desc: "CDR" }, WES)));
jctdRows.push(jrow("OTH", "AP cost", "2026-08-28", 5703, Object.assign({ code: "01-05-0010", codeName: "Per Diem / Lodging", inv: "1787954374", desc: "CDR" }, WES)));
// one-offs, a gap of two months, and three of one thing in a month: not candidates
jctdRows.push(jrow("MAT", "AP cost", "2026-08-13", 228.4, Object.assign({ inv: "211931338", desc: "Freight" }, ULI)));
jctdRows.push(jrow("MAT", "AP cost", "2026-08-25", 609.9, Object.assign({ inv: "212406108", desc: "Clean Mat" }, ULI)));
jctdRows.push(jrow("EQU", "AP cost", "2026-07-22", 7639.27, Object.assign({ code: "01-99-0075", codeName: "CE#75 Hydrovac", inv: "3085896", desc: "26-006760" }, BAD)));
jctdRows.push(jrow("EQU", "AP cost", "2026-01-14", 11299.2, Object.assign({ code: "01-99-0075", codeName: "CE#75 Hydrovac", inv: "02566691", desc: "26-004846" }, STA)));
jctdRows.push(jrow("EQU", "AP cost", "2026-04-14", 11299.2, Object.assign({ code: "01-99-0075", codeName: "CE#75 Hydrovac", inv: "02567100", desc: "26-004846" }, STA)));
["9042632183", "9042632184", "9042632185"].forEach((inv) => jctdRows.push(jrow("EQU", "AP cost", "2026-08-13", 28.78, Object.assign({ inv, desc: "Saw Blade" }, GRA))));
jctdRows.push(jrow("EQU", "AP cost", "2026-09-14", 28.78, Object.assign({ inv: "9050000001", desc: "Saw Blade" }, GRA)));
// a journal entry: ignored by the detector, kept by the reader
jctdRows.push(jrow("OTH", "JC cost", "2025-10-01", 1866.89, { units: 0, batch: "83352", desc: "Amex SEP2025" }));
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([JCTD_H].concat(jctdRows)), "Sheet1");
  write("jctd/CDR_DC4_9-29-26.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const sum = jctdRows.reduce((t, r) => t + Math.round(r[13] * 100), 0);
  const byType = {}; for (const r of jctdRows) { const k = r[6].trim(); byType[k] = (byType[k] || 0) + 1; }
  write("jctd/expected.json", JSON.stringify({ file: "CDR_DC4_9-29-26.xlsx", job: DC4, rows: jctdRows.length, amount_cents: sum, byType, negatives: 1, as_of: "2026-09-29", range: { start: "2025-10-01", end: "2026-09-17" },
    employees: { FB5001: "Lopez; Maria", FB8001: "Okafor; Chidi" }, latestStamp: stampOf("2026-09-17"),
    // the candidates the detector MUST find, largest monthly first: [vendor_name, amount_cents, units, months, on_feed, liberty_owned, current]
    candidates: [
      ["Mobile Air & Power Rentals", 49346394, 1, ["2026-07", "2026-08"], false, false, true],
      ["Altorfer Inc", 2911738, 1, ["2026-02", "2026-03", "2026-04"], false, false, false],
      ["United Rentals (North America)", 302312, 4, ["2026-07", "2026-08", "2026-09"], true, false, true],
      ["United Rentals (North America)", 753800, 1, ["2026-06", "2026-07", "2026-08"], true, false, true],
      ["Sunbelt Rentals", 602303, 1, ["2026-06", "2026-07", "2026-08"], true, false, true],
      ["Liberty-owned (internal)", 185000, 2, ["2026-07", "2026-08", "2026-09"], false, true, true],
    ],
    notCandidates: ["Amphibious Medics", "Westdale Hotel2, LLC", "Uline Shipping Supplies", "Badger Daylighting Corp", "Star Equipment Ltd.", "Grainger Inc."],
    summary: { total: 6, off_feed: 3, on_feed: 3, off_feed_monthly_cents: 49716394, on_feed_monthly_cents: 1209248 + 753800 + 602303, current: 5, liberty_owned: 1 } }, null, 2));
}

// ---- site services: a United Rentals export with the restrooms, the sleeves of two modular buildings, offices, containers (DC5),
//      beside the DC4 lines above; and DC5's Job Cost To Date with a hauler that invoices one pull at a time and one that bills a lump
const site = (o) => ur(Object.assign({ JobName: "CDR-SCCI-DC5                  ", AcctCode2: DC5, EquipmentNumber: "                              ", DateOut: new Date(2026, 5, 10), EstimatedReturnDate: new Date(2026, 11, 20) }, o));
let unit = 12000000;
const u = () => String(++unit).padEnd(30);
const siteRows = [
  // one 6-plex and one 4-plex, a lone front, two double-wides, three offices
  site({ ContractNumber: 270000001, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1100, EqpDescription: "MODULAR BLDG FAST FRONT", MonthlyRate: 3023.12 }),
  site({ ContractNumber: 270000001, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1200, EqpDescription: "MODULAR BLDG FAST MIDDLE", MonthlyRate: 3023.12 }),
  site({ ContractNumber: 270000001, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1200, EqpDescription: "MODULAR BLDG FAST MIDDLE", MonthlyRate: 3023.12 }),
  site({ ContractNumber: 270000001, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1200, EqpDescription: "MODULAR BLDG FAST MIDDLE", MonthlyRate: 3023.12 }),
  site({ ContractNumber: 270000001, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1200, EqpDescription: "MODULAR BLDG FAST MIDDLE", MonthlyRate: 3023.12 }),
  site({ ContractNumber: 270000001, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1300, EqpDescription: "MODULAR BLDG FAST REAR W/2RR", MonthlyRate: 3023.14 }),
  site({ ContractNumber: 270000002, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1100, EqpDescription: "MODULAR BLDG FAST FRONT", MonthlyRate: 2438.07 }),
  site({ ContractNumber: 270000002, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1200, EqpDescription: "MODULAR BLDG FAST MIDDLE", MonthlyRate: 2438.07 }),
  site({ ContractNumber: 270000002, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1200, EqpDescription: "MODULAR BLDG FAST MIDDLE", MonthlyRate: 2438.07 }),
  site({ ContractNumber: 270000002, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1300, EqpDescription: "MODULAR BLDG FAST REAR W/1RR", MonthlyRate: 2438.07 }),
  site({ ContractNumber: 270000003, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1100, EqpDescription: "MODULAR BLDG FAST FRONT", MonthlyRate: 3023.12 }),
  site({ ContractNumber: 270000004, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 2460, EqpDescription: "MODULAR BLDG 24X60 W/2-RR", MonthlyRate: 3390 }),
  site({ ContractNumber: 270000005, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 2460, EqpDescription: "MODULAR BLDG 24X60 W/2-RR", MonthlyRate: 3390 }),
  site({ ContractNumber: 270000006, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1260, EqpDescription: "OFFICE TRAILER 12X60 W/RR", MonthlyRate: 1250 }),
  site({ ContractNumber: 270000006, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1260, EqpDescription: "OFFICE TRAILER 12X60 W/RR", MonthlyRate: 1250 }),
  site({ ContractNumber: 270000007, EquipmentNumber: u(), EquipmentCategory: 740, EquipmentClass: 1260, EqpDescription: "OFFICE TRAILER 12X60 W/RR", MonthlyRate: 1250 }),
  site({ ContractNumber: 270000006, EquipmentCategory: 740, EquipmentClass: 9010, EqpDescription: "OFFICE TRAILER STEPS", Quantity: 5, MonthlyRate: 45 }),
  site({ ContractNumber: 270000008, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8200, EqpDescription: "GLO/OFFICE CONTAINER 8X20X8'6\"", MonthlyRate: 560 }),
  site({ ContractNumber: 270000008, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8200, EqpDescription: "GLO/OFFICE CONTAINER 8X20X8'6\"", MonthlyRate: 560 }),
  // storage containers
  site({ ContractNumber: 270000009, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8400, EqpDescription: "CONTAINER 8X40X9'6\" HI CUBE", MonthlyRate: 185 }),
  site({ ContractNumber: 270000009, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8400, EqpDescription: "CONTAINER 8X40X9'6\" HI CUBE", MonthlyRate: 185 }),
  site({ ContractNumber: 270000009, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8400, EqpDescription: "CONTAINER 8X40X9'6\" HI CUBE", MonthlyRate: 185 }),
  site({ ContractNumber: 270000009, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8400, EqpDescription: "CONTAINER 8X40X9'6\" HI CUBE", MonthlyRate: 185 }),
  site({ ContractNumber: 270000010, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8200, EqpDescription: "CONTAINER 8X20X8'6\"", MonthlyRate: 125 }),
  site({ ContractNumber: 270000010, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8200, EqpDescription: "CONTAINER 8X20X8'6\"", MonthlyRate: 125 }),
  site({ ContractNumber: 270000010, EquipmentNumber: u(), EquipmentCategory: 745, EquipmentClass: 8200, EqpDescription: "CONTAINER 8X20X8'6\"", MonthlyRate: 125 }),
  // restrooms: bulk lines with a quantity, a trailer, a static unit, sinks, tanks, the service lines, a tray
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2475, EqpDescription: "STANDARD PORTABLE RESTROOM", Quantity: 10, MonthlyRate: 95 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2475, EqpDescription: "STANDARD PORTABLE RESTROOM", Quantity: 2, MonthlyRate: 95 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2480, EqpDescription: "HIGH RISE PORTABLE RESTROOM", Quantity: 3, MonthlyRate: 140 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2490, EqpDescription: "HANDICAP PORTABLE RESTROOM", MonthlyRate: 150 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2495, EqpDescription: "ENHANCED PORTABLE RESTROOM", MonthlyRate: 180 }),
  site({ ContractNumber: 270000012, EquipmentNumber: u(), EquipmentCategory: 600, EquipmentClass: 3000, EqpDescription: "RESTROOM TRAILER 12X60 RR", MonthlyRate: 6250 }),
  site({ ContractNumber: 270000013, EquipmentNumber: u(), EquipmentCategory: 600, EquipmentClass: 3100, EqpDescription: "STATIC RESTROOM - 15 STATION", MonthlyRate: 4800 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2500, EqpDescription: "SINK - PORTABLE", Quantity: 4, MonthlyRate: 60 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2600, EqpDescription: "WASTE HOLDING TANK", Quantity: 2, MonthlyRate: 110 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2700, EqpDescription: "SERVICE - RESTROOM 5X WEEKLY", Quantity: 12, MonthlyRate: 220 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2710, EqpDescription: "SERVICE - SINK 5X WEEKLY", Quantity: 4, MonthlyRate: 80 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2720, EqpDescription: "SERVICE - WASTE TANK 3X WEEKLY", Quantity: 2, MonthlyRate: 420 }),
  site({ ContractNumber: 270000011, EquipmentCategory: 600, EquipmentClass: 2800, EqpDescription: "4 X 4 CONTAINMENT TRAY - RESTROOM", Quantity: 3, MonthlyRate: 15 }),
  site({ ContractNumber: 270000014, EquipmentNumber: u(), EquipmentCategory: 600, EquipmentClass: 3200, EqpDescription: "CONTAINER 20' WASTE & WATER", MonthlyRate: 5000 }),
  // not site services: a roll-off tank, an equipment trailer, light towers
  site({ ContractNumber: 270000015, EquipmentNumber: u(), EquipmentCategory: 530, EquipmentClass: 6300, EqpDescription: "TANK 6300 GAL ROLLOFF POLY TANK LINED", MonthlyRate: 900 }),
  site({ ContractNumber: 270000016, EquipmentNumber: u(), EquipmentCategory: 820, EquipmentClass: 1416, EqpDescription: "TRAILER EQUIP 14'-16' 9-12K DRP DCK TNDM", MonthlyRate: 400 }),
  site({ ContractNumber: 270000017, EquipmentNumber: u(), EquipmentCategory: 500, EquipmentClass: 1000, EqpDescription: "LIGHT TOWER", MonthlyRate: 485 }),
  site({ ContractNumber: 270000017, EquipmentNumber: u(), EquipmentCategory: 500, EquipmentClass: 1000, EqpDescription: "LIGHT TOWER", MonthlyRate: 485 }),
];
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([UR_H].concat(urRows, siteRows), { cellDates: true }), "Sheet 1");
  write("site/Equipment_On_Rent_-_All_Jobs_2026-09-27-08.00.00.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }));
}
const WAY = { vendor: "WAY100", name: "Wayste Inc. dba Sourgum Waste" }, WMI = { vendor: "WMI100", name: "Waste Management Inc. of FL" };
const d5 = { job: DC5, jobName: "CDR1 East DC5" };
const dc5Rows = [];
dc5Rows.push(jrow("LBR", "PR cost", "2026-09-01", 254.56, Object.assign({ code: "01-01-0001", codeName: "General Labor/Clean-Up DC5", units: 8, uc: 31.82, pay: "UNION REG", emp: "FB5002", desc: "Nguyen; An", pe: "2026-09-06" }, d5)));
dc5Rows.push(jrow("LBR", "PR cost", "2026-09-02", 254.56, Object.assign({ code: "01-01-0001", codeName: "General Labor/Clean-Up DC5", units: 8, uc: 31.82, pay: "UNION REG", emp: "FB5002", desc: "Nguyen; An", pe: "2026-09-06" }, d5)));
// Sourgum: one invoice per pull; a credit reverses one of August's
[["2026-08-03", "78401-1"], ["2026-08-05", "78402-1"], ["2026-08-07", "78403-1"], ["2026-08-11", "78404-1"], ["2026-08-13", "78405-1"], ["2026-08-17", "78406-1"], ["2026-08-19", "78407-1"], ["2026-08-24", "78408-1"], ["2026-08-27", "78409-1"]]
  .forEach(([d, inv]) => dc5Rows.push(jrow("EQU", "AP cost", d, 685, Object.assign({ code: "01-04-0001", codeName: "Dumpsters DC5", inv, desc: DC5 }, WAY, d5))));
dc5Rows.push(jrow("EQU", "AP cost", "2026-08-20", -685, Object.assign({ code: "01-04-0001", codeName: "Dumpsters DC5", inv: "78405-1", desc: "(Rev)" + DC5 }, WAY, d5)));
[["2026-09-03", "78501-1", 685], ["2026-09-08", "78502-1", 685], ["2026-09-11", "78503-1", 685], ["2026-09-15", "78504-1", 685], ["2026-09-18", "78505-1", 665]]
  .forEach(([d, inv, amt]) => dc5Rows.push(jrow("EQU", "AP cost", d, amt, Object.assign({ code: "01-04-0001", codeName: "Dumpsters DC5", inv, desc: DC5 }, WAY, d5))));
// Waste Management: a lump twice a month, with a late fee
dc5Rows.push(jrow("EQU", "AP cost", "2026-08-03", 82267.34, Object.assign({ code: "01-04-0001", codeName: "Dumpsters DC5", inv: "9473618-1345-6", desc: "26-006766 & 26-006765" }, WMI, d5)));
dc5Rows.push(jrow("NBE", "AP cost", "2026-08-03", 1450.70, Object.assign({ code: "01-04-0001", codeName: "Dumpsters DC5", inv: "9473618-1345-6", desc: "NONBILLABLE LATE FEE" }, WMI, d5)));
dc5Rows.push(jrow("EQU", "AP cost", "2026-08-17", 52515.47, Object.assign({ code: "01-04-0001", codeName: "Dumpsters DC5", inv: "9474351-1345-3", desc: "26-006766, 26-006765" }, WMI, d5)));
dc5Rows.push(jrow("EQU", "AP cost", "2026-09-02", 61000, Object.assign({ code: "01-04-0001", codeName: "Dumpsters DC5", inv: "9475900-1345-1", desc: "26-006766 & 26-006765" }, WMI, d5)));
dc5Rows.push(jrow("MAT", "AP cost", "2026-08-13", 228.4, Object.assign({ inv: "211931338", desc: "Freight" }, ULI, d5)));
{
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([JCTD_H].concat(dc5Rows)), "Sheet1");
  write("site/CDR_DC5_9-29-26.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  write("site/waste_vendors.json", JSON.stringify([{ id: 1, pattern: "sourgum", bills_per_haul: true, haul_rate_cents: 68500, container_yd: 30 }, { id: 2, pattern: "waste management", bills_per_haul: false, haul_rate_cents: null, container_yd: 40 }], null, 2));
  write("site/expected.json", JSON.stringify({
    onrent: "Equipment_On_Rent_-_All_Jobs_2026-09-27-08.00.00.xlsx", jctd: "CDR_DC5_9-29-26.xlsx", job: DC5, jobRef: "CDR-SCCI-DC5", siteLines: siteRows.length, jctdRows: dc5Rows.length,
    counts: {
      restrooms: { units: 17, byKind: { standard: 12, high_rise: 3, handicap: 1, enhanced: 1 }, trailers: 1, static: 1, containers: 0, stations: 15, sinks: 4, holding_tanks: 2, waste_water_systems: 1, service_per_week: 5 },
      trailers: { complexes: [{ label: "6-plex", n: 1, sections: 6 }, { label: "4-plex", n: 1, sections: 4 }], modular: { "24X60 w/2 RR": 2 }, offices: { "12X60 w/1 RR": 3 }, office_containers: 2, unspecified: 0, buildings: 9,
        notes: ["contract 270000003: 1 front, 0 rears: the sections do not close"] },
      storage: { containers: { "8X40": 4, "8X20": 3 }, container_units: 7, trailers: 0 },
      dumpsters: { units: 0, byYards: {} }, accessories: { steps: 5, tray: 3 }, classified: siteRows.length - 4 },
    trailerLabel: "1 × 6-plex, 1 × 4-plex, 2 × 24X60 w/2 RR, 3 × 12X60 w/1 RR office, 2 office containers",
    // pulls per vendor and month from the ledger alone, then with the log
    ledger: [
      { month: "2026-08", vendor: "sourgum", pulls: 8, source: "ledger", ledger_lines: 10, ledger_cents: 548000 },
      { month: "2026-08", vendor: "waste management", pulls: null, source: "spend", ledger_lines: 3, ledger_cents: 13623351 },
      { month: "2026-09", vendor: "sourgum", pulls: 5, source: "ledger", ledger_lines: 5, ledger_cents: 340500 },
      { month: "2026-09", vendor: "waste management", pulls: null, source: "spend", ledger_lines: 1, ledger_cents: 6100000 }],
    log: [{ job_number: DC5, pull_date: "2026-08-12", vendor_name: "Waste Management", container_yd: 40, pulls: 3, ticket_no: "WM-1" },
      { job_number: DC5, pull_date: "2026-08-20", vendor_name: "Sourgum", container_yd: 30, pulls: 7, ticket_no: "S-20", cost_cents: 479500 }],
    withLog: [
      { month: "2026-08", vendor: "sourgum", pulls: 7, source: "log", entries: 1, haul_lines: 8 },
      { month: "2026-08", vendor: "waste management", pulls: 3, source: "log", entries: 1, haul_lines: 3 },
      { month: "2026-09", vendor: "sourgum", pulls: 5, source: "ledger", entries: 0, haul_lines: 5 },
      { month: "2026-09", vendor: "waste management", pulls: null, source: "spend", entries: 0, haul_lines: 1 }],
  }, null, 2));
}

// ---- a zip of a drop: one STORED entry, one DEFLATED, a system file, a folder ---
const zlib = require("zlib");
function zipOf(entries) {
  const crcT = new Uint32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (u8) => { let c = 0xFFFFFFFF; for (const b of u8) c = crcT[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), raw = Buffer.from(e.data);
    const data = e.deflate ? zlib.deflateRawSync(raw) : raw, method = e.deflate ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, data); cd.push(ch, name); off += lh.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(cd), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cdBuf, eocd]));
}
write("drop.zip", zipOf([
  { name: "week 1/sunbelt_2026-09-19.csv", data: fs.readFileSync(path.join(here, "onrent/sunbelt_2026-09-19.csv")) },
  { name: "week 2/sunbelt_2026-09-26.csv", data: fs.readFileSync(path.join(here, "onrent/sunbelt_2026-09-26.csv")), deflate: true },
  { name: "week 2/Thumbs.db", data: Buffer.from("junk") },
  { name: "notes.txt", data: Buffer.from("not data"), deflate: true },
]));
