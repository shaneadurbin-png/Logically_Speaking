/* test_pages.js - three routes. The portfolio stops after the ten campuses.
   A campus page lists only that campus's projects. A project page is one job. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { check, eq, ok, done } = require("./lib.js");
const Pages = require("../app/pages.js");
const Rev = require("../app/review.js");

const ORDER = ["PHL", "SBN", "IAD", "PDX", "DFW", "LCK", "CMH", "CDR", "AUS", "BWI"];
const jobs = [
  { job_number: "50-60-225121", short_name: "DC4", campus: "CDR E1", region: "Cedar Rapids, IA", active: true },
  { job_number: "50-60-225120", short_name: "DC5", campus: "CDR E1", active: true },
  { job_number: "50-60-225008", short_name: "204", campus: "SBN", active: true },
  { job_number: "60-26-100191", short_name: "DC4", campus: "AUS", active: true },
  { job_number: "50-60-226094", short_name: "Project Gravity", campus: null, active: true },
];
const rows = [
  { job_number: "50-60-225121", labor_cents: 1904500, rental_cents: 978100, purchase_cents: 31300, total_cents: 2913900, labor_hours: 228, pending_lines: 0 },
  { job_number: "50-60-225120", labor_cents: 100, rental_cents: 0, purchase_cents: 0, total_cents: 100, labor_hours: 1 },
  { job_number: "50-60-225008", labor_cents: 800000, rental_cents: 0, purchase_cents: 50000, total_cents: 850000, labor_hours: 40 },
  { job_number: "60-26-100191", labor_cents: 250000, rental_cents: 0, purchase_cents: 0, total_cents: 250000, labor_hours: 8 },
];
const labor = [
  { week_ending: "2026-09-20", job_number: "50-60-225121", employee: "Ada Lopez", employee_key: "1", certified_class: "#LAB-J", pay_type: "REG", pay_type_name: "REG", hours: 8, cost_cents: 800 },
  { week_ending: "2026-09-20", job_number: "50-60-225008", employee: "Bea Cho", employee_key: "2", certified_class: "#LAB-J", pay_type: "REG", pay_type_name: "REG", hours: 3, cost_cents: 300 },
];
const WEEKLY = ["Weekly Labor Burn", "Weekly Rental Burn", "Weekly Committed POs", "GR Weekly Cost Review"];

check("the portfolio is the ten campuses and does not carry every job's weekly detail", () => {
  const html = Pages.portfolio({ month: "2026-09", jobs, rows, laborNote: "229 hours" });
  eq(Pages.CAMPUS_ORDER, ORDER);
  let at = -1;
  for (const code of ORDER) {
    const i = html.indexOf(`data-campus="${code}"`);
    ok(i > at, `${code} is in the campus list, in order`);
    at = i;
    ok(html.includes(`href="#/c/${code}?m=2026-09"`), `${code} opens its own page`);
  }
  ok(html.includes("Mission Critical"), "heading");
  ok(html.includes('class="tile total"') && html.includes('class="tile labor"') && html.includes('class="tile equipment"') && html.includes('class="tile materials"'), "four month tiles");
  ok(html.indexOf('class="tile total"') < html.indexOf('class="tile labor"'), "total tile is first");
  ok(!html.includes('class="cards"'), "no scrolling column of project cards");
  for (const phrase of WEEKLY) ok(!html.includes(phrase), `portfolio does not include ${phrase}`);
  for (const j of jobs) ok(!html.includes(j.job_number), `portfolio does not list ${j.job_number}`);
  ok(!html.includes("Ada Lopez") && !html.includes("Bea Cho"), "no employee rows");
  ok(!html.includes("Project Gravity"), "a job with no campus is not a row on the portfolio");
  ok(html.includes("$40,140"), "the tiles are the whole portfolio, not one campus");
});

check("a campus route renders only that campus's projects", () => {
  const html = Pages.campus({ code: "CDR", month: "2026-09", jobs, rows });
  ok(html.includes('data-page="campus"') && html.includes('data-campus="CDR"'), "header is the campus code");
  ok(html.includes(">CDR<"), "the code is the heading");
  ok(html.includes('href="#/?m=2026-09"'), "a control returns to the portfolio");
  ok(html.includes('href="#/p/50-60-225121?m=2026-09"') && html.includes(">DC4<"), "DC4 is a link to its project page");
  ok(html.includes('href="#/p/50-60-225120?m=2026-09"') && html.includes(">DC5<"), "DC5 is on this campus");
  ok(!html.includes("50-60-225008") && !html.includes(">204<"), "South Bend's project is not on the CDR page");
  ok(!html.includes("60-26-100191"), "the Austin job is not on the CDR page");
  ok(!html.includes("Project Gravity"), "an unassigned job is not listed here");
  for (const phrase of WEEKLY) ok(!html.includes(phrase), `campus page is not the weekly dump (${phrase})`);
  ok(html.includes("$29,140"), "tiles are this campus");
  ok(!html.includes("$8,500") && !html.includes("$40,140"), "other campuses' totals are not on this page");
  const aus = Pages.campus({ code: "AUS", month: "2026-09", jobs, rows });
  ok(aus.includes("60-26-100191") && aus.includes(">DC4<"), "AUS lists its own DC4");
  ok(!aus.includes("50-60-225121"), "AUS does not list Cedar Rapids DC4");
  eq(Pages.jobsForCampus(jobs, "CDR E1").map((j) => j.job_number).sort(), ["50-60-225120", "50-60-225121"]);
  eq(Pages.jobsForCampus(jobs, "DFW2").length, 0);
});

check("a project route renders only that job, with Campus > Project", () => {
  const scope = Pages.reviewScope(jobs, "60-26-100191");
  eq(scope.jobs.map((j) => j.job_number), ["60-26-100191"]);
  eq(scope.projects, ["60-26-100191"]);
  const model = Rev.build({
    jobs: scope.jobs, projects: scope.projects, labor, rentals: [], purchases: [],
    week: "2026-09-20", today: "2026-10-02", showNames: true,
  });
  const review = Pages.retargetReview(Rev.html(model), "60-26-100191", "2026-09");
  ok(!review.includes("#/review?"), "review tabs stay on the project");
  ok(review.includes("#/p/60-26-100191?m=2026-09&tab="), "tabs keep the job");
  ok(!review.includes("Ada Lopez") && !review.includes("Bea Cho"), "another job's labor is not in this review");
  ok(!review.includes("50-60-225121") && !review.includes("50-60-225008"), "other job numbers are not rendered");
  const html = Pages.project({ job: scope.job, month: "2026-09", rows, reviewHtml: review, tab: "labor" });
  ok(html.includes("AUS &gt; DC4") || html.includes("AUS > DC4"), "header is Campus > Project, using the short name");
  ok(html.includes('href="#/c/AUS?m=2026-09"'), "a control returns to that campus");
  ok(html.includes("60-26-100191"), "this job");
  ok(!html.includes("50-60-225121") && !html.includes("50-60-225008") && !html.includes("50-60-225120"), "not the other jobs");
  ok(html.includes("$2,500") && !html.includes("$29,139") && !html.includes("$8,500"), "labor, rentals, and purchases are this job's month");
  const cdr = Pages.reviewScope(jobs, "50-60-225121");
  const cdrReview = Rev.html(Rev.build({ jobs: cdr.jobs, projects: cdr.projects, labor, rentals: [], purchases: [], week: "2026-09-20", today: "2026-10-02", showNames: true }));
  ok(cdrReview.includes("Ada Lopez"), "this job's labor is on its page");
  ok(!cdrReview.includes("Bea Cho"), "the other job's labor is not");
});

check("#/review redirects to a project, a campus, or the portfolio", () => {
  eq(Pages.reviewRedirect({ page: "review", q: {} }, null), "#/");
  eq(Pages.reviewRedirect({ page: "review", q: { m: "2026-09" } }, { projects: null, campuses: null }), "#/?m=2026-09");
  eq(Pages.reviewRedirect({ page: "review", q: { j: "50-60-225121", m: "2026-09", tab: "rental", w: "2026-09-20" } }, null), "#/p/50-60-225121?m=2026-09&tab=rental&w=2026-09-20");
  eq(Pages.reviewRedirect({ page: "review", q: { m: "2026-09" } }, { projects: ["50-60-225008"] }), "#/p/50-60-225008?m=2026-09");
  eq(Pages.reviewRedirect({ page: "review", q: { c: "CDR E1", m: "2026-09" } }, null), "#/c/CDR?m=2026-09");
  eq(Pages.reviewRedirect({ page: "review", q: {} }, { campuses: ["DFW2"] }), "#/c/DFW");
});

check("a missing map script does not throw while pages.js is loading", () => {
  const src = fs.readFileSync(path.join(__dirname, "../app/pages.js"), "utf8");
  const sandbox = { self: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "pages.js" });
  eq(sandbox.self.Pages.CAMPUS_ORDER, ORDER);
  eq(sandbox.self.Pages.campusCode("CDR E1"), "CDR");
});

check("the page script mounts these three routes and does not dump every job on #/", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../app/ui.js"), "utf8");
  ok(ui.includes("Pages.portfolio(") && ui.includes("Pages.campus(") && ui.includes("Pages.project("), "the three pages are what the router mounts");
  ok(ui.includes("Pages.reviewScope(") && ui.includes("Pages.reviewRedirect("), "a project is scoped, and #/review leaves the checkbox page");
  ok(!ui.includes("jobCard("), "the old project-card column is gone");
  ok(!ui.includes("data-dive-job"), "the portfolio no longer opens one long review of every job");
});

done();
