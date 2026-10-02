/* test_portfolio_map.js - campus dots sit on the state they name, and the
   baked outlines still match the vendored GeoJSON. A campus filter and a
   project filter each change the month totals and the review's rows. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, done } = require("./lib.js");
const PM = require("../app/portfolio_map.js");
const Rev = require("../app/review.js");
const Pages = require("../app/pages.js");

const EXPECT = {
  "CDR E1": "Iowa", CDR: "Iowa", BWI: "Maryland", PHL: "Pennsylvania", SBN: "Indiana",
  DFW2: "Texas", DFW: "Texas", AUS: "Texas", IAD: "Virginia", PDX: "Oregon", CMH: "Ohio", LCK: "Ohio",
};

function boxHolds(box, p) {
  return p[0] >= box[0] - 1 && p[0] <= box[2] + 1 && p[1] >= box[1] - 1 && p[1] <= box[3] + 1;
}

check("every campus code resolves, ignoring case, and an unknown code does not", () => {
  eq(PM.locate("cdr e1").state, "Iowa");
  eq(PM.locate("DFW").lon, PM.locate("dfw2").lon);
  eq(PM.locate("LCK").place, "Columbus, OH");
  eq(PM.locate("nope"), null);
  eq(PM.locate("Other"), null);
  eq(PM.locate(""), null);
});

check("each campus projects inside its state", () => {
  const byName = Object.fromEntries(PM.map().states.map((s) => [s.name, s]));
  for (const [code, state] of Object.entries(EXPECT)) {
    const place = PM.locate(code);
    eq(place.state, state);
    const p = PM.project(place.lon, place.lat);
    ok(p && boxHolds(byName[state].box, p), `${code} ${p} is outside ${state} ${byName[state].box}`);
  }
});

check("the baked outlines match the vendored GeoJSON", () => {
  const geo = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/us_states.json"), "utf8"));
  const fresh = PM.compile(geo);
  eq(fresh.viewBox, PM.map().viewBox);
  eq(fresh.states.map((s) => s.name + "|" + s.d), PM.map().states.map((s) => s.name + "|" + s.d));
  ok(fresh.states.some((s) => s.name === "Alaska") && fresh.states.some((s) => s.name === "Hawaii"), "insets");
  ok(!fresh.states.some((s) => s.name === "Puerto Rico"), "Puerto Rico stays off this map");
});

check("the svg draws every campus it is given, and close dots stay apart", () => {
  const points = Object.entries(EXPECT).filter(([code]) => code !== "CDR" && code !== "DFW").map(([code]) => {
    const place = PM.locate(code);
    return { id: code, name: code, lon: place.lon, lat: place.lat, hasCost: code === "BWI", selected: code === "BWI" };
  });
  const svg = PM.svg({ points, selectedState: "Maryland" });
  for (const p of points) ok(svg.includes(`data-campus="${p.id}"`), p.id);
  ok(svg.includes('data-state="Maryland"') && svg.includes('class="on"'), "selected state");
  ok((svg.match(/class="pf-dot-mark"/g) || []).length === points.length, "one mark per campus");
  const at = (id) => { const m = svg.match(new RegExp(`data-campus="${id}"[\\s\\S]*?class="pf-dot-mark" cx="([\\d.-]+)" cy="([\\d.-]+)"`)); return [+m[1], +m[2]]; };
  const d = at("CMH").map((n, i) => n - at("LCK")[i]);
  ok(Math.hypot(d[0], d[1]) >= 12, "CMH and LCK both show");
});

check("a campus filter and a project filter each change the month totals and the review rows", () => {
  const rows = [
    { job_number: "50-60-225121", labor_cents: 1904500, rental_cents: 978100, purchase_cents: 31300, total_cents: 2913900, labor_hours: 228, labor_held_hours: 24, pending_lines: 2 },
    { job_number: "50-60-225008", labor_cents: 100000, rental_cents: 0, purchase_cents: 50000, total_cents: 150000, labor_hours: 10 },
  ];
  const all = PM.monthScope(rows, null);
  const campusJobs = PM.monthScope(rows, ["50-60-225121"]);
  const projectJobs = PM.monthScope(rows, ["50-60-225008"]);
  eq(all.all, 3063900);
  eq(all.labor, 2004500);
  eq(campusJobs.all, 2913900);
  eq(campusJobs.rent, 978100);
  eq(projectJobs.all, 150000);
  eq(projectJobs.purch, 50000);
  eq(projectJobs.hours, 10);
  ok(campusJobs.all !== all.all && projectJobs.all !== all.all && projectJobs.all !== campusJobs.all, "each filter changes the month total");

  const jobs = [
    { job_number: "50-60-225121", short_name: "DC4", campus: "CDR E1" },
    { job_number: "50-60-225008", short_name: "204", campus: "SBN" },
  ];
  const labor = [
    { week_ending: "2026-09-20", job_number: "50-60-225121", employee: "Ada", employee_key: "1", certified_class: "#LAB-J", pay_type: "REG", pay_type_name: "REG", hours: 8, cost_cents: 800 },
    { week_ending: "2026-09-20", job_number: "50-60-225008", employee: "Bea", employee_key: "2", certified_class: "#LAB-J", pay_type: "REG", pay_type_name: "REG", hours: 3, cost_cents: 300 },
  ];
  const rentals = [
    { job_number: "50-60-225121", vendor_key: "united_rentals", vendor_name: "United Rentals", description: "Lift", category: "Aerial", qty: 1, monthly_rent_cents: 10000 },
    { job_number: "50-60-225008", vendor_key: "sunbelt", vendor_name: "Sunbelt Rentals", description: "Fork", category: "Aerial", qty: 2, monthly_rent_cents: 20000 },
  ];
  const purchases = [
    { doc_date: "2026-09-18", doc_number: "PO-A", job_number: "50-60-225121", supplier: "Acme", committed_cents: 2500 },
    { doc_date: "2026-09-18", doc_number: "PO-B", job_number: "50-60-225008", supplier: "Bolt", committed_cents: 900 },
  ];
  const base = { jobs, labor, rentals, purchases, week: "2026-09-20", today: "2026-10-02", showNames: true };
  const whole = Rev.build(base);
  const byCampus = Rev.build(Object.assign({}, base, { campuses: ["CDR E1"] }));
  const byProject = Rev.build(Object.assign({}, base, { projects: ["50-60-225008"] }));
  eq(whole.labor.cost, 1100);
  eq(whole.labor.headcount, 2);
  eq(whole.rental.lines, 2);
  eq(byCampus.labor.cost, 800);
  eq(byCampus.labor.headcount, 1);
  eq(byCampus.rental.lines, 1);
  eq(byCampus.rental.qty, 1);
  eq(byCampus.campusAll, false);
  eq(byCampus.campusLabel, "CDR E1");
  eq(byProject.labor.cost, 300);
  eq(byProject.labor.headcount, 1);
  eq(byProject.rental.lines, 1);
  eq(byProject.rental.qty, 2);
  eq(byProject.projectAll, false);
  ok(byProject.po.rows.length === 1 && byProject.po.rows[0].po === "PO-B", "project filter keeps only that job's POs");
  ok(byCampus.po.rows.length === 1 && byCampus.po.rows[0].po === "PO-A", "campus filter keeps only that campus's POs");
  ok(byCampus.labor.cost !== whole.labor.cost && byProject.labor.cost !== whole.labor.cost, "each filter changes the review");
});

check("the portfolio campuses are PHL, SBN, IAD, PDX, DFW, LCK, CMH, CDR, AUS, BWI", () => {
  eq(PM.CAMPUS_ORDER, ["PHL", "SBN", "IAD", "PDX", "DFW", "LCK", "CMH", "CDR", "AUS", "BWI"]);
  eq(PM.canonicalCampus("CDR E1"), "CDR");
  eq(PM.canonicalCampus("cdr e1"), "CDR");
  eq(PM.canonicalCampus("DFW2"), "DFW");
  eq(PM.canonicalCampus("Austin"), "AUS");
  eq(PM.canonicalCampus("Dallas"), "DFW");
  eq(PM.canonicalCampus("Dallas-Fort Worth"), "DFW");
  eq(PM.canonicalCampus("Philadelphia"), "PHL");
  eq(PM.canonicalCampus("Other"), null);
  eq(PM.canonicalCampus("Temple"), null);
  eq(PM.canonicalCampus(""), null);
  eq(PM.locate("AUS").place, "Austin, TX");
  eq(PM.locate("AUS").state, "Texas");
  const jobs = [
    { job_number: "cdr", campus: "CDR E1" },
    { job_number: "aus-name", campus: "Austin" },
    { job_number: "aus", campus: "AUS" },
    { job_number: "dfw-name", campus: "Dallas" },
    { job_number: "dfw2", campus: "DFW2" },
    { job_number: "dfw", campus: "DFW" },
    { job_number: "phl", campus: "PHL" },
    { job_number: "sbn", campus: "SBN" },
    { job_number: "iad", campus: "IAD" },
    { job_number: "pdx", campus: "PDX" },
    { job_number: "lck", campus: "LCK" },
    { job_number: "cmh", campus: "CMH" },
    { job_number: "bwi", campus: "BWI" },
    { job_number: "blank", campus: "" },
    { job_number: "temple", campus: "Temple" },
  ];
  const grouped = PM.portfolioCampuses(jobs);
  eq(grouped.order, ["PHL", "SBN", "IAD", "PDX", "DFW", "LCK", "CMH", "CDR", "AUS", "BWI"]);
  eq(grouped.groups.CDR.map((j) => j.job_number), ["cdr"]);
  eq(grouped.groups.AUS.map((j) => j.job_number), ["aus-name", "aus"]);
  eq(grouped.groups.DFW.map((j) => j.job_number), ["dfw-name", "dfw2", "dfw"]);
  eq(grouped.groups.PHL.map((j) => j.job_number), ["phl"]);
  eq(grouped.loose.map((j) => j.job_number), ["blank", "temple"]);
  ok(!grouped.order.includes("Other") && !grouped.order.includes("CDR E1") && !grouped.order.includes("DFW2"), "no eleventh campus");
  const expanded = PM.expandCampuses(jobs, ["CDR", "DFW"]);
  ok(expanded.includes("CDR E1") && expanded.includes("DFW2") && expanded.includes("Dallas") && expanded.includes("DFW"), expanded.join(","));
  ok(!expanded.includes("AUS") && !expanded.includes(""), "other campuses stay out");
  const points = grouped.order.map((code) => {
    const place = PM.locate(code);
    return { id: code, name: code, lon: place.lon, lat: place.lat };
  });
  const svg = PM.svg({ points });
  const ids = [];
  svg.replace(/data-campus="([^"]+)"/g, (_, id) => { ids.push(id); return _; });
  eq(ids, ["PHL", "SBN", "IAD", "PDX", "DFW", "LCK", "CMH", "CDR", "AUS", "BWI"]);
  const at = (id) => { const m = svg.match(new RegExp(`data-campus="${id}"[\\s\\S]*?class="pf-dot-mark" cx="([\\d.-]+)" cy="([\\d.-]+)"`)); return [+m[1], +m[2]]; };
  const gap = at("CMH").map((n, i) => n - at("LCK")[i]);
  ok(Math.hypot(gap[0], gap[1]) >= 12, "LCK is offset from CMH so both dots show");
});

check("a campus and a project read Campus > Project", () => {
  eq(PM.selectionLabel("AUS", "DC4"), "AUS > DC4");
  eq(PM.selectionLabel("CDR E1", "DC4"), "CDR E1 > DC4");
  eq(PM.selectionLabel("AUS", ""), "AUS");
  eq(PM.selectionLabel("", "DC4"), "DC4");
  eq(PM.selectionLabel("Other", "DC4"), "DC4");
  eq(PM.selectionLabel("Unassigned", "Site"), "Site");
  eq(PM.selectionLabel("  BWI ", " 110 "), "BWI > 110");
});

done();
