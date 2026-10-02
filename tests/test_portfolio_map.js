/* test_portfolio_map.js - campus dots sit on the state they name, and the
   baked outlines still match the vendored GeoJSON. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, eq, ok, done } = require("./lib.js");
const PM = require("../app/portfolio_map.js");

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

done();
