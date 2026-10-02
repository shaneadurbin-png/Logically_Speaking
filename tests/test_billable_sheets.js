/* test_billable_sheets.js - Liberty build-up workbooks and billable PDFs,
   read into the same shape as a Sage rate table export.
   The customer workbooks live outside the repo. The generated workbook is
   what CI runs; the /tmp drop is checked when those files are on the machine. */
"use strict";
const fs = require("fs"), path = require("path");
const { check, checkAsync, eq, ok, refuses, done, C } = require("./lib.js");
const B = require("../app/billable_sheets.js");
const S = require("../app/sniff.js");
const Intake = require("../app/intake.js");
const XLSX = require("../app/vendor/xlsx.full.min.js");

function grid(titles, banner, rates) {
  const rows = Array.from({ length: 12 }, () => []);
  const origins = [2, 8, 14];
  const payCols = [[3, 5, 7], [9, 11, 13], [15, 17, 19]];
  titles.forEach((t, i) => { rows[4][origins[i]] = t; rows[5][origins[i]] = banner; });
  payCols.forEach((cols) => { rows[6][cols[0]] = "ST"; rows[6][cols[1]] = "OT"; rows[6][cols[2]] = "DT"; });
  rows[8][2] = "Hourly Wage"; rows[8][3] = 30.47;
  rows[10][2] = "Billable Rate (Standard)";
  rates.forEach((trio, i) => { trio.forEach((n, k) => { rows[10][payCols[i][k]] = n; }); });
  rows[11][2] = "Billable Rate (WC&GL Excluded)"; rows[11][3] = 1;
  return rows;
}
function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
function rate(doc, code, cls, pay, from) {
  const t = doc.tables.find((x) => x.code === code);
  return t && t.rates.find((r) => r.certified_class === cls && r.pay_id === pay && r.effective_from === from);
}

const va = grid(
  ["VA Laborers", "VA Labor Foremen", "VA General Labor Foremen"],
  "Standard Rates 6/1/25 - 5/31/26",
  [[61, 86.25, 111.5], [65, 91.5, 117.75], [66.75, 94, 121.25]]);
va[4][20] = "Tapers Local 1";
va[5][20] = "Standard Rates 6/1/25 - 5/31/26";
va[6][21] = "ST"; va[6][23] = "OT"; va[6][25] = "DT";
va[10][21] = 12.5; va[10][23] = 18; va[10][25] = 24;
const shifted = Array.from({ length: 10 }, () => []);
shifted[3][1] = "MD Laborers";
shifted[4][1] = "Standard Rates 1/1/26 - 12/31/26";
shifted[5][4] = "ST"; shifted[5][6] = "OT"; shifted[5][8] = "DT";
shifted[9][1] = "Billable Rate (Standard)";
shifted[9][4] = 10; shifted[9][6] = 15; shifted[9][8] = 20;
const lib = (stJ, stGF) => grid(
  ["Laborers - Liberty", "Labor Foreman - Liberty", "General Labor Foreman Texas Trades"],
  "Standard Rates 1/1/25 - 12/31/25",
  [[stJ, stJ + 10, stJ + 20], [52.25, 78.5, 104.5], [stGF, stGF + 10, stGF + 20]]);
const bytes = book([
  ["VA 2025", va],
  ["MD shifted", shifted],
  ["Liberty Labor Rate 2025", lib(36, 77.5)],
  ["Liberty Labor Rate 2026", lib(37.25, 79.75)],
  ["MA old", [["MA Carpenters"], ["Standard Rates through 8/31/16"], ["ST", "OT", "DT"]]],
  ["Empty", [[]]],
]);
const doc = B.read(bytes, "drop/IAD - VA/generated.xlsx");

check("a generated VA block is 6100 cents, both straight pay ids, exclusive end", () => {
  eq(doc.kind, "sage_rates");
  eq(doc.fileName, "generated.xlsx");
  const reg = rate(doc, "#IAD-VA", "#LAB-J", "REG", "2025-06-01");
  const ureg = rate(doc, "#IAD-VA", "#LAB-J", "UNION REG", "2025-06-01");
  eq(reg.rate_cents, 6100); eq(ureg.rate_cents, 6100);
  eq(reg.effective_to, "2026-06-01"); eq(reg.row_index, 11);
  eq(rate(doc, "#IAD-VA", "#LAB-J", "O/T", "2025-06-01").rate_cents, 8625);
  eq(rate(doc, "#IAD-VA", "#LAB-J", "UNION O/T", "2025-06-01").rate_cents, 8625);
  eq(rate(doc, "#IAD-VA", "#LAB-J", "D/T", "2025-06-01").rate_cents, 11150);
  eq(rate(doc, "#IAD-VA", "#LAB-J", "UNION D/T", "2025-06-01").rate_cents, 11150);
  eq(rate(doc, "#IAD-VA", "#LAB-J", "DOUBLETIME", "2025-06-01").rate_cents, 11150);
  eq(rate(doc, "#IAD-VA", "#LAB-F", "REG", "2025-06-01").rate_cents, 6500);
  eq(rate(doc, "#IAD-VA", "#LAB-GF", "REG", "2025-06-01").rate_cents, 6675);
  ok(doc.tables.find((t) => t.code === "#IAD-VA").description === "IAD Virginia billable");
  ok(!doc.tables.some((t) => t.rates.some((r) => r.rate_cents === 3047 || r.rate_cents === 100 || r.rate_cents === 1250)));
});
check("a shifted MD block is still read, and a taper column is counted not guessed", () => {
  const r = rate(doc, "#IAD-MD", "#LAB-J", "REG", "2026-01-01");
  eq(r.rate_cents, 1000); eq(r.effective_to, "2027-01-01");
  eq(doc.totals.skipped, 2); eq(doc.totals.blank, 1);
  ok(!doc.tables.some((t) => t.classes.some((c) => !["#LAB-J", "#LAB-F", "#LAB-GF"].includes(c))));
});
check("a stuck Liberty banner is redated from the sheet name", () => {
  const j = rate(doc, "#DFW-LIB", "#LAB-J", "REG", "2026-01-01");
  eq(j.rate_cents, 3725); eq(j.effective_to, "2027-01-01");
  eq(rate(doc, "#DFW-LIB", "#LAB-J", "UNION REG", "2025-01-01").rate_cents, 3600);
  eq(rate(doc, "#DFW-LIB", "#LAB-GF", "REG", "2025-01-01").rate_cents, 7750);
  eq(rate(doc, "#DFW-LIB", "#LAB-GF", "REG", "2026-01-01").rate_cents, 7975);
  eq(rate(doc, "#DFW-LIB", "#LAB-F", "REG", "2025-01-01").rate_cents, 5225);
  eq(rate(doc, "#DFW-LIB", "#LAB-F", "REG", "2026-01-01").rate_cents, 5225);
  eq(doc.tables.find((t) => t.code === "#DFW-LIB").classes.includes("#LAB-GF"), true);
});
check("the same banner with no year in the sheet name is refused, not picked", () => {
  const bad = book([
    ["Liberty A", lib(36, 77.5)],
    ["Liberty B", lib(37.25, 79.75)],
  ]);
  refuses(() => B.read(bad, "stuck.xlsx"), /Liberty A.*Liberty B.*1\/1\/25 - 12\/31\/25/);
});
check("an old 'through' banner is not this layout", () => {
  const old = book([["MA", [["MA Carpenters"], ["Standard Rates through 8/31/16"], ["ST", "OT", "DT"]]]]);
  eq(B.looksLike(C.readBook(old)), false);
  eq(S.sniff(bytes, "generated.xlsx").kind, "billable_rates");
});
check("classes the page does not know stay null", () => {
  eq(B.classCode("Tapers Local 1"), null);
  eq(B.classCode("Apprentice Helper"), null);
  eq(B.classCode("Carpenter Apprentice"), null);
  eq(B.classCode("Basic Laborer"), null);
  eq(B.classCode("PROJECT MANAGER"), null);
  eq(B.classCode("Skilled Laborer"), "#LAB-J");
  eq(B.classCode("QA/QC Technician"), "#QAQC");
  eq(B.classCode("Gen. Carpenter Foreman"), "#CARP-GF");
});

(async () => {
  await checkAsync("intake files the workbook as Sage rate tables and does not assign the campus code to a job", async () => {
    const card = await Intake.inspect(bytes, "VA Billable Rate Sheet 2025.xlsx", { labor: { jobs: [{ job_number: "50-60-225121" }] } });
    eq(card.status, "ready"); eq(card.kind, "billable_rates"); eq(card.doc.kind, "sage_rates");
    ok(/^Sage rate tables:/.test(card.title), card.title);
    eq(card.matched, {});
    ok(card.notes.some((n) => /#IAD-VA IAD Virginia billable/.test(n) && /no job in Settings carries this number/.test(n)), card.notes.join(" | "));
  });
  await checkAsync("a PDF that is not a schedule is refused, and the old next-release line stays", async () => {
    const card = await Intake.inspect(Buffer.from("%PDF-1.4\n"), "ticket.pdf", {});
    eq(card.status, "refused");
    ok(/not a Liberty billable rate schedule/.test(card.reason) && /next release/.test(card.reason), card.reason);
  });

  const uploads = "/home/ubuntu/.cursor/projects/workspace/uploads";
  if (fs.existsSync(uploads)) {
    await checkAsync("Iowa #IA, Temple CCIP, and the AUS work order", async () => {
      const iaName = "2025_2028_-IOWA_-_Laborers_Carpenters_25eb.xlsx";
      const ia = B.read(fs.readFileSync(path.join(uploads, iaName)), iaName);
      eq(rate(ia, "#IA", "#CARP-J", "REG", "2025-07-01").rate_cents, 9850);
      eq(rate(ia, "#IA", "#CARP-J", "REG", "2025-07-01").effective_to, "2026-07-01");
      eq(rate(ia, "#IA", "#CARP-J", "REG", "2026-07-01").rate_cents, 10500);
      ok(!ia.tables[0].classes.includes("#QAQC"));
      const temple = "Temple_CCIP_2026-2027_7784.xlsx";
      const t = B.read(fs.readFileSync(path.join(uploads, temple)), temple);
      eq(rate(t, "#TEMPLE-CCIP", "#CARP-J", "REG", "2026-01-01").rate_cents, 8600);
      ok(!rate(t, "#TEMPLE-CCIP", "#CARP-J", "D/T", "2026-01-01"), "2026 #CARP-J double time is left out");
      ok(!t.tables[0].rates.some((r) => r.certified_class === "#CARP-J" && r.rate_cents === 6650));
      const order = "AUS_4_5_CCIP_Billable_Rates_2026_-_Work_Order_01_a27f.pdf";
      let err = null;
      try { await B.readPdf(fs.readFileSync(path.join(uploads, order)), order); }
      catch (e) { err = e; }
      ok(err instanceof C.NotForThisPage, order);
      ok(/banner says CCIP/.test(err.message) && /5%/.test(err.message), err && err.message);
    });
  }
  const drop = "/tmp/rates-drop/Billable Rate Sheets";
  if (fs.existsSync(drop)) {
    await checkAsync("the real VA and MD sheets", async () => {
      for (const [file, code] of [["VA Billable Rate Sheet 2025.xlsx", "#IAD-VA"], ["MD Billable Rate Sheet 2025.xlsx", "#IAD-MD"]]) {
        const d = B.read(fs.readFileSync(path.join(drop, "IAD - VA", file)), file);
        eq(d.tables.map((t) => t.code), [code]);
        eq(d.totals.rates, 21); eq(d.totals.skipped, 0);
        const r = rate(d, code, "#LAB-J", "REG", "2025-06-01");
        eq(r.rate_cents, 6100); eq(r.effective_to, "2026-06-01");
        eq(rate(d, code, "#LAB-F", "REG", "2025-06-01").rate_cents, 6500);
        eq(rate(d, code, "#LAB-GF", "REG", "2025-06-01").rate_cents, 6675);
      }
    });
    await checkAsync("the real DFW workbook keeps Liberty, Texas Trades, and PA apart", async () => {
      const file = "Billable Rates TT and Liberty Finalized.xlsx";
      const d = B.read(fs.readFileSync(path.join(drop, "DFW2 DC1", file)), file);
      eq(d.totals, { tables: 3, rates: 252, skipped: 37, blank: 1 });
      eq(d.tables.map((t) => t.code).sort(), ["#DFW-LIB", "#DFW-TT", "#PA-G3"]);
      eq(rate(d, "#DFW-TT", "#CARP-J", "REG", "2025-01-01").rate_cents, 4400);
      eq(rate(d, "#DFW-TT", "#CARP-F", "REG", "2025-01-01").rate_cents, 5825);
      eq(rate(d, "#DFW-TT", "#CARP-GF", "REG", "2025-01-01").rate_cents, 6450);
      eq(rate(d, "#DFW-TT", "#CARP-J", "REG", "2026-01-01").rate_cents, 4525);
      eq(rate(d, "#DFW-TT", "#CARP-J", "REG", "2026-01-01").effective_to, "2027-01-01");
      const libJ = rate(d, "#DFW-LIB", "#LAB-J", "REG", "2026-01-01");
      eq(libJ.rate_cents, 3725); eq(libJ.effective_to, "2027-01-01");
      eq(rate(d, "#DFW-LIB", "#LAB-J", "REG", "2025-01-01").rate_cents, 3600);
      eq(rate(d, "#DFW-LIB", "#LAB-GF", "REG", "2025-01-01").rate_cents, 7750);
      eq(rate(d, "#DFW-LIB", "#LAB-GF", "REG", "2026-01-01").rate_cents, 7975);
      eq(rate(d, "#DFW-LIB", "#LAB-F", "REG", "2025-01-01").rate_cents, 5225);
      eq(rate(d, "#DFW-LIB", "#LAB-F", "REG", "2028-01-01").rate_cents, 5225);
      eq(rate(d, "#DFW-LIB", "#LAB-GF", "D/T", "2028-01-01").rate_cents, 16900);
      eq(rate(d, "#DFW-TT", "#LAB-J", "REG", "2025-01-01").rate_cents, 3600);
      eq(rate(d, "#DFW-TT", "#LAB-F", "REG", "2025-01-01").rate_cents, 3900);
      eq(rate(d, "#DFW-TT", "#LAB-GF", "REG", "2025-01-01").rate_cents, 5775);
      const pa = rate(d, "#PA-G3", "#LAB-J", "REG", "2024-06-01");
      eq(pa.rate_cents, 3700); eq(pa.effective_to, "2025-06-01");
      eq(rate(d, "#PA-G3", "#LAB-F", "REG", "2024-06-01").rate_cents, 4025);
      eq(rate(d, "#PA-G3", "#LAB-GF", "REG", "2024-06-01").rate_cents, 8575);
      ok(!d.tables.find((t) => t.code === "#PA-G3").rates.some((r) => r.effective_from === "2026-01-01"));
      ok(!d.tables.find((t) => t.code === "#DFW-TT").rates.some((r) => r.certified_class === "#LAB-GF" && r.rate_cents === 7750));
    });
    await checkAsync("the real billable PDFs stay separate tables", async () => {
      const specs = [
        ["PDX/2025_2026- OR Billable Rates - PDX QAQC Rates.pdf", "#PDX-QA", "#CARP-J", "2024-06-01", 11025],
        ["PDX/2025_2026 OR Laborer_Carpenter Billable Rates.pdf", "#PDX-EX2", "#CARP-J", "2025-06-01", 10500],
        ["PDX/LIBERTY- 2025_2028 - OR Billable Rates - Laborers_Carpenters.pdf", "#PDX", "#CARP-J", "2025-06-01", 11125],
        ["SFO 061/2025_2026 - SF Billable Rates - Laborers_Carpenters.pdf", "#SFO", "#CARP-J", "2025-07-01", 16375],
      ];
      const docs = [];
      for (const [rel, code, cls, from, cents] of specs) {
        const name = path.basename(rel);
        const d = await B.readPdf(fs.readFileSync(path.join(drop, rel)), name);
        eq(d.tables.length, 1); eq(d.tables[0].code, code);
        eq(rate(d, code, cls, "REG", from).rate_cents, cents);
        eq(rate(d, code, cls, "UNION REG", from).rate_cents, cents);
        docs.push(d);
      }
      eq(rate(docs[0], "#PDX-QA", "#CARP-J", "REG", "2025-06-01").rate_cents, 11675);
      eq(rate(docs[0], "#PDX-QA", "#LAB-J", "REG", "2024-06-01").rate_cents, 8850);
      eq(rate(docs[0], "#PDX-QA", "#LAB-J", "REG", "2025-06-01").rate_cents, 9500);
      ok(docs[0].tables[0].classes.includes("#QAQC"));
      eq(rate(docs[1], "#PDX-EX2", "#CARP-J", "REG", "2026-06-01").rate_cents, 11125);
      eq(rate(docs[1], "#PDX-EX2", "#CARP-J", "REG", "2027-06-01").rate_cents, 11750);
      eq(rate(docs[2], "#PDX", "#LAB-J", "REG", "2025-06-01").rate_cents, 9525);
      eq(rate(docs[3], "#SFO", "#CARP-J", "REG", "2026-07-01").rate_cents, 17200);
      eq(rate(docs[3], "#SFO", "#CARP-J", "REG", "2027-07-01").rate_cents, 18025);
      eq(rate(docs[3], "#SFO", "#LAB-J", "REG", "2025-07-01").rate_cents, 11300);
      ok(docs[3].tables[0].classes.includes("#QAQC"));
      eq(rate(docs[1], "#PDX-EX2", "#CARP-J", "REG", "2025-06-01").rate_cents === rate(docs[2], "#PDX", "#CARP-J", "REG", "2025-06-01").rate_cents, false);
    });
    await checkAsync("the two union wage notices are refused by name", async () => {
      for (const rel of ["PDX/OR Laborers AGC 2025-2026 rates_.pdf", "PDX/OR SW WA Cascadia (WSAUC) Notification - June 2025.pdf"]) {
        const name = path.basename(rel);
        let err = null;
        try { await B.readPdf(fs.readFileSync(path.join(drop, rel)), name); }
        catch (e) { err = e; }
        ok(err instanceof C.NotForThisPage, name);
        ok(/union's wage notice, not Liberty's billable rate sheet/.test(err.message), err && err.message);
      }
    });
  }
  done();
})();
