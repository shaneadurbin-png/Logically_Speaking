/* test_projects_register.js - the Projects workbook's rows, and the copied review. */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { check, eq, ok, done } = require("./lib.js");
const Projects = require("../app/projects.js");
const PM = require("../app/portfolio_map.js");
const XLSX = require("../app/vendor/xlsx.full.min.js");

check("the Projects workbook is 54 jobs, and a known row lines up with the map", () => {
  eq(Projects.REGISTER.length, 54);
  const bwi = Projects.REGISTER.find((j) => j.job_number === "50-60-224050");
  eq(bwi.short_name, "110");
  eq(bwi.name, "110");
  eq(bwi.campus, "BWI");
  eq(bwi.region, "Baltimore, MD");
  eq(PM.locate(bwi.campus).state, "Maryland");
  const helix = Projects.REGISTER.find((j) => j.job_number === "60-26-301081");
  eq(helix.short_name, "Helix Trailer Decking");
  eq(helix.campus, null);
  const campuses = new Set(Projects.REGISTER.map((j) => j.campus).filter(Boolean));
  for (const c of campuses) ok(PM.locate(c), `${c} is a portfolio map id`);

  const rows = [["Job #", "Project Name", "Campus", "Region"]].concat(
    Projects.REGISTER.map((j) => [j.job_number, j.short_name, j.campus || "", j.region || ""]));
  rows.find((r) => r[0] === "60-26-100191")[2] = "aus";
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Projects");
  const file = path.join(os.tmpdir(), "projects-register-fixture.xlsx");
  fs.writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  const d = Projects.read(fs.readFileSync(file), "Projects (2).xlsx");
  eq(d.totals.jobs, 54);
  const known = d.jobs.find((j) => j.job_number === "50-60-224050");
  eq(known.campus, "BWI");
  eq(known.region, "Baltimore, MD");
  eq(d.jobs.find((j) => j.job_number === "60-26-100191").campus, "AUS");
  eq(d.jobs.find((j) => j.job_number === "50-60-225121").campus, "CDR");
  eq(d.jobs.find((j) => j.job_number === "50-60-225040").campus, "DFW");
  eq(Projects.alignCampus("CDR E1"), "CDR");
  eq(Projects.alignCampus("DFW2"), "DFW");
  eq(Projects.alignCampus("phl"), "PHL");

  const existing = [
    { job_number: "50-60-225121", short_name: "DC4", name: "CDR1 East DC4", campus: "CDR E1", region: "Cedar Rapids, IA", rate_table_code: "#225121" },
    { job_number: "99-99-999999", short_name: "Keep me", name: "Has cost", campus: "ZZZ", region: null, rate_table_code: null },
  ];
  const merged = Projects.mergeInto(existing.slice(), d.jobs, (j) => Object.assign({ rate_table_code: null }, j));
  eq(merged.jobs.length, 54 + 1);
  eq(merged.added, 53);
  const kept = merged.jobs.find((j) => j.job_number === "50-60-225121");
  eq(kept.short_name, "DC4");
  eq(kept.rate_table_code, "#225121");
  eq(kept.campus, "CDR E1");
  ok(merged.jobs.some((j) => j.job_number === "99-99-999999" && j.short_name === "Keep me"), "a job the sheet omits stays");
});

done();
