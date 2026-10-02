/* test_jobs_settings.js - Settings → Jobs groups by campus code, and does not
   dump every rate-table description under a Job / Short name header. */
"use strict";
const { check, eq, ok, done } = require("./lib.js");
const JS = require("../app/jobs_settings.js");

const LONG = "CDR1 East TM (Campus) (Iowa CBA, the description that used to fill the rate-table column)";
const jobs = [
  { job_number: "50-60-225104", short_name: "Site", name: "CDR1 East TM (Campus)", campus: "CDR E1", region: "Cedar Rapids, IA", rate_table_code: "#225104" },
  { job_number: "50-60-225121", short_name: "DC4", name: "CDR1 East DC4", campus: "CDR E1", region: "Cedar Rapids, IA", rate_table_code: "#225121" },
  { job_number: "50-60-224158", short_name: "100", name: "100", campus: "PHL", region: "Philadelphia, PA", rate_table_code: "#224158" },
  { job_number: "50-60-225040", short_name: "DC1", name: "DC1", campus: "DFW2", region: "Dallas-Fort Worth, TX", rate_table_code: null },
  { job_number: "50-60-226094", short_name: "Gravity", name: "Project Gravity", campus: null, region: null, rate_table_code: null },
  { job_number: "99-99-999999", short_name: "Odd", name: "Not a campus", campus: "Helix yard", region: null, rate_table_code: "#999999" },
];
const tables = [
  { code: "#225104", description: LONG },
  { code: "#225121", description: "CDR1 East DC4 (Iowa CBA, demo)" },
  { code: "#224158", description: "PHL 100 (Iowa CBA, demo)" },
];

check("a campus string that starts with a code is that code", () => {
  eq(JS.campusCode("CDR E1"), "CDR");
  eq(JS.campusCode("DFW2"), "DFW");
  eq(JS.campusCode("cdr"), "CDR");
  eq(JS.campusCode("PHL 104"), "PHL");
  eq(JS.campusCode("Helix yard"), null);
  eq(JS.campusCode(""), null);
  eq(JS.campusCode("Unassigned"), null);
});

check("jobs settings HTML groups by campus code and keeps Unassigned last", () => {
  const html = JS.render({ jobs, tables, edit: true, selected: "50-60-225121" });
  const codes = [...html.matchAll(/data-campus="([^"]+)"/g)].map((m) => m[1]);
  eq(codes, ["PHL", "DFW", "CDR", "Unassigned"]);
  ok(html.indexOf('data-campus="PHL"') < html.indexOf('data-campus="DFW"'));
  ok(html.indexOf('data-campus="DFW"') < html.indexOf('data-campus="CDR"'));
  ok(html.indexOf('data-campus="CDR"') < html.indexOf('data-campus="Unassigned"'));
  eq((html.match(/data-campus="Unassigned"/g) || []).length, 1);
  ok(!/data-campus="Helix/.test(html), "no eleventh campus row");
  ok(!html.includes("CDR E1"), "CDR E1 is shown as CDR");
  ok(!html.includes("DFW2"), "DFW2 is shown as DFW");
  ok(html.includes(">50-60-225104<"), "the job number is one unbroken token");
  ok(!html.includes("50-60-<"), "the job number is not split across tags");
  const cdr = html.slice(html.indexOf('data-campus="CDR"'), html.indexOf('data-campus="Unassigned"'));
  ok(cdr.includes("DC4") && cdr.includes("50-60-225121") && cdr.includes("CDR1 East DC4"));
  ok(cdr.includes("#225121"));
  ok(html.includes("No rate table"), "a job without a table says so");
  ok(!html.includes(LONG), "the list does not dump the rate-table description");
  ok(!html.includes("Iowa CBA"), "no rate-table description is rendered");
  const flat = html.replace(/<[^>]+>/g, "");
  ok(!flat.includes("JobShort name"), "no old JOB / SHORT NAME header row");
  ok(!/<th[^>]*>\s*Job\s*<\/th>\s*<th[^>]*>\s*Short name\s*<\/th>/i.test(html));
  ok(html.includes('class="job-editor"'), "the editor is its own panel");
  ok(html.includes('class="jobs-set has-editor"'));
  ok(html.includes('name="job_number"') && html.includes('name="short_name"') && html.includes('name="name"'));
  ok(html.includes('name="campus"') && html.includes('name="region"') && html.includes('name="rate_table_code"'));
  ok(html.includes('<option value="CDR" selected>CDR</option>'), "the campus field is the code");
  for (const c of ["PHL", "SBN", "IAD", "PDX", "DFW", "LCK", "CMH", "CDR", "AUS", "BWI"]) ok(html.includes(`value="${c}"`), c);
  ok(!/<table[\s>]/.test(html), "the jobs list is not the old grid");
});

check("the editor stays closed until a job is opened", () => {
  const html = JS.render({ jobs, tables, edit: true, selected: "" });
  ok(!html.includes("has-editor"));
  ok(!html.includes('class="job-editor"'));
  ok(!html.includes("<form"));
  ok(html.includes("Add job"));
  ok(html.includes('data-campus="CDR"'));
});

done();
