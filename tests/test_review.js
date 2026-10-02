/* test_review.js - the weekly cost review: pay buckets, week windows, burdened rent. */
"use strict";
const { check, eq, ok, done } = require("./lib.js");
const Rev = require("../app/review.js");

const jobs = [
  { job_number: "50-60-225121", short_name: "DC4", campus: "CDR E1" },
  { job_number: "50-60-225008", short_name: "204", campus: "SBN" },
];
const settings = { vendors: { united_rentals: { taxable: true }, sunbelt: { taxable: true } },
  jobs: { "50-60-225121": { tax_bp: 700, markup_bp: 1000, markup_base: "rent_plus_tax" }, "50-60-225008": { tax_bp: 0, markup_bp: 0, markup_base: "rent" } } };

function laborRow(over) {
  return Object.assign({ week_ending: "2026-09-20", job_number: "50-60-225121", employee: "Ada Lopez", employee_key: "FB5001",
    certified_class: "#LAB-J", cost_code: "01-02", cost_code_name: "General Requirements", pay_type: "REG", pay_type_name: "REG", hours: 8, cost_cents: 69800 }, over);
}

check("pay buckets: UNION REG is regular, overtime and double time split", () => {
  eq(Rev.payBucket("UNION REG", "UNION REG"), "reg");
  eq(Rev.payBucket("REG", "REG"), "reg");
  eq(Rev.payBucket("UNION O/T", "UNION O/T"), "ot");
  eq(Rev.payBucket("O/T", "OT"), "ot");
  eq(Rev.payBucket("OVERTIME", "OVERTIME"), "ot");
  eq(Rev.payBucket("UNION D/T", "UNION D/T"), "dt");
  eq(Rev.payBucket("DT", "DT"), "dt");
  eq(Rev.payBucket("DOUBLETIME", "DOUBLETIME"), "dt");
});

check("weekly burden is monthly divided by 4.3, half away from zero", () => {
  eq(Rev.weeklyOf(117700), 27372);
  eq(Rev.weeklyOf(0), 0);
});

check("labor burn is the selected week, priced rows only, names hidden when asked", () => {
  const labor = [
    laborRow({}),
    laborRow({ employee: "Ben Cho", employee_key: "FB8001", certified_class: "#CARP-J", pay_type: "O/T", pay_type_name: "O/T", hours: 2, cost_cents: 25500, cost_code_name: "Cleanup" }),
    laborRow({ employee_key: "FB5001", pay_type: "DOUBLETIME", hours: 1, cost_cents: 14950 }),
    laborRow({ week_ending: "2026-09-13", hours: 40, cost_cents: 99999, employee_key: "FB5002", employee: "Cara Diaz", certified_class: "#CARP-J" }),
    laborRow({ job_number: "50-60-225008", employee_key: "FB5009", employee: "South Bend", hours: 5, cost_cents: 1000 }),
  ];
  const m = Rev.build({ jobs, labor, week: "2026-09-20", showNames: true, today: "2026-10-02" });
  eq(m.week, "2026-09-20");
  eq(m.labor.cost, 69800 + 25500 + 14950 + 1000);
  eq(m.labor.reg, 13);
  eq(m.labor.ot, 2);
  eq(m.labor.dt, 1);
  eq(m.labor.headcount, 3);
  eq(m.labor.byCode[0].label, "General Requirements");
  const prior = m.labor.weeks4.find((w) => w.week === "2026-09-13");
  eq(prior.carpenter, 40);
  eq(m.labor.weeks4.find((w) => w.week === "2026-09-20").laborer, 14);
  eq(m.labor.weeks4.find((w) => w.week === "2026-09-20").carpenter, 2);
  const hidden = Rev.build({ jobs, labor, week: "2026-09-20", showNames: false });
  ok(hidden.labor.employees.every((e) => e.employee === "—"), "a viewer does not see a name");
  eq(hidden.labor.headcount, 3);
  const campus = Rev.build({ jobs, labor, week: "2026-09-20", campuses: ["SBN"] });
  eq(campus.labor.cost, 1000);
  eq(campus.labor.headcount, 1);
});

check("rentals on rent are burdened; off-rent lines and the week slicer do not change them", () => {
  const rentals = [
    { job_number: "50-60-225121", vendor_key: "united_rentals", vendor_name: "United Rentals", description: "Scissor Lift", category: "Aerial", qty: 2, monthly_rent_cents: 100000 },
    { job_number: "50-60-225121", vendor_key: "sunbelt", vendor_name: "Sunbelt Rentals", description: "Forklift", category: "Aerial", qty: 1, monthly_rent_cents: 50000, off_rent_date: "2026-09-01" },
  ];
  const a = Rev.build({ jobs, rentals, rentalSettings: settings, week: "2026-09-20", tab: "rental" });
  const b = Rev.build({ jobs, rentals, rentalSettings: settings, week: "2026-08-02", tab: "rental" });
  eq(a.rental.lines, 1);
  eq(a.rental.qty, 2);
  eq(a.rental.monthly, 117700);
  eq(a.rental.weekly, 27372);
  eq(a.rental.vendors[0].label, "United Rentals");
  eq(a.rental.vendors[0].color, "#081E3E");
  eq(a.rental.categories[0].label, "Aerial");
  eq(b.rental.monthly, a.rental.monthly);
});

check("committed POs use the week, last week, month and year windows; pending stays blank", () => {
  const purchases = [
    { doc_date: "2026-09-18", doc_number: "PO-1", job_number: "50-60-225121", supplier: "Acme", committed_cents: 250000 },
    { doc_date: "2026-09-20", doc_number: "PO-2", job_number: "50-60-225121", supplier: "Acme", committed_cents: null },
    { doc_date: "2026-09-10", doc_number: "PO-3", job_number: "50-60-225121", supplier: "Bolt", committed_cents: 10000 },
    { doc_date: "2026-08-02", doc_number: "PO-4", job_number: "50-60-225121", supplier: "Bolt", committed_cents: 40000 },
    { doc_date: "2025-12-15", doc_number: "PO-5", job_number: "50-60-225121", supplier: "Old", committed_cents: 999 },
    { doc_date: "2026-09-18", doc_number: "PO-Q", job_number: "50-60-225121", supplier: "Acme", committed_cents: 1, quote: true },
    { doc_date: "2026-09-18", doc_number: "PO-X", job_number: "50-60-225121", supplier: "Acme", committed_cents: 1, cancelled: true },
    { doc_date: "2026-09-18", doc_number: "PO-R", job_number: "50-60-225121", supplier: "United", committed_cents: 1, order_type: "Rental" },
  ];
  const m = Rev.build({ jobs, purchases, week: "2026-09-20", tab: "po", today: "2026-10-02" });
  eq(m.po.tw.cents, 250000);
  eq(m.po.tw.count, 2);
  eq(m.po.tw.pending, 1);
  eq(m.po.lw.cents, 10000);
  eq(m.po.lw.count, 1);
  eq(m.po.mtd.cents, 260000);
  eq(m.po.mtd.count, 3);
  eq(m.po.ytd.cents, 300000);
  eq(m.po.ytd.count, 4);
  eq(m.po.nAll, 5);
  eq(m.po.nValued, 4);
  ok(m.po.rows.some((r) => r.po === "PO-2" && r.committed == null), "an unvalued PO stays pending");
  ok(!m.po.rows.some((r) => r.po === "PO-Q" || r.po === "PO-X" || r.po === "PO-R"), "quotes, cancellations and rental POs stay out");
});

check("the page is the three-tab review, and an empty workspace still renders", () => {
  const m = Rev.build({ jobs, today: "2026-10-02", week: "2026-09-20" });
  const page = Rev.html(m);
  ok(page.includes("GR Weekly Cost Review"), "title");
  ok(page.includes("Weekly Labor Burn") && page.includes("Weekly Rental Burn") && page.includes("Weekly Committed POs"), "tabs");
  const rental = Rev.html(Object.assign({}, m, { tab: "rental" }));
  ok(rental.includes("Week Ending selection does not apply"), "rental tab says the week slicer does not apply");
  ok(rental.includes("monthly ÷ 4.3"), "weekly is monthly divided by 4.3");
  const po = Rev.html(Object.assign({}, m, { tab: "po" }));
  ok(po.includes("not yet valued in Sage"), "pending copy");
  ok(page.includes('id="kpiLaborCost">$0.00'), "empty labor is zero, not blank");
  ok(page.includes("Sage committed values post after PO issuance"), "the committed note is the copied dashboard");
  ok(page.includes("Prepared by Shane Durbin, Liberty Builds"), "the footer is the copied dashboard");
  ok(page.includes("On-rent snapshot as of"), "the rental note is the copied dashboard");
  ok(page.includes('class="grid g-labor"'), "labor uses the dashboard grid");
  eq(m.week, "2026-09-20");
  ok(!page.includes("Select all"), "no select-all control");
  ok(!/data-project|data-only-project|type="checkbox"/.test(page), "no project checkbox list");
  ok(!page.includes(">only<"), "no only links");
  const one = Rev.build({ jobs, today: "2026-10-02", week: "2026-09-20", projects: ["50-60-225121"] });
  const onePage = Rev.html(one);
  ok(onePage.includes("CDR E1 > DC4"), "one project is labeled Campus > Project");
  ok(!onePage.includes("Select all") && !/type="checkbox"/.test(onePage), "one project still has no checkbox list");
});

check("week ending 9/20/26 is the default when that week is in the data", () => {
  const labor = [
    laborRow({}),
    laborRow({ week_ending: "2026-09-27", employee_key: "FB9001", employee: "Later", hours: 1, cost_cents: 1 }),
  ];
  eq(Rev.build({ jobs, labor, today: "2026-10-02" }).week, "2026-09-20");
  eq(Rev.build({ jobs, labor: [laborRow({ week_ending: "2026-09-27" })], today: "2026-10-02" }).week, "2026-09-27");
  eq(Rev.build({ jobs, labor, week: "2026-09-27", today: "2026-10-02" }).week, "2026-09-27");
});

done();
