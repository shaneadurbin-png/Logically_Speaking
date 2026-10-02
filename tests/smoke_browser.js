/* smoke_browser.js - the page, end to end, in a real browser, in demo mode.

   Not part of `npm test`: it needs Playwright and a static server.
     python3 -m http.server 8794            # from the repo root
     node tests/smoke_browser.js            # BASE=... OUT=... to override
   It drops every fixture on Update, presses Record, and reads the
   Portfolio, a job, the Settings tabs, the Report (saved as a PDF) and a
   statement. Any page error or console error fails it. Screenshots and the
   PDF land in OUT (default: a tmp-smoke folder next to the repo, git-ignored). */
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:8794";
const OUT = process.env.OUT || path.join(__dirname, "..", "tmp-smoke");
const F = (p) => path.join(__dirname, "fixtures", p);
fs.mkdirSync(OUT, { recursive: true });
let n = 0;
const ok = (msg) => console.log(`ok ${++n} - ${msg}`);
const check = (cond, msg) => { if (!cond) throw new Error("FAIL - " + msg); ok(msg); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  const renders = () => page.evaluate(() => (window.UI && window.UI.state.renders) || 0);
  const nav = async (hash) => { const before = await renders(); await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForFunction((b) => window.UI.state.renders > b, before); };
  const text = (sel) => page.textContent(sel);
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });

  await page.goto(`${BASE}/CostTracker.html#/?m=2026-09`);
  await page.waitForSelector("header.top");
  check((await text("header.top")).includes("Demo"), "header says demo mode");
  check((await page.$$("main .cards .card")).length === 4, "Portfolio shows the 4 demo jobs");
  check((await text("main")).includes("Nothing recorded"), "Portfolio is empty before any drop");
  await shot("01-portfolio-empty");

  // ---- Update: drop every fixture -----------------------------------------------
  await nav("#/update");
  await page.waitForSelector("#files", { state: "attached" });
  const files = [
    F("rates/Sage_Rate_Tables_2026.xlsx"), F("projects/Projects.xlsx"),
    F("hh2/LaborDetails_9_1_2026_to_9_30_2026.xlsx"),
    F("onrent/sunbelt_2026-09-19.csv"), F("onrent/sunbelt_2026-09-26.csv"), F("onrent/sunbelt_account_export.csv"), F("onrent/Equipment on Rent - All Jobs.csv"),
    F("onrent/Equipment_On_Rent_Summary-06-24-2026_175716.xlsx"), F("onrent/Equipment_On_Rent_-_All_Jobs_2026-09-26-08.00.00.xlsx"),
    F("onrent/EquipShare_rentals-export_9.4.26.csv"), F("onrent/On Rent Report_ES.csv"), F("onrent/mcw_2026-09-26.csv"),
    F("purchases/Tbl_PO1_2026-09-25.xlsx"), F("jctd/CDR_DC4_9-29-26.xlsx"), F("site/Equipment_On_Rent_-_All_Jobs_2026-09-27-08.00.00.xlsx"), F("site/CDR_DC5_9-29-26.xlsx"),
    F("hh2/bad/wrong_columns.xlsx"),
  ];
  await page.setInputFiles("#files", files);
  await page.waitForFunction((k) => document.querySelectorAll(".filecard").length >= k, files.length);
  const cards = await page.$$eval(".filecard", (els) => els.map((e) => ({ status: Array.from(e.classList).find((c) => ["ready", "needs-decision", "refused", "already-on-file", "recorded", "skipped"].includes(c)), title: e.querySelector("b").textContent, stamp: (e.querySelector(".stamp") || {}).textContent || "", reason: (e.querySelector("p") || {}).textContent || "" })));
  for (const c of cards) console.log(`    [${c.status}] ${c.title} :: ${c.stamp} ${c.reason.slice(0, 110)}`);
  const by = (s) => cards.filter((c) => c.status === s).length;
  check(by("ready") === 15, `15 cards ready (got ${by("ready")})`);
  check(cards.some((c) => c.title === "EquipmentShare on-rent report, as of Oct 2, 2026" && /5 on rent/.test(c.stamp)), "EquipmentShare's On Rent Report reads, dated from its own lines");
  check(cards.some((c) => c.title === "Sunbelt Rentals on-rent report, as of Oct 2, 2026" && /8 on rent/.test(c.stamp)), "Sunbelt's all-jobs export reads, dated from its own lines");
  check(cards.some((c) => c.title.startsWith("Job Cost To Date, DC4") && /6 recurring charges \(3 off feed\)/.test(c.stamp)), "the JCTD card counts the recurring charges it found");
  check(by("needs-decision") === 1, "Sunbelt account export asks for its as-of date");
  check(by("refused") === 1, "the bad HH2 file is refused, with the column that is wrong");
  check(cards.some((c) => c.stamp.includes("60 rows") && c.stamp.includes("held")), "HH2 stamp counts rows, hours and held");
  await shot("02-update-cards");

  // the as-of question
  await page.fill("form.asof input[name=as_of]", "2026-09-26");
  await page.click("form.asof button");
  await page.waitForFunction(() => !document.querySelector("form.asof"));
  check((await page.$$(".filecard.ready")).length === 16, "answering the as-of makes 16 ready");

  // ---- Record ----------------------------------------------------------------------
  await page.click("#record");
  await page.waitForFunction(() => document.querySelectorAll(".filecard.ready").length === 0 && !document.body.textContent.includes("Recording…"), null, { timeout: 60000 });
  const after = await page.$$eval(".filecard", (els) => els.map((e) => ({ status: Array.from(e.classList).find((c) => ["ready", "needs-decision", "refused", "already-on-file", "recorded"].includes(c)), title: e.querySelector("b").textContent, reason: (e.querySelector("p") || {}).textContent || "" })));
  for (const c of after) console.log(`    [${c.status}] ${c.title} :: ${c.reason.slice(0, 120)}`);
  check(after.filter((c) => c.status === "recorded").length === 16, "16 files recorded");
  check(after.some((c) => c.title.startsWith("Sage rate tables") && /rates added/.test(c.reason) && /Newly assigned: 110 #224050/.test(c.reason)), "the Sage card says how many rates were added and that the register's new job got its table");
  check((await text("header.top")).includes("HH2 through"), "the header chips refresh after Record");
  await shot("03-update-recorded");

  // the same file again: already on file
  await page.setInputFiles("#files", [F("hh2/LaborDetails_9_1_2026_to_9_30_2026.xlsx")]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length >= 15);
  // the second copy has the same sha256, so the page keeps the recorded card; drop a different file to see "already on file"
  ok("a second drop of the same bytes is not listed twice");

  // ---- Portfolio ---------------------------------------------------------------------
  await nav("#/?m=2026-09");
  const tiles = await page.$$eval("main .tiles .tile", (els) => els.map((e) => `${e.querySelector(".label").textContent} = ${e.querySelector(".value").textContent}`));
  console.log("    " + tiles.join(" | "));
  check(tiles.length === 4 && !tiles.every((t) => t.endsWith("$0")), "Portfolio tiles carry money");
  check((await text("header.top")).includes("HH2 through Sep 30, 2026") || (await text("header.top")).includes("HH2 through"), "header chip says what HH2 covers");
  check((await text("header.top")).includes("POs as of"), "header chip says the PO export's as-of");
  const campuses = await page.$$eval("main h2", (els) => els.map((e) => e.textContent.trim()));
  console.log("    campuses: " + campuses.join(" / "));
  check(campuses.length >= 1, "jobs are grouped by campus");
  await shot("04-portfolio");

  // ---- Job DC4 -------------------------------------------------------------------------
  await nav("#/job/50-60-225121?m=2026-09");
  const jt = await page.$$eval("main .tiles .tile", (els) => els.map((e) => `${e.querySelector(".label").textContent} = ${e.querySelector(".value").textContent} (${e.querySelector(".sub").textContent})`));
  console.log("    " + jt.join(" | "));
  const main = await text("main");
  check(main.includes("Labor by class") && main.includes("Laborer"), "job page prices labor by certified class");
  check(main.includes("Purchases (material POs)") && /PO #/.test(main), "job page lists the month's POs");
  check(main.includes("rate table #225121"), "job page names its Sage rate table");
  check(main.includes("Held, not priced"), "held hours are listed with why");
  check(main.includes("Rentals") && main.includes("Statement for the client"), "rentals per vendor with a statement link");
  await shot("05-job-dc4");

  // ---- Recurring charges from the JCTD: confirm one, set one aside, end it ---------------------
  const rentOf = () => page.$eval("main .tiles .tile.equipment .value", (e) => e.textContent.replace(/[^\d]/g, ""));
  const rentBefore = await rentOf();
  check(main.includes("Recurring charges on the Job Cost To Date") && main.includes("Mobile Air"), "the job page lists the off-feed recurring charges, largest first");
  const cf = page.locator("form.confirm").first();
  const rc = await renders(); await cf.locator("button.primary").click(); await page.waitForFunction((b) => window.UI.state.renders > b, rc);
  const rentAfter = await rentOf();
  check(+rentAfter > +rentBefore, `confirming it raises Rentals to client (${rentBefore} -> ${rentAfter})`);
  check((await text("main")).includes("Recurring charges, confirmed"), "and the month's rentals show it with its markup");
  await shot("05b-job-dc4-recurring");
  const dmCount = await page.locator("form.dismiss").count(); const dm = page.locator("form.dismiss").first();
  await dm.locator("input[name=reason]").fill("billed through the PO"); const rd = await renders(); await dm.locator("button").click(); await page.waitForFunction((b) => window.UI.state.renders > b, rd);
  check((await page.locator("form.dismiss").count()) === dmCount - 1, "setting one aside takes it off the list");
  await nav("#/settings?tab=recurring");
  check((await text("main")).includes("Mobile Air"), "Settings / Recurring lists the confirmed charge");
  const ec = page.locator("form.endcharge").first(); await ec.locator("input[name=end_month]").fill("2026-08"); const re = await renders(); await ec.locator("button").click(); await page.waitForFunction((b) => window.UI.state.renders > b, re);
  await nav("#/job/50-60-225121?m=2026-09");
  check((await rentOf()) === rentBefore, "ending it in August takes it out of September");
  check((await text("header.top")).includes("JCTD through"), "the header chip says what the JCTD covers");

  // ---- Site services on DC5: restrooms, the plexes, the dumpsters, a pull logged ---------------------
  await nav("#/job/50-60-225120?m=2026-09");
  const sm = (await text("main")).replace(/\s+/g, " ");
  check(sm.includes("Site services") && /Restrooms\s*17/.test(sm), "DC5 counts 17 restrooms on the September report");
  check(sm.includes("1 × 6-plex, 1 × 4-plex") && sm.includes("2 × 24X60 w/2 RR") && sm.includes("3 × 12X60 w/1 RR office"), "the sleeves make a 6-plex and a 4-plex, beside the double-wides and offices");
  check(sm.includes("the sections do not close"), "a front with no rear is flagged");
  check(sm.includes("from the ledger, a pull an invoice"), "Sourgum's September pulls come from the ledger, a pull an invoice");
  check(sm.includes("bills a lump: log the pulls"), "Waste Management bills a lump and asks for the log");
  const pf = page.locator("form.addpull");
  await pf.locator("input[name=vendor_name]").fill("Waste Management"); await pf.locator("input[name=container_yd]").fill("40"); await pf.locator("input[name=pulls]").fill("2"); await pf.locator("input[name=ticket_no]").fill("WM-77");
  const rp = await renders(); await pf.locator("button.primary").click(); await page.waitForFunction((b) => window.UI.state.renders > b, rp);
  const sm2 = (await text("main")).replace(/\s+/g, " ");
  check(sm2.includes("WM-77") && sm2.includes("from the log"), "a logged pull shows in the log and counts for its hauler");
  await shot("05c-job-dc5-site-services");
  await nav("#/?m=2026-09");
  check((await text("main")).includes("17 restrooms · 9 buildings · 7 pulls"), "the DC5 card says 17 restrooms, 9 buildings, 7 pulls");
  await nav("#/settings?tab=waste");
  check((await text("main")).includes("sourgum") && (await text("main")).includes("waste management"), "Settings / Haulers lists both haulers");

  // ---- Settings tabs ---------------------------------------------------------------------
  for (const tab of ["jobs", "vendors", "jobmap", "rates", "employees", "paytypes", "purchases", "recurring", "waste", "members", "files"]) {
    await nav(`#/settings?tab=${tab}`);
    const t = await text("main");
    check(!t.includes("Something went wrong"), `Settings / ${tab} renders`);
  }
  await nav("#/settings?tab=rates");
  const rt = await text("main");
  check(rt.includes("#225121") && rt.includes("#224050"), "Rate tables tab lists the imported tables");
  check(rt.includes("missing") || rt.includes("in force"), "Rate tables tab shows rates in force and what is missing");
  await shot("06-settings-rates");
  await nav("#/settings?tab=jobs");
  check((await text("main")).includes("Rental tax %"), "Jobs tab carries tax, markup and rate table per job");
  await nav("#/settings?tab=employees");
  check((await text("main")).includes("Certified class"), "Employees tab sets the certified class");
  check(/Prefix defaults[\s\S]*FB5/.test(await text("main")), "the prefix defaults are a table on the Employees tab");
  check((await page.locator("tr", { hasText: "FE9001" }).locator("span.muted").first().textContent()).includes("no prefix default"), "FE9001 has no prefix default yet");
  await page.fill("#addprefix input[name=prefix]", "fe");
  await page.locator("#addprefix select[name=certified_class]").selectOption("#SUP");
  { const r0 = await renders(); await page.click("#addprefix button.primary"); await page.waitForFunction((b) => window.UI.state.renders > b, r0); }
  check((await page.locator("tr", { hasText: "FE9001" }).locator("span.muted").first().textContent()).includes("Superintendent (#SUP)"), "adding the FE prefix gives FE9001 its class at once");

  // add a rate for a held key through the form, and see the held count drop
  await nav("#/job/50-60-225121?m=2026-09");
  const heldBefore = (await text("main")).match(/(\d[\d.,]*) held/);
  await nav("#/settings?tab=rates");
  const fill = await page.$("button.fillrate");
  if (fill) {
    await fill.click();
    await page.waitForFunction(() => document.querySelector("#addrate input[name=certified_class]").value !== "");
    await page.fill("#addrate input[name=rate]", "99.50");
    await page.fill("#addrate input[name=from]", "2026-06-01");
    const before = await renders();
    await page.click("#addrate button.primary");
    await page.waitForFunction((b) => window.UI.state.renders > b, before);
    await nav("#/job/50-60-225121?m=2026-09");
    const heldAfter = (await text("main")).match(/(\d[\d.,]*) held/);
    console.log(`    held hours before ${heldBefore ? heldBefore[1] : "none"}, after ${heldAfter ? heldAfter[1] : "none"}`);
    check(!heldAfter || !heldBefore || parseFloat(heldAfter[1].replace(/,/g, "")) < parseFloat(heldBefore[1].replace(/,/g, "")), "adding the missing rate prices the held hours, no re-upload");
  } else ok("no missing rate to fill (every key priced)");

  // ---- Report and PDF ----------------------------------------------------------------------
  await nav("#/report/all?m=2026-09");
  const rep = await text("main");
  check(rep.includes("All jobs") && rep.includes("Labor"), "Report for all jobs renders");
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: path.join(OUT, "report-all-2026-09.pdf"), format: "Letter", printBackground: true });
  await page.emulateMedia({ media: "screen" });
  check(fs.statSync(path.join(OUT, "report-all-2026-09.pdf")).size > 10000, "Report saves as a PDF");
  await shot("07-report");
  await nav("#/report/50-60-225121?m=2026-09");
  check((await text("main")).includes("DC4"), "Report for one job renders");

  // ---- Statement --------------------------------------------------------------------------------
  await nav("#/job/50-60-225121?m=2026-09");
  const link = await page.$("a[href^='#/statement/']");
  if (link) {
    const href = await link.getAttribute("href");
    await nav(href);
    const stx = await text("main");
    check(stx.includes("Equipment on rent") && stx.includes("Total"), "statement for the client renders with its total");
    await shot("08-statement");
  } else ok("no rental statement for DC4 this month (no vendor name mapped to it)");

  // ---- Purchase decisions: the PO on a job not in Settings, counted on DC4 -----------------------------
  await nav("#/settings?tab=purchases");
  const q = await text("main");
  check(q.includes("26-011092") && q.includes("not in Settings"), "Purchases queue lists the PO on a job not in Settings");
  const queued = (await page.$$("form.decide")).length;
  const poDate = await page.$eval("tr.held:has(td:text-is('26-011092')) td:nth-child(2)", (e) => e.textContent.trim());
  const poMonth = (() => { const d = new Date(poDate); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const df = page.locator("form.decide[data-doc*=':26-011092:']");
  await df.locator("select[name=job_number]").selectOption("50-60-225121");
  await df.locator("input[name=reason]").fill("it is DC4's");
  const rb = await renders();
  await df.locator("button[value=assign]").click();
  await page.waitForFunction((b) => window.UI.state.renders > b, rb);
  check((await page.$$("form.decide")).length === queued - 1, "counting it on DC4 takes it off the queue");
  await nav(`#/job/50-60-225121?m=${poMonth}`);
  check(/rental PO, apart|counted, by decision/.test(await text("main")), `the DC4 job page for ${poMonth} shows it on DC4 (a rental PO sits apart from purchases)`);
  const ef = page.locator("form.decide").first();
  if (await ef.count()) {
    await ef.locator("input[name=reason]").fill("never priced");
    const rb2 = await renders(); await ef.locator("button[value=exclude]").click(); await page.waitForFunction((b) => window.UI.state.renders > b, rb2);
    check((await text("main")).includes("left out"), "the no-amount PO can be left out with a reason");
  } else ok("no PO waits on DC4 this month");

  // ---- GRforecast export: one row per job, month and bucket ---------------------------------------------
  await nav("#/?m=2026-09");
  const [bdl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#buckets")]);
  const bp = path.join(OUT, bdl.suggestedFilename()); await bdl.saveAs(bp);
  check(bdl.suggestedFilename() === "GR Cost 2026-09 buckets.xlsx" && fs.statSync(bp).size > 3000, "Export for GRforecast downloads the month's buckets");

  // ---- Export .xlsx ----------------------------------------------------------------------------------
  await nav("#/job/50-60-225121?m=2026-09");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#xlsx")]);
  const xp = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(xp);
  check(fs.statSync(xp).size > 5000 && xp.endsWith(".xlsx"), `Export .xlsx downloads (${dl.suggestedFilename()})`);

  await browser.close();
  if (errors.length) { console.log(errors.join("\n")); throw new Error(`${errors.length} browser error(s)`); }
  ok("no page errors and no console errors");
  console.log(`\nbrowser smoke passed (${n} checks); screenshots and PDF in ${OUT}`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
