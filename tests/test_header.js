/* test_header.js - the top header is navigation, not a stack of uploaded reports. */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { check, eq, ok, done } = require("./lib.js");

function loadUI() {
  const uiPath = path.join(__dirname, "../app/ui.js");
  const src = fs.readFileSync(uiPath, "utf8");
  const release = (src.match(/const RELEASE = "([^"]+)"/) || [])[1];
  const sandbox = {
    console,
    Common: require("../app/common.js"),
    Buckets: {},
    LaborModel: {},
    RentalsModel: {},
    ReviewModel: {},
    OnRentVendors: { vendorName: (k) => k },
    SiteServices: {},
    Intake: {},
    ExportXlsx: {},
    CostConfig: { RELEASE: release },
    PortfolioMap: {},
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: uiPath });
  return sandbox.UI;
}

const UI = loadUI();
const files = [
  "LaborDetails_9_1_2026_to_9_30_2026.xlsx",
  "sunbelt_2026-09-19.csv",
  "sunbelt_2026-09-26.csv",
  "Equipment on Rent - All Jobs.csv",
  "Tbl_PO1_2026-09-25.xlsx",
  "CDR_DC4_9-29-26.xlsx",
  "Sage_Rate_Tables_2026.xlsx",
];

function render(over) {
  return UI.headerMarkup(Object.assign({
    page: "",
    canEdit: true,
    mode: "demo",
    home: "#/?m=2026-09",
    freshness: {
      hh2_through: "2026-09-30",
      onrent_as_of: { sunbelt: "2026-09-26", united_rentals: "2026-09-19", herc: "2026-09-27", equipmentshare: "2026-10-02" },
      po_as_of: "2026-09-25",
      jctd_through: "2026-09-29",
      jctd_jobs: 4,
      uploads: files.map((file_name) => ({ file_name })),
    },
    reports: files.map((file_name) => ({ file_name, title: file_name })),
  }, over)).s;
}

check("header render does not stack uploaded report file names", () => {
  const s = render();
  eq((s.match(/<header/g) || []).length, 1);
  ok(s.includes('class="top"'), "one top header");
  ok(s.includes("Portfolio") && s.includes("Review") && s.includes("Update") && s.includes("Settings"), "navigation stays");
  ok(s.includes("Demo: nothing is saved"), "session chip stays");
  eq((s.match(/class="chip/g) || []).length, 1, "only the session chip, not one chip per report");
  ok(!/<ul|filecard|<li/.test(s), "no stacked file list");
  for (const name of files) ok(!s.includes(name), name);
  ok(!/HH2 through|No HH2 yet|on-rent report|POs as of|No PO export|JCTD through|No JCTD yet|Sunbelt|United Rentals|Herc|EquipmentShare/.test(s), "freshness chips are not drawn");
});

check("header stays clear of reports on campus, project, and review routes", () => {
  for (const page of ["", "review", "job", "update"]) {
    const s = render({ page, home: "#/?m=2026-09&c=PHL&j=50-60-225121" });
    for (const name of files) ok(!s.includes(name), `${page} ${name}`);
    ok(!/HH2 through|POs as of|JCTD through/.test(s), page);
    ok(s.includes(">Portfolio<"), page + " portfolio link");
  }
});

check("a viewer header still omits the report list", () => {
  const s = render({ canEdit: false, mode: "live", user: { email: "ada@liberty.example" }, role: "viewer" });
  ok(!s.includes(">Update<"), "viewers do not see Update");
  ok(s.includes("ada@liberty.example") && s.includes("viewer"), "session stays");
  eq((s.match(/class="chip/g) || []).length, 1);
  for (const name of files) ok(!s.includes(name), name);
});

check("topView is the headerMarkup path and does not inline report chips", () => {
  const src = fs.readFileSync(path.join(__dirname, "../app/ui.js"), "utf8");
  const start = src.indexOf("async function topView");
  const end = src.indexOf("const titleBlock");
  ok(start > 0 && end > start, "topView is present");
  const body = src.slice(start, end);
  ok(body.includes("headerMarkup"), "topView renders headerMarkup");
  ok(!/HH2 through|No on-rent report|POs as of|JCTD through|fileName|file_name/.test(body), "topView does not print report names");
});

done();
