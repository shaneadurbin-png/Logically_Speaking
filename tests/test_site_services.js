/* test_site_services.js - restroom and trailer counts from a United Rentals export, the plex math, and the dumpster month. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, done } = require("./lib.js");
const SS = require("../app/site_services.js"), OnRent = require("../app/onrent.js"), JCTD = require("../app/jctd.js"), Rec = require("../app/recurring_model.js"), S = require("../app/sniff.js");
const F = path.join(__dirname, "fixtures/site");
const X = JSON.parse(fs.readFileSync(path.join(F, "expected.json"), "utf8"));
const WV = JSON.parse(fs.readFileSync(path.join(F, "waste_vendors.json"), "utf8"));

check("classify reads the vendors' words: restrooms, trailers, sleeves, containers, services, accessories, not-ours", () => {
  const c = (d) => { const r = SS.classify(d); return [r.category, r.kind]; };
  eq(c("STANDARD PORTABLE RESTROOM"), ["restroom", "standard"]); eq(c("HIGH RISE PORTABLE RESTROOM"), ["restroom", "high_rise"]); eq(c("ELEVATOR FIT PORTABLE RESTROOM"), ["restroom", "elevator_fit"]);
  eq(c("HANDICAP PORTABLE RESTROOM"), ["restroom", "handicap"]); eq(c("ENHANCED PORTABLE RESTROOM"), ["restroom", "enhanced"]); eq(c("STANDARD PORTABLE RESTROOM - WOMENS"), ["restroom", "womens"]); eq(c("PORTABLE TOILETS STANDARD"), ["restroom", "standard"]);
  eq(SS.classify("STATIC RESTROOM - 15 STATION"), { category: "restroom", kind: "static", stations: 15 }); eq(SS.classify("EVNT RESTROOM TRLR- 10 STATION").stations, 10); eq(c("RESTROOM TRAILER 12X60 RR"), ["restroom", "trailer"]); eq(c("RR TRAILER 12X60"), ["restroom", "trailer"]); eq(c("RESTROOM CONTAINER 40'"), ["restroom", "container"]);
  eq(c("SINK - PORTABLE"), ["restroom", "sink"]); eq(c("WASTE HOLDING TANK"), ["restroom", "holding_tank"]); eq(c("CONTAINER 20' WASTE & WATER"), ["restroom", "waste_water_system"]);
  eq(SS.classify("SERVICE - RESTROOM 5X WEEKLY"), { category: "service", kind: "restroom", per_week: 5 }); eq(SS.classify("3X SERVICE OF WASTE TANK HALF").per_week, 3); eq(c("SERVICE ADA RSTRM 2X WEEKLY"), ["service", "restroom"]); eq(c("SERVICE - FRESH WATER 3X WEEKLY"), ["service", "fresh_water"]);
  eq(SS.classify("MODULAR BLDG FAST FRONT"), { category: "trailer", kind: "modular_section", section: "front", rr: 0 }); eq(SS.classify("MODULAR BLDG FAST REAR W/2RR").rr, 2); eq(SS.classify("MODULAR FAST MIDDLE").section, "middle");
  eq(SS.classify("MODULAR BLDG FRNT QTS PLEX").section, "front"); eq(SS.classify("MODULAR REAR W/2RR").section, "rear"); eq(SS.classify("MODULAR BLDG MIDDLE QTS PLEX").section, "middle");
  eq(SS.classify("MODULAR BLDG 4-PLEX"), { category: "trailer", kind: "modular_plex", sections: 4 }); eq(SS.classify("8PLEX TRAILER MODULAR BUILDING").sections, 8); eq(SS.classify("10 PLEX TRAILER").sections, 10);
  eq(SS.classify("MODULAR BLDG 24X60 W/2-RR"), { category: "trailer", kind: "modular", size: "24X60", rr: 2 }); eq(SS.classify("OFFICE TRAILER 12X60 W/RR"), { category: "trailer", kind: "office", size: "12X60", rr: 1 });
  eq(SS.classify("24X56 NO RR TRAILER CUSTOM"), { category: "trailer", kind: "office", size: "24X56", rr: 0 }); eq(c("GLO/OFFICE CONTAINER 8X20X8'6\""), ["trailer", "office_container"]); eq(c("TRAILERS"), ["trailer", "unspecified"]);
  eq(SS.classify("CONTAINER 8X40X9'6\" HI CUBE"), { category: "storage", kind: "container", size: "8X40" }); eq(c("STORAGE TRAILER- 53'"), ["storage", "trailer"]);
  eq(SS.classify("ROLL OFF 30 YD"), { category: "dumpster", kind: "roll_off", yards: 30 }); eq(SS.classify("DUMPSTER 40 YARD").yards, 40);
  eq(c("OFFICE TRAILER STEPS"), ["accessory", "steps"]); eq(c("4 X 4 CONTAINMENT TRAY - RESTROOM"), ["accessory", "tray"]); eq(c("TRAILER HVAC"), ["accessory", "hvac"]); eq(c("TOILET SINGLE MOUNT TRAILER KIT"), ["accessory", "other"]);
  for (const d of ["TANK 6300 GAL ROLLOFF POLY TANK LINED", "TRAILER EQUIP 14'-16' 9-12K DRP DCK TNDM", "TRAILER WATER TANK 500-550 GALLON", "LIGHT TOWER VERT MAST LED TRAILER", "PRESSURE WASHER 3500 PSI ON TRAILER", "MODULAR SHIELD PANEL 24\" X 10'", "FENCE MODULAR 12' L X 6' H TEMPORARY PAN", "FORKLIFT HOPPER 3 YARD", "TELEHANDLER 10K 55'", ""]) eq(SS.classify(d).category, "other", d);
});
check("the sleeves under one contract make one x-plex; a front with no rear is flagged, never guessed; a whole plex counts as itself", () => {
  const L = (contract, desc, qty) => ({ vendor_key: "united_rentals", contract_no: contract, description: desc, qty: qty || 1 });
  const p = SS.plexes([L("A", "MODULAR BLDG FAST FRONT"), L("A", "MODULAR BLDG FAST MIDDLE"), L("A", "MODULAR BLDG FAST MIDDLE"), L("A", "MODULAR BLDG FAST MIDDLE"), L("A", "MODULAR BLDG FAST MIDDLE"), L("A", "MODULAR BLDG FAST REAR W/2RR"),
    L("B", "MODULAR FAST FRONT"), L("B", "MODULAR FAST REAR W/2RR"), L("C", "MODULAR BLDG FAST FRONT"), L("D", "10 PLEX TRAILER", 2),
    L("E", "MODULAR BLDG FAST FRONT", 2), L("E", "MODULAR BLDG FAST MIDDLE", 8), L("E", "MODULAR BLDG FAST REAR W/2RR", 2)]);
  const by = Object.fromEntries(p.map((x) => [x.contract_no, x]));
  eq([by.A.complexes, by.A.sections, by.A.label, by.A.notes], [1, 6, "6-plex", []]);
  eq([by.B.complexes, by.B.sections, by.B.label], [1, 2, "2-plex"]);
  eq([by.C.complexes, by.C.sections, by.C.label, by.C.notes], [0, null, "sections, no complex", ["1 front, 0 rears: the sections do not close"]]);
  eq([by.D.complexes, by.D.sections, by.D.fronts, by.D.middles, by.D.rears], [2, 10, 2, 16, 2]);
  eq([by.E.complexes, by.E.sections, by.E.label], [2, 6, "6-plex"], "two 6-plexes on one contract");
  eq(SS.plexes([]), []);
});
const doc = OnRent.read(fs.readFileSync(path.join(F, X.onrent)), X.onrent);
const siteLines = doc.lines.filter((l) => l.vendor_job_ref === X.jobRef).map((l) => Object.assign({ vendor_key: doc.vendor_key }, l));
check("the counts on the job's lines of a United Rentals export", () => {
  eq(doc.vendor_key, "united_rentals"); eq(siteLines.length, X.siteLines);
  const c = SS.counts(siteLines);
  eq(c.restrooms, X.counts.restrooms); eq(c.trailers, X.counts.trailers); eq(c.storage, X.counts.storage); eq(c.dumpsters, X.counts.dumpsters); eq(c.accessories, X.counts.accessories); eq(c.classified, X.counts.classified);
  eq(SS.trailerLabel(c.trailers), X.trailerLabel);
  eq(SS.counts([]).trailers.buildings, 0); eq(SS.trailerLabel(SS.counts([]).trailers), "none");
  eq(S.sniff(fs.readFileSync(path.join(F, X.onrent)), X.onrent).kind, "onrent", "still a United Rentals report to the sniffer");
});
check("the view rows (what a viewer reads) rebuild the same counts as the lines", () => {
  const c = SS.counts(siteLines), v = SS.fromViews(SS.viewRows(siteLines), SS.plexRows(siteLines));
  eq(v, c); eq(SS.fromViews([], []).restrooms.units, 0); eq(SS.shortLabel(c, 8), "17 restrooms · 9 buildings · 8 pulls"); eq(SS.shortLabel(SS.fromViews([], []), null), "");
});
const jd = JCTD.read(fs.readFileSync(path.join(F, X.jctd)), X.jctd);
check("the dumpster month from the ledger: one invoice is one pull where the hauler bills that way, a credit takes one back; a lump is spend, no count", () => {
  eq(jd.job_number, X.job); eq(jd.totals.rows, X.jctdRows);
  const rows = SS.dumpsterMonth(jd.rows, [], WV);
  eq(rows.map((r) => ({ month: r.month, vendor: WV.find((v) => `wv:${v.id}` === r.vendor_key).pattern, pulls: r.pulls, source: r.source, ledger_lines: r.ledger_lines, ledger_cents: r.ledger_cents })), X.ledger);
  ok(rows.every((r) => r.job_number === X.job));
});
check("the log wins for the vendor and month it has entries for; the ledger count stays beside it", () => {
  const rows = SS.dumpsterMonth(jd.rows, X.log, WV);
  eq(rows.map((r) => ({ month: r.month, vendor: WV.find((v) => `wv:${v.id}` === r.vendor_key).pattern, pulls: r.pulls, source: r.source, entries: r.entries, haul_lines: r.haul_lines })), X.withLog);
  const aug = rows.find((r) => r.month === "2026-08" && r.source === "log" && r.log_cost_cents); eq(aug.log_cost_cents, 479500); eq(aug.container_yd, 30);
  const unknown = SS.dumpsterMonth([], [{ job_number: X.job, pull_date: "2026-09-04", vendor_name: "Bob's Roll-Off", pulls: 2 }], WV)[0];
  eq([unknown.source, unknown.pulls, unknown.vendor_key], ["log", 2, "name:bob's roll-off"], "a vendor Settings does not know still logs");
  eq(SS.dumpsterMonth(jd.rows, [], [])[0], undefined, "no waste vendors in Settings: nothing is counted from the ledger");
});
check("a hauler's per-haul invoices are not a recurring rental", () => {
  const isWaste = (name) => !!SS.wasteVendorFor(WV, name);
  eq(Rec.candidates(jd.rows, {}).filter((c) => /sourgum/i.test(c.vendor_name)).length, 1, "without the guard the $685 lines look like a rental");
  eq(Rec.candidates(jd.rows, { exclude: isWaste }).length, 0);
});
done();
