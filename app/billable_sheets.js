/* billable_sheets.js - Liberty's billable build-up, read into Sage's shape.

   A workbook is not a Sage export. Each class sits in its own block: a
   title, a "Standard Rates M/D/YY - M/D/YY" banner, and ST / OT / DT
   columns. The only number recorded is the row labeled exactly
   "Billable Rate (Standard)". Cost build-up, WC&GL excluded, GL excluded,
   daily and weekly rows, and the Wilmer summary grids are not rates.
   A sheet with no such row (the old Massachusetts carpenter, laborer, and
   taper tabs) is counted in skipped.

   The table code comes from the class titles on the sheet. The file name
   is only a tie-break. Liberty labor and Texas Trades stay apart, and a
   PA Group 3 tab is not DFW because it lives in the DFW workbook.

   Several Liberty labor year tabs repeat the banner "Standard Rates
   1/1/25 - 12/31/25" while the sheet name carries the year and the dollars
   differ. Those are redated to that calendar year. Carpenter and PA
   banners already change with the year, and those are trusted.

   A PDF is a billable schedule (a place line, trade sections, class rows,
   straight / 1-1/2 / double) or it is refused. The browser has no
   pdftotext: Flate streams are inflated here, and Tj / TJ are decoded
   with the font's ToUnicode CMap or its Type1 Differences. A union wage
   notice is refused by name. Nothing is guessed. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.BillableSheets = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const BANNER_RE = /Standard Rates\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
  const MARKER = "Billable Rate (Standard)";
  const PAY_IDS = {
    ST: ["REG", "UNION REG"],
    OT: ["O/T", "UNION O/T"],
    DT: ["D/T", "UNION D/T", "DOUBLETIME"],
  };
  const GLYPH = {
    space: " ", period: ".", comma: ",", slash: "/", hyphen: "-", minus: "-",
    dollar: "$", percent: "%", ampersand: "&", colon: ":", semicolon: ";",
    parenleft: "(", parenright: ")", quotesingle: "'", quotedbl: '"',
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9",
  };

  function baseName(fileName) {
    return String(fileName || "").replace(/\\/g, "/").split("/").pop();
  }
  function cellText(v) {
    return C.str(v).replace(/\s+/g, " ").trim();
  }
  function sheetEmpty(rows) {
    return !rows.length || rows.every(C.isBlankRow);
  }
  function hasMarker(rows) {
    for (const r of rows) for (const v of r || []) if (cellText(v) === MARKER) return true;
    return false;
  }
  function bannerIn(v) {
    const m = cellText(v).match(BANNER_RE);
    if (!m) return null;
    const from = C.parseDate(m[1]), end = C.parseDate(m[2]);
    if (!from || !end || Number.isNaN(from) || Number.isNaN(end)) return { bad: cellText(v) };
    return { text: `Standard Rates ${m[1]} - ${m[2]}`, from, to: C.addDays(end, 1) };
  }

  /** Certified class the labor model prices, or null when the trade is not one of ours.
      Apprentices, basic laborers, project managers, and welders are not guessed into a journeyman class. */
  function classCode(title) {
    const s = String(title || "").toUpperCase();
    if (/\bAPPRENTICE\b/.test(s)) return null;
    if (/\bBASIC\b/.test(s) && /\bLABOU?RERS?\b/.test(s)) return null;
    if (/\bPROJECT\s+MANAGER\b/.test(s)) return null;
    if (/\bWELDER\b/.test(s)) return null;
    if (/QA\s*\/?\s*QC/.test(s)) return "#QAQC";
    const gen = /\bGENERAL\b/.test(s) || /\bGEN\b/.test(s);
    const fore = /\bFOREMAN\b/.test(s) || /\bFOREMEN\b/.test(s);
    const carp = /\bCARPENTERS?\b/.test(s);
    const lab = /\bLABORERS?\b/.test(s) || /\bLABOR\b/.test(s);
    if (!carp && !lab) return null;
    let trade;
    if (carp && !lab) trade = "CARP";
    else if (lab && !carp) trade = "LAB";
    else trade = s.indexOf("CARP") <= s.indexOf("LAB") ? "CARP" : "LAB";
    if (gen && fore) return `#${trade}-GF`;
    if (fore) return `#${trade}-F`;
    if (/\bCARPENTERS?\b/.test(s) || /\bLABORERS?\b/.test(s)) return `#${trade}-J`;
    return null;
  }

  /** The rate table for one sheet, from its class titles. The file name breaks a tie only. */
  function tableFor(titles, sheetName, fileName) {
    const blob = titles.join(" \n ").toUpperCase();
    const tie = `${sheetName} ${baseName(fileName)}`.toUpperCase();
    const pick = (code, description) => ({ code, description });
    if (/\bPA\b/.test(blob) && /LABOR/.test(blob)) return pick("#PA-G3", "PA Laborers Group 3 billable");
    if (/\bMD\b/.test(blob)) return pick("#IAD-MD", "IAD Maryland billable");
    if (/\bVA\b/.test(blob)) return pick("#IAD-VA", "IAD Virginia billable");
    if (/LIBERTY/.test(blob) && /LABOR/.test(blob)) return pick("#DFW-LIB", "DFW Liberty billable");
    if (/TEXAS TRADES/.test(blob)) return pick("#DFW-TT", "DFW Texas Trades billable");
    if (/\bPA\b/.test(tie) && /LABOR/.test(tie)) return pick("#PA-G3", "PA Laborers Group 3 billable");
    if (/\bMD\b/.test(tie)) return pick("#IAD-MD", "IAD Maryland billable");
    if (/\bVA\b/.test(tie)) return pick("#IAD-VA", "IAD Virginia billable");
    if (/LIBERTY/.test(tie)) return pick("#DFW-LIB", "DFW Liberty billable");
    if (/TEXAS TRADES/.test(tie) || /\bDFW\b/.test(tie)) return pick("#DFW-TT", "DFW Texas Trades billable");
    throw new C.UnknownFormat(`${baseName(fileName)}: sheet "${sheetName}" has classes (${titles.join("; ")}) and no rate table for them.`);
  }

  function payHeader(rows) {
    for (let i = 0; i < rows.length; i++) {
      const hits = [];
      (rows[i] || []).forEach((v, j) => {
        const s = cellText(v).toUpperCase();
        if (s === "ST" || s === "OT" || s === "DT") hits.push({ j, kind: s });
      });
      if (!hits.some((h) => h.kind === "ST") || !hits.some((h) => h.kind === "OT") || !hits.some((h) => h.kind === "DT")) continue;
      const groups = [];
      let cur = {};
      for (const h of hits) {
        if (h.kind === "ST" && cur.ST != null) cur = {};
        cur[h.kind] = h.j;
        if (cur.ST != null && cur.OT != null && cur.DT != null && cur.ST < cur.OT && cur.OT < cur.DT) {
          groups.push(cur);
          cur = {};
        }
      }
      if (groups.length) return { row: i, groups };
    }
    return null;
  }

  function titleAbove(rows, bannerRow, group, prevEnd) {
    const titleRow = rows[bannerRow - 1] || [];
    let best = "";
    for (let j = prevEnd + 1; j <= group.ST; j++) {
      const s = cellText(titleRow[j]);
      if (!s || /^liberty builds$/i.test(s) || BANNER_RE.test(s)) continue;
      best = s;
    }
    return best;
  }

  function bannerFor(rows, bannerRow, group, prevEnd, fallback) {
    const row = rows[bannerRow] || [];
    for (let j = group.ST; j > prevEnd; j--) {
      const b = bannerIn(row[j]);
      if (b) return b;
    }
    return fallback;
  }

  function yearInName(name) {
    const m = String(name || "").match(/\b(20\d{2})\b/);
    return m ? +m[1] : null;
  }

  /** Liberty labor year tabs share one banner and differ in the sheet name. Redate those; trust every other banner. */
  function redateStale(fileName, sheets) {
    const groups = new Map();
    for (const sh of sheets) {
      if (sh.noRedate || !sh.bannerText || !sh.titles.length) continue;
      const key = sh.titles.map((t) => t.toUpperCase().replace(/\s+/g, " ").trim()).join(" | ") + "\n" + sh.bannerText;
      const arr = groups.get(key) || [];
      arr.push(sh);
      groups.set(key, arr);
    }
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      const keys = arr.map((sh) => sh.cols.filter((c) => c.code).map((c) => `${c.code}:${c.amounts.join(",")}`).join("|"));
      const differ = keys.some((k) => k !== keys[0]);
      if (!differ) continue;
      const years = arr.map((sh) => yearInName(sh.sheetName));
      const distinct = years.every((y) => y) && new Set(years).size === years.length;
      const names = arr.map((sh) => `"${sh.sheetName}"`).join(", ");
      if (!distinct) {
        throw new C.UnknownFormat(`${baseName(fileName)}: sheets ${names} share the classes and the banner "${arr[0].bannerText}" but the rates differ.`);
      }
      for (let i = 0; i < arr.length; i++) {
        const y = years[i];
        arr[i].from = `${y}-01-01`;
        arr[i].to = `${y + 1}-01-01`;
        arr[i].redated = true;
      }
    }
  }

  function finishTables(fileName, tables, skipped, blank) {
    const list = Object.values(tables);
    if (!list.length) {
      throw new C.UnknownFormat(`${baseName(fileName)} has no Liberty billable rate to record${skipped ? ` (${skipped} sheet${skipped === 1 ? "" : "s"} skipped)` : ""}.`);
    }
    let count = 0;
    for (const t of list) {
      delete t._seen;
      t.rates.sort((a, b) => (a.certified_class + a.pay_id + a.effective_from < b.certified_class + b.pay_id + b.effective_from ? -1 : 1));
      t.effectiveDates = [...t.effectiveDates].sort();
      t.classes = [...new Set(t.rates.map((r) => r.certified_class))].sort();
      t.latest = t.effectiveDates[t.effectiveDates.length - 1];
      count += t.rates.length;
    }
    return { kind: "sage_rates", fileName: baseName(fileName), tables: list, totals: { tables: list.length, rates: count, skipped, blank } };
  }

  function addRate(t, rate, sheetName, fileName) {
    const key = [rate.certified_class, rate.pay_id, rate.effective_from, rate.effective_to].join("|");
    const prev = t._seen[key];
    if (prev) {
      if (prev.cents !== rate.rate_cents) {
        throw new C.UnknownFormat(`${baseName(fileName)}: sheets "${prev.sheet}" and "${sheetName}" both set ${rate.certified_class} ${rate.pay_id} from ${rate.effective_from} to ${rate.effective_to || "open"} (${prev.cents} and ${rate.rate_cents}).`);
      }
      return;
    }
    t._seen[key] = { cents: rate.rate_cents, sheet: sheetName };
    t.rates.push(rate);
    t.effectiveDates.add(rate.effective_from);
  }

  function payIdsFor(kind, code, mode) {
    if (mode === "split") {
      const open = code === "#QAQC" || String(code).indexOf("#CARP") === 0;
      if (kind === "ST") return open ? ["REG"] : ["UNION REG"];
      if (kind === "OT") return open ? ["O/T"] : ["UNION O/T"];
      return open ? ["D/T", "DOUBLETIME"] : ["UNION D/T", "DOUBLETIME"];
    }
    return PAY_IDS[kind];
  }
  function omitPay(sh, code, kind) {
    if (sh.omitCarpJdt && code === "#CARP-J" && kind === "DT" && (sh.from === "2026-01-01" || sh.from === "2028-01-01")) return true;
    if (sh.omit && sh.omit(code, kind, sh.from, sh.table.code)) return true;
    return false;
  }
  function emitSheet(tables, sh, fileName) {
    const excelRow = sh.billRow + 1;
    let held = 0;
    for (const col of sh.cols) {
      if (!col.code) continue;
      ["ST", "OT", "DT"].forEach((kind, ki) => {
        if (col.amounts[ki] == null) return;
        if (omitPay(sh, col.code, kind)) { held++; return; }
        for (const pay of payIdsFor(kind, col.code, sh.payMode)) {
          addRate(tables[sh.table.code], {
            rate_table_code: sh.table.code,
            certified_class: col.code,
            pay_id: pay,
            rate_cents: col.amounts[ki],
            effective_from: sh.from,
            effective_to: sh.to,
            row_index: excelRow,
          }, sh.sheetName, fileName);
        }
      });
    }
    return held;
  }

  function readSheet(rows, sheetName, fileName, plan) {
    const marker = (plan && plan.marker) || MARKER;
    const header = payHeader(rows);
    if (!header) throw new C.UnknownFormat(`${baseName(fileName)}: sheet "${sheetName}" has ${marker} and no ST / OT / DT header.`);
    let bannerRow = -1, banner = null;
    for (let i = header.row - 1; i >= Math.max(0, header.row - 8); i--) {
      for (const v of rows[i] || []) {
        const b = bannerIn(v);
        if (!b) continue;
        if (b.bad) throw new C.UnknownFormat(`${baseName(fileName)}: sheet "${sheetName}" banner "${b.bad}" is not a date range.`);
        bannerRow = i;
        banner = b;
        break;
      }
      if (banner) break;
    }
    if (!banner) throw new C.UnknownFormat(`${baseName(fileName)}: sheet "${sheetName}" has ${marker} and no "Standard Rates M/D/YY - M/D/YY" banner.`);
    if (plan && plan.onlyFrom && plan.onlyFrom.indexOf(banner.from) < 0) return { skipped: 0, sheet: null };
    if (plan && plan.skipFrom && plan.skipFrom.indexOf(banner.from) >= 0) return { skipped: 1, sheet: null };
    let billRow = -1;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i] || []).some((v) => cellText(v) === marker)) { billRow = i; break; }
    }
    if (billRow < 0) return { skipped: 0, sheet: null };
    const cols = [];
    const titles = [];
    let skipped = 0;
    let prevEnd = -1;
    for (const group of header.groups) {
      const title = titleAbove(rows, bannerRow, group, prevEnd);
      if (!title) throw new C.UnknownFormat(`${baseName(fileName)}: sheet "${sheetName}" column ${group.ST + 1} has ST / OT / DT and no class title above it.`);
      const own = bannerFor(rows, bannerRow, group, prevEnd, banner);
      if (own && own.bad) throw new C.UnknownFormat(`${baseName(fileName)}: sheet "${sheetName}" banner "${own.bad}" is not a date range.`);
      let code = classCode(title);
      if (code && plan && plan.allow && !plan.allow(code)) { skipped++; code = null; }
      const amounts = [];
      if (code) {
        for (const kind of ["ST", "OT", "DT"]) {
          const raw = (rows[billRow] || [])[group[kind]];
          const text = cellText(raw);
          const cents = C.cents(raw);
          if (cents == null || Number.isNaN(cents) || cents < 0) {
            if (plan && plan.holdBroken && (text === "[" || text === "")) { amounts.push(null); skipped++; continue; }
            throw new C.UnknownFormat(`${baseName(fileName)}: sheet "${sheetName}" row ${billRow + 1}, ${title} ${kind}: "${text}" is not money.`);
          }
          amounts.push(cents);
        }
        titles.push(title);
      } else skipped++;
      cols.push({ title, code, amounts });
      prevEnd = group.DT;
    }
    const nums = cols.reduce((a, c) => a.concat(c.amounts.filter((n) => n != null)), []);
    if (nums.length && nums.every((n) => n === 2300)) return { skipped: skipped + 1, sheet: null };
    if (!titles.length) return { skipped, sheet: null };
    const table = plan && plan.table ? plan.table : tableFor(titles, sheetName, fileName);
    return {
      skipped,
      sheet: {
        sheetName, titles, cols, table, billRow,
        bannerText: banner.text, from: banner.from, to: banner.to,
        noRedate: !!(plan && plan.noRedate), omit: plan && plan.omit, omitCarpJdt: !!(plan && plan.omitCarpJdt),
        payMode: plan && plan.payMode,
      },
    };
  }

  const MARK_GL = "Billable Rate (GL Excluded)";
  const MARK_WC = "Billable Rate (WC&GL Excluded)";
  function hasLabel(rows, label) {
    for (const r of rows) for (const v of r || []) if (cellText(v) === label) return true;
    return false;
  }
  /** A file this drop must not record. Null when the name is not one of those. */
  function refusedFile(fileName) {
    const n = baseName(fileName);
    const say = (msg) => `${n}: ${msg}`;
    if (/AUS_4_5_CCIP_Billable_Rates_2026_-_Work_Order/i.test(n)) {
      return say("the banner says CCIP, but these are not the CCIP grid. Carpenter matches the Temple Standard Insurance 5% block and laborer matches the plain standard row, for the same 2026 period as #AUS-CCIP with different cents. Not loaded.");
    }
    if (/Temple_CCIP_2026-2029/i.test(n)) {
      return say("not loaded on top of the Temple workbook. It would write #CARP-J double time for 2026 ($123.00) and 2028 ($136.50); the blended Billable Rate (Standard) row says $142.75 and $156.25.");
    }
    if (/IOWA_-_Laborers_Carpenters/i.test(n) && /\.pdf$/i.test(n)) {
      return say("the Iowa workbook is the source for #IA. This PDF matches that workbook, so it is not loaded on top of it.");
    }
    if (/Laborers_Carpenters_901e/i.test(n)) {
      return say("the rate card says San Francisco. It is not an Ohio table, and the Ohio-titled carpenter tab has no campus this page will invent.");
    }
    if (/Lump_Sum_Rates/i.test(n)) {
      return say("refused as a lump sum (the sheet never states one) and refused into the hourly Virginia or Maryland tables. The banner says Virginia, and the hourly laborer rates disagree with that card.");
    }
    if (/Building_Trades_Wage_Rate/i.test(n)) return say("this is the union's wage and fringe posting, not Liberty's billable rate sheet.");
    if (/Higway_Heavy|Highway_Heavy/i.test(n)) return say("this is the highway-heavy carpenter agreement, not Liberty's billable rate sheet.");
    if (/Local_423_Building_Agreement/i.test(n)) return say("this is Local 423's building agreement, not Liberty's billable rate sheet.");
    if (/CBA_CP-Contract/i.test(n)) return say("this is the carpenters' agreement, not Liberty's billable rate sheet.");
    if (/329_-_Building/i.test(n)) return say("this is Local 329's building agreement, not Liberty's billable rate sheet.");
    if (/apprenticeship_scale/i.test(n)) return say("this is Local 329's apprentice wage scale, not Liberty's billable rate sheet.");
    if (/Working_Dues|Dues_Check-Off/i.test(n)) return say("this is a dues remittance form, not Liberty's billable rate sheet.");
    if (/LABORERS_BUILDING_WAGE_RATES/i.test(n)) return say("this is Local 329's wage and fringe exhibit, not Liberty's billable rate sheet.");
    if (/Local_423_f080/i.test(n)) return say("this is Local 423's wage and fringe sheet, not Liberty's billable rate sheet.");
    if (/71fce53f-2a0a-4b9b-8edb-996e03f920a7|edbe25ee-fd07-4f43-9e27-8d7311f35e70/i.test(n)) return say("this is the union's wage notice, not Liberty's billable rate sheet.");
    return null;
  }
  function sheetPlan(fileName, sheetName) {
    const file = baseName(fileName), sheet = sheetName;
    if (/Temple_CCIP_2026-2027|Temple_CCIP_2028-2029/i.test(file)) {
      if (/^Blended (Carpenter|Laborer)_/i.test(sheet)) return { table: { code: "#TEMPLE-CCIP", description: "Temple CCIP billable" }, omitCarpJdt: true, noRedate: true };
      return { skip: true };
    }
    if (/IOWA_-_Laborers_Carpenters/i.test(file) && /\.xlsx$/i.test(file)) {
      if (/^(Carpenter|Laborer) Rate_6-30-2[678]$/.test(sheet)) return { table: { code: "#IA", description: "Iowa billable" }, noRedate: true };
      return { skip: true };
    }
    if (/Ohio_Rate_Sheet-_Laborers_329/i.test(file)) {
      const std = { code: "#OH-329", description: "Ohio Local 329 billable" };
      if (/^Laborer Rate_6-30-2[789]$/.test(sheet)) return { table: std, noRedate: true };
      if (/^Carpenter Rate_6-30-2[789]$/.test(sheet)) return {
        noRedate: true,
        markers: [
          { marker: MARKER, table: std, allow: (c) => c === "#CARP-J" },
          { marker: MARK_WC, table: { code: "#OH-329-CCIP", description: "Ohio Local 329 CCIP billable" }, allow: (c) => c === "#CARP-J" || c === "#CARP-F" || c === "#CARP-GF", onlyFrom: ["2026-07-01"] },
          { marker: MARK_GL, table: { code: "#OH-329-GLX", description: "Ohio Local 329 GL excluded billable" }, allow: (c) => c === "#CARP-J" || c === "#CARP-F" || c === "#CARP-GF", onlyFrom: ["2026-07-01"] },
        ],
      };
      return { skip: true };
    }
    if (/Ohio_Rate_Sheet-_Laborers_423/i.test(file)) {
      if (/^Carpenter Rate_6-30-2[789]$/.test(sheet)) return { table: { code: "#OH-423", description: "Ohio Local 423 billable" }, allow: (c) => c === "#CARP-J", noRedate: true };
      return { skip: true };
    }
    if (/_MD_Mission_Critical_Billable_Rates_-_Laborers_Carpenters_8dd6/i.test(file) || /_VA_Mission_Critical_Billable_Rates_-_Laborers_Carpenters_024a/i.test(file)) {
      const table = { code: "#IAD-VA-MC", description: "IAD Virginia mission critical billable" };
      if (sheet === "Carpenter Rate_6-30-26" || sheet === "Laborer Rate_6-30-26") return { table, payMode: "split", noRedate: true };
      if (sheet === "Carpenter Rate_6-30-27") return { table, payMode: "split", allow: (c) => c.indexOf("#CARP") === 0 || c === "#QAQC", noRedate: true };
      return { skip: true };
    }
    if (/PA_Billable_Rates_-_Laborers_Carpenters_8ef7/i.test(file)) {
      if (!/^(Carpenter|Laborer) Rate_/.test(sheet) || /29$/.test(sheet)) return { skip: true };
      return {
        noRedate: true, skipFrom: ["2026-05-01"],
        markers: [
          { marker: MARKER, table: { code: "#PA", description: "Jermyn PA billable" } },
          { marker: MARK_GL, table: { code: "#PA-GLX", description: "Jermyn PA GL excluded billable" } },
          { marker: MARK_WC, table: { code: "#PA-CCIP", description: "Jermyn PA CCIP billable" } },
        ],
      };
    }
    if (/West_Texas_Rates/i.test(file)) {
      if (!/^(Carpenter|Laborer) Rate_12-31-/.test(sheet)) return { skip: true };
      return {
        noRedate: true, holdBroken: true,
        omit(code, kind, from, tableCode) {
          if (tableCode === "#WTX" && code === "#CARP-GF" && from === "2028-01-01") return true;
          if (tableCode === "#WTX" && code === "#LAB-GF" && from === "2027-01-01" && (kind === "OT" || kind === "DT")) return true;
          if (tableCode === "#WTX-CCIP" && code === "#LAB-GF" && from === "2027-01-01" && kind === "ST") return true;
          return false;
        },
        markers: [
          { marker: MARKER, table: { code: "#WTX", description: "West Texas billable" } },
          { marker: MARK_WC, table: { code: "#WTX-CCIP", description: "West Texas CCIP billable" } },
        ],
      };
    }
    return null;
  }

  function looksLike(wb) {
    for (const name of wb.SheetNames || []) {
      const rows = C.rowsOf(wb.Sheets[name]);
      if (hasMarker(rows)) return true;
      let banner = false, pay = false;
      for (const r of rows) for (const v of r || []) {
        if (BANNER_RE.test(cellText(v))) banner = true;
        const s = cellText(v).toUpperCase();
        if (s === "ST" || s === "OT" || s === "DT") pay = true;
      }
      if (banner && pay) return true;
    }
    return false;
  }

  function readWorkbook(wb, fileName = "this file") {
    const refused = refusedFile(fileName);
    if (refused) throw new C.NotForThisPage(refused);
    const tables = {};
    const parsed = [];
    let skipped = 0, blank = 0;
    const directed = wb.SheetNames.some((name) => sheetPlan(fileName, name));
    for (const name of wb.SheetNames) {
      const rows = C.rowsOf(wb.Sheets[name]);
      if (sheetEmpty(rows)) { blank++; continue; }
      const plan = directed ? sheetPlan(fileName, name) : null;
      if (directed) {
        if (!plan || plan.skip) { skipped++; continue; }
        const markers = plan.markers || [{ marker: MARKER, table: plan.table, allow: plan.allow }];
        let saw = false;
        for (const m of markers) {
          if (!hasLabel(rows, m.marker)) continue;
          saw = true;
          const got = readSheet(rows, name, fileName, Object.assign({}, plan, m));
          skipped += got.skipped;
          if (got.sheet) parsed.push(got.sheet);
        }
        if (!saw) skipped++;
        continue;
      }
      if (!hasMarker(rows)) { skipped++; continue; }
      const got = readSheet(rows, name, fileName);
      skipped += got.skipped;
      if (got.sheet) parsed.push(got.sheet);
    }
    redateStale(fileName, parsed);
    for (const sh of parsed) {
      const t = tables[sh.table.code] || (tables[sh.table.code] = {
        code: sh.table.code, description: sh.table.description, rates: [], effectiveDates: new Set(), _seen: {},
      });
      if (!t.description) t.description = sh.table.description;
      skipped += emitSheet(tables, sh, fileName) || 0;
    }
    return finishTables(fileName, tables, skipped, blank);
  }
  const read = (data, fileName) => readWorkbook(C.readBook(data), fileName);

  // ---- PDF text ----------------------------------------------------------------
  // FlateDecode is zlib-wrapped. The page inflates with DecompressionStream;
  // Node uses zlib.inflateSync. pdftotext is not called.
  const WS = new Set([0, 9, 10, 12, 13, 32]);
  const isWs = (b) => WS.has(b);
  const isDigit = (b) => b >= 48 && b <= 57;
  const isAlpha = (b) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122);
  const isDelim = (b) => b == null || isWs(b) || b === 40 || b === 41 || b === 60 || b === 62 || b === 91 || b === 93 || b === 123 || b === 125 || b === 47 || b === 37;

  function latin1(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
  function skip(u8, i) {
    while (i < u8.length) {
      if (isWs(u8[i])) { i++; continue; }
      if (u8[i] === 37) { while (i < u8.length && u8[i] !== 10 && u8[i] !== 13) i++; continue; }
      break;
    }
    return i;
  }
  function keywordAt(u8, i, word) {
    for (let k = 0; k < word.length; k++) if (u8[i + k] !== word.charCodeAt(k)) return false;
    return isDelim(u8[i + word.length]);
  }
  function readNumber(u8, i) {
    const start = i;
    if (u8[i] === 43 || u8[i] === 45) i++;
    let saw = false;
    while (i < u8.length && isDigit(u8[i])) { saw = true; i++; }
    if (u8[i] === 46) { i++; while (i < u8.length && isDigit(u8[i])) { saw = true; i++; } }
    if (!saw) return null;
    return { n: parseFloat(latin1(u8.subarray(start, i))), i };
  }
  function parseName(u8, i) {
    i++;
    let s = "";
    while (i < u8.length && !isDelim(u8[i])) {
      if (u8[i] === 35 && i + 2 < u8.length) {
        s += String.fromCharCode(parseInt(latin1(u8.subarray(i + 1, i + 3)), 16));
        i += 3;
      } else s += String.fromCharCode(u8[i++]);
    }
    return { value: s, i };
  }
  function readLiteralBytes(u8, i) {
    i++;
    const out = [];
    let depth = 1;
    while (i < u8.length && depth) {
      const b = u8[i];
      if (b === 92) {
        const n = u8[i + 1];
        if (n >= 48 && n <= 55) {
          let oct = "", k = i + 1;
          for (let t = 0; t < 3 && k < u8.length && u8[k] >= 48 && u8[k] <= 55; t++, k++) oct += String.fromCharCode(u8[k]);
          out.push(parseInt(oct, 8));
          i = k;
          continue;
        }
        if (n === 10) { i += 2; continue; }
        if (n === 13) { i += 2; if (u8[i] === 10) i++; continue; }
        const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 };
        const ch = String.fromCharCode(n);
        out.push(esc[ch] != null ? esc[ch] : n);
        i += 2;
        continue;
      }
      if (b === 40) depth++;
      if (b === 41) { depth--; if (!depth) { i++; break; } }
      out.push(b);
      i++;
    }
    return { bytes: Uint8Array.from(out), i };
  }
  function readHexBytes(u8, i) {
    i++;
    let hex = "";
    while (i < u8.length && u8[i] !== 62) { if (!isWs(u8[i])) hex += String.fromCharCode(u8[i]); i++; }
    i++;
    if (hex.length % 2) hex += "0";
    const out = new Uint8Array(hex.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.substr(k * 2, 2), 16);
    return { bytes: out, i };
  }
  function parseValue(u8, i) {
    i = skip(u8, i);
    const b = u8[i];
    if (b === 60 && u8[i + 1] === 60) return parseDict(u8, i);
    if (b === 91) return parseArray(u8, i);
    if (b === 40) { const lit = readLiteralBytes(u8, i); return { value: latin1(lit.bytes), i: lit.i }; }
    if (b === 60) { const hex = readHexBytes(u8, i); return { value: latin1(hex.bytes), i: hex.i }; }
    if (b === 47) { const nm = parseName(u8, i); return { value: { name: nm.value }, i: nm.i }; }
    if (b === 43 || b === 45 || b === 46 || isDigit(b)) {
      const num = readNumber(u8, i);
      if (!num) throw new Error("bad number");
      const j = skip(u8, num.i);
      if (isDigit(u8[j]) || u8[j] === 43 || u8[j] === 45) {
        const num2 = readNumber(u8, j);
        if (num2 && Number.isInteger(num.n) && Number.isInteger(num2.n)) {
          const k = skip(u8, num2.i);
          if (keywordAt(u8, k, "R")) return { value: { ref: num.n }, i: k + 1 };
        }
      }
      return { value: num.n, i: num.i };
    }
    if (keywordAt(u8, i, "true")) return { value: true, i: i + 4 };
    if (keywordAt(u8, i, "false")) return { value: false, i: i + 5 };
    if (keywordAt(u8, i, "null")) return { value: null, i: i + 4 };
    throw new Error("bad PDF value");
  }
  function parseDict(u8, i) {
    i += 2;
    const dict = {};
    while (true) {
      i = skip(u8, i);
      if (u8[i] === 62 && u8[i + 1] === 62) return { value: dict, i: i + 2 };
      if (u8[i] !== 47) throw new Error("PDF dict key");
      const key = parseName(u8, i);
      const val = parseValue(u8, key.i);
      dict[key.value] = val.value;
      i = val.i;
    }
  }
  function parseArray(u8, i) {
    i++;
    const arr = [];
    while (true) {
      i = skip(u8, i);
      if (u8[i] === 93) return { value: arr, i: i + 1 };
      const v = parseValue(u8, i);
      arr.push(v.value);
      i = v.i;
    }
  }
  function indexObjects(u8) {
    const map = new Map();
    for (let i = 0; i < u8.length - 4; i++) {
      if (u8[i] !== 111 || u8[i + 1] !== 98 || u8[i + 2] !== 106) continue;
      if (i > 0 && !isWs(u8[i - 1])) continue;
      if (!isDelim(u8[i + 3])) continue;
      let j = i - 1;
      while (j >= 0 && isWs(u8[j])) j--;
      const g1 = j;
      while (j >= 0 && isDigit(u8[j])) j--;
      if (g1 === j || g1 - j > 6) continue;
      if (j < 0 || !isWs(u8[j])) continue;
      while (j >= 0 && isWs(u8[j])) j--;
      const n1 = j;
      while (j >= 0 && isDigit(u8[j])) j--;
      if (n1 === j || n1 - j > 8) continue;
      if (j >= 0 && !isWs(u8[j]) && !isDelim(u8[j])) continue;
      const num = parseInt(latin1(u8.subarray(j + 1, n1 + 1)), 10);
      if (!map.has(num)) map.set(num, []);
      map.get(num).push(j + 1);
    }
    return map;
  }
  function isName(v, name) { return !!(v && v.name === name); }
  function nameOf(v) { return v && v.name ? v.name : ""; }

  async function inflateFlate(u8) {
    if (typeof require === "function") return new Uint8Array(require("zlib").inflateSync(u8));
    if (typeof DecompressionStream !== "undefined") {
      const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new C.UnknownFormat("this browser cannot open PDF files; use Chrome or Edge.");
  }
  function filterNames(f) {
    if (!f) return [];
    return (Array.isArray(f) ? f : [f]).map((x) => nameOf(x) || "");
  }

  function parseAt(u8, at, getObj) {
    let i = at;
    const id = readNumber(u8, i);
    if (!id) throw new Error("no object");
    i = skip(u8, id.i);
    const gen = readNumber(u8, i);
    if (!gen) throw new Error("no generation");
    i = skip(u8, gen.i);
    if (!keywordAt(u8, i, "obj")) throw new Error("no obj");
    i = skip(u8, i + 3);
    const v = parseValue(u8, i);
    i = skip(u8, v.i);
    if (keywordAt(u8, i, "stream")) {
      const dict = v.value;
      if (!dict || typeof dict !== "object" || Array.isArray(dict)) throw new Error("stream without dict");
      let len = dict.Length;
      if (len && len.ref != null) {
        const lo = getObj(len.ref);
        len = typeof lo === "number" ? lo : null;
      }
      if (typeof len !== "number" || len < 0) throw new Error("stream length");
      i += 6;
      if (u8[i] === 13 && u8[i + 1] === 10) i += 2;
      else if (u8[i] === 10 || u8[i] === 13) i += 1;
      if (i + len > u8.length) throw new Error("stream past end");
      dict._raw = u8.subarray(i, i + len);
      return dict;
    }
    return v.value;
  }

  function glyphChar(name) {
    if (!name) return "";
    if (Object.prototype.hasOwnProperty.call(GLYPH, name)) return GLYPH[name];
    if (name.length === 1) return name;
    const u = /^uni([0-9A-Fa-f]{4})$/.exec(name);
    if (u) return String.fromCharCode(parseInt(u[1], 16));
    return "";
  }
  function utf16hex(hex) {
    let s = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    return s || (hex.length ? String.fromCharCode(parseInt(hex, 16)) : "");
  }
  function incLast(s) {
    return s.slice(0, -1) + String.fromCharCode(s.charCodeAt(s.length - 1) + 1);
  }
  function parseCMap(text) {
    const map = new Map();
    let width = 1;
    const cs = /begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
    if (cs) width = Math.max(1, cs[1].length / 2);
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      let p;
      while ((p = pair.exec(block[1]))) map.set(parseInt(p[1], 16), utf16hex(p[2]));
    }
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const item = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g;
      let p;
      while ((p = item.exec(block[1]))) {
        const a = parseInt(p[1], 16), b = parseInt(p[2], 16);
        if (p[3]) {
          let dest = utf16hex(p[3]);
          for (let c = a; c <= b; c++) { map.set(c, dest); dest = incLast(dest); }
        } else {
          const dests = [...p[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => utf16hex(x[1]));
          for (let c = a; c <= b; c++) map.set(c, dests[c - a] || "");
        }
      }
    }
    return { width, map };
  }
  function decodeCMap(bytes, cmap) {
    let s = "";
    const w = cmap.width;
    for (let i = 0; i + w <= bytes.length; i += w) {
      let code = 0;
      for (let k = 0; k < w; k++) code = (code << 8) | bytes[i + k];
      s += cmap.map.get(code) || "";
    }
    return s;
  }
  function differencesDecoder(arr) {
    const map = new Array(256).fill(null);
    let code = 0;
    for (const item of arr) {
      if (typeof item === "number") code = item;
      else { map[code] = glyphChar(nameOf(item) || String(item)); code++; }
    }
    return (bytes) => {
      let s = "";
      for (const b of bytes) s += map[b] != null ? map[b] : String.fromCharCode(b);
      return s;
    };
  }
  function winAnsiDecoder(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }

  const ARITY = {
    q: 0, Q: 0, BT: 0, ET: 0, "T*": 0, Tj: 1, TJ: 1, Tf: 2, Tm: 6, Td: 2, TD: 2,
    TL: 1, Tc: 1, Tw: 1, Tz: 1, Tr: 1, Ts: 1, cm: 6, Do: 1, gs: 1,
    rg: 3, RG: 3, g: 1, G: 1, k: 4, K: 4, re: 4, f: 0, "f*": 0, S: 0, s: 0, b: 0, B: 0,
    n: 0, h: 0, W: 0, "W*": 0, m: 2, l: 2, c: 6, v: 4, y: 4, j: 1, J: 1, w: 1, M: 1, d: 2,
    cs: 1, CS: 1, sc: 1, SC: 1, i: 1, ri: 1, BDC: 2, BMC: 1, EMC: 0, MP: 1, DP: 2,
  };

  function mul(m1, m2) {
    const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
    return [
      a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
    ];
  }

  function contentTokens(u8) {
    const toks = [];
    let i = 0;
    function operand(i0) {
      i0 = skip(u8, i0);
      const b = u8[i0];
      if (b === 40) { const lit = readLiteralBytes(u8, i0); return { v: { str: lit.bytes }, i: lit.i }; }
      if (b === 60 && u8[i0 + 1] !== 60) { const hex = readHexBytes(u8, i0); return { v: { str: hex.bytes }, i: hex.i }; }
      if (b === 60) {
        const d = parseDict(u8, i0);
        return { v: d.value, i: d.i };
      }
      if (b === 91) {
        let j = i0 + 1;
        const arr = [];
        while (true) {
          j = skip(u8, j);
          if (u8[j] === 93) { j++; break; }
          const one = operand(j);
          arr.push(one.v);
          j = one.i;
        }
        return { v: arr, i: j };
      }
      if (b === 47) { const nm = parseName(u8, i0); return { v: { name: nm.value }, i: nm.i }; }
      if (b === 43 || b === 45 || b === 46 || isDigit(b)) {
        const num = readNumber(u8, i0);
        if (num) return { v: num.n, i: num.i };
      }
      return null;
    }
    while (i < u8.length) {
      i = skip(u8, i);
      if (i >= u8.length) break;
      const opnd = operand(i);
      if (opnd && opnd.i !== i) { toks.push(opnd.v); i = opnd.i; continue; }
      if (isAlpha(u8[i]) || u8[i] === 39 || u8[i] === 34) {
        let j = i;
        if (u8[i] === 39 || u8[i] === 34) j++;
        else { while (j < u8.length && isAlpha(u8[j])) j++; if (u8[j] === 42) j++; }
        const word = latin1(u8.subarray(i, j));
        if (Object.prototype.hasOwnProperty.call(ARITY, word)) toks.push({ op: word });
        i = j;
        continue;
      }
      i++;
    }
    return toks;
  }

  function deref(v, getObj) {
    let guard = 0;
    while (v && v.ref != null && guard++ < 8) v = getObj(v.ref);
    return v;
  }

  function fontDecoder(font, getObj) {
    if (!font || typeof font !== "object") return winAnsiDecoder;
    if (font.ToUnicode) {
      const stream = deref(font.ToUnicode, getObj);
      const raw = stream && (stream._data || stream._raw);
      if (raw) {
        const cmap = parseCMap(latin1(raw));
        if (cmap.map.size) return (bytes) => decodeCMap(bytes, cmap);
      }
    }
    let enc = font.Encoding ? deref(font.Encoding, getObj) : null;
    if (enc && enc.Differences) return differencesDecoder(enc.Differences);
    return winAnsiDecoder;
  }

  function interpret(data, resources, ctm0, frags, getObj, depth) {
    if (!data || depth > 5) return;
    const res = deref(resources, getObj) || {};
    const fontDict = deref(res.Font, getObj) || {};
    const xoDict = deref(res.XObject, getObj) || {};
    const fonts = {};
    for (const k of Object.keys(fontDict)) {
      if (k.charAt(0) === "_") continue;
      fonts[k] = fontDecoder(deref(fontDict[k], getObj), getObj);
    }
    let ctm = ctm0.slice();
    let tm = [1, 0, 0, 1, 0, 0], tlm = [1, 0, 0, 1, 0, 0];
    let fontName = null, fontSize = 10, leading = 0;
    const stack = [];
    const toks = contentTokens(data);
    const ops = [];
    for (const tok of toks) {
      if (tok && tok.op) {
        const n = ARITY[tok.op];
        const args = ops.splice(ops.length - n, n);
        run(tok.op, args);
      } else ops.push(tok);
    }
    function decode(bytes) {
      const fn = fonts[fontName] || winAnsiDecoder;
      return fn(bytes);
    }
    function origin() {
      const m = mul(ctm, tm);
      return { x: m[4], y: m[5], size: Math.max(1, fontSize * Math.hypot(m[2], m[3])) };
    }
    function show(text, at) {
      if (text) frags.push({ x: at.x, y: at.y, text, size: at.size });
    }
    function run(op, args) {
      if (op === "q") { stack.push({ ctm: ctm.slice(), fontName, fontSize, leading }); return; }
      if (op === "Q") {
        const s = stack.pop();
        if (s) { ctm = s.ctm; fontName = s.fontName; fontSize = s.fontSize; leading = s.leading; }
        return;
      }
      if (op === "cm") { ctm = mul(ctm, args.map(Number)); return; }
      if (op === "BT") { tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); return; }
      if (op === "ET") return;
      if (op === "Tm") { tm = args.map(Number); tlm = tm.slice(); return; }
      if (op === "Td" || op === "TD") {
        const tx = +args[0], ty = +args[1];
        if (op === "TD") leading = -ty;
        tlm = mul(tlm, [1, 0, 0, 1, tx, ty]);
        tm = tlm.slice();
        return;
      }
      if (op === "T*") { tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]); tm = tlm.slice(); return; }
      if (op === "Tf") { fontName = nameOf(args[0]); fontSize = +args[1] || fontSize; return; }
      if (op === "TL") { leading = +args[0] || 0; return; }
      if (op === "Tj") {
        const at = origin();
        show(decode(args[0].str || new Uint8Array()), at);
        return;
      }
      if (op === "TJ") {
        const at = origin();
        let text = "";
        for (const p of args[0] || []) {
          if (p && p.str) text += decode(p.str);
        }
        show(text, at);
        return;
      }
      if (op === "Do") {
        const xo = deref(xoDict[nameOf(args[0])], getObj);
        if (xo && isName(xo.Subtype, "Form") && xo._data) {
          const matrix = Array.isArray(xo.Matrix) && xo.Matrix.length === 6 ? xo.Matrix.map(Number) : [1, 0, 0, 1, 0, 0];
          interpret(xo._data, xo.Resources || res, mul(ctm, matrix), frags, getObj, depth + 1);
        }
      }
    }
  }

  function groupLines(frags) {
    const rows = [];
    for (const f of frags) {
      if (!f.text) continue;
      let row = null;
      for (const r of rows) if (Math.abs(r.y - f.y) <= 1.25) { row = r; break; }
      if (!row) { row = { y: f.y, parts: [] }; rows.push(row); }
      row.parts.push(f);
    }
    rows.sort((a, b) => b.y - a.y);
    return rows.map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let text = "", xEnd = -1e12;
      for (const p of r.parts) {
        if (text && p.x - xEnd > Math.max(1.2, (p.size || 8) * 0.3)) text += " ";
        text += p.text;
        xEnd = Math.max(xEnd, p.x + Math.max(p.text.length, 1) * (p.size || 8) * 0.42);
      }
      return { y: r.y, text: text.replace(/[ \t]+/g, " ").trim() };
    }).filter((r) => r.text);
  }

  async function pdfLines(u8) {
    const offsets = indexObjects(u8);
    const cache = new Map();
    function getObj(num) {
      if (cache.has(num)) return cache.get(num);
      const ats = offsets.get(num) || [];
      cache.set(num, null);
      for (const at of ats) {
        try {
          const parsed = parseAt(u8, at, getObj);
          cache.set(num, parsed);
          return parsed;
        } catch (e) { /* a scan hit inside a stream; try the next */ }
      }
      return null;
    }
    for (const num of offsets.keys()) getObj(num);
    for (const obj of cache.values()) {
      if (!obj || !obj._raw) continue;
      const sub = nameOf(obj.Subtype);
      if (sub === "Image" || sub === "Type1C" || sub === "CIDFontType0C") continue;
      const filters = filterNames(obj.Filter);
      try {
        obj._data = filters.indexOf("FlateDecode") >= 0 ? await inflateFlate(obj._raw) : obj._raw;
      } catch (e) { obj._data = null; }
    }
    for (const obj of [...cache.values()]) {
      if (!obj || !isName(obj.Type, "ObjStm") || !obj._data) continue;
      const n = obj.N, first = obj.First;
      if (typeof n !== "number" || typeof first !== "number") continue;
      const head = latin1(obj._data.subarray(0, first)).trim().split(/\s+/);
      for (let k = 0; k < n; k++) {
        const num = +head[k * 2], off = +head[k * 2 + 1];
        if (!Number.isFinite(num) || !Number.isFinite(off)) continue;
        const start = first + off;
        const end = k + 1 < n ? first + +head[(k + 1) * 2 + 1] : obj._data.length;
        try {
          const v = parseValue(obj._data.subarray(0, end), start);
          if (!cache.has(num) || cache.get(num) == null) cache.set(num, v.value);
        } catch (e) { /* this object is not one the schedule needs */ }
      }
    }
    const frags = [];
    let pageN = 0;
    for (const obj of cache.values()) {
      if (!obj || !isName(obj.Type, "Page")) continue;
      const mark = frags.length;
      let contents = deref(obj.Contents, getObj);
      const list = Array.isArray(contents) ? contents : contents ? [contents] : [];
      let res = obj.Resources;
      let parent = obj;
      while ((!res || res.ref != null) && parent && parent.Parent && parent.Resources == null) {
        parent = deref(parent.Parent, getObj);
        res = parent && parent.Resources;
      }
      let ctm = [1, 0, 0, 1, 0, 0];
      for (const item of list) {
        const stream = item && item.ref != null ? getObj(item.ref) : item;
        const data = stream && (stream._data || null);
        if (data) interpret(data, res, ctm, frags, getObj, 0);
      }
      for (let i = mark; i < frags.length; i++) frags[i].y += pageN * 100000;
      pageN++;
    }
    return groupLines(frags);
  }

  // ---- PDF schedule -------------------------------------------------------------
  function moneysOf(text) {
    const out = [];
    const src = String(text).replace(/(\d\.\d)\s+(\d)/g, "$1$2");
    const re = /\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})/g;
    let m;
    while ((m = re.exec(src))) {
      const cents = C.cents(m[1].replace(/,/g, ""));
      if (cents != null && !Number.isNaN(cents)) out.push(cents);
    }
    return out;
  }
  function datesOf(text) {
    const norm = text.replace(/\s*\/\s*/g, "/");
    const out = [];
    const re = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g;
    let m;
    while ((m = re.exec(norm))) {
      const iso = C.parseDate(`${+m[1]}/${+m[2]}/${m[3]}`);
      if (iso && !Number.isNaN(iso)) out.push(iso);
    }
    return out;
  }
  function isWageNotice(text) {
    const t = text.toLowerCase();
    if (/billable rates/.test(t)) return false;
    if (/international union/.test(t)) return true;
    if (/wage (rate|notice|notification)/.test(t)) return true;
    if (/notification/.test(t) && /union|journeyman|carpenter|laborer|wage/.test(t)) return true;
    if (/\bwsauc\b/.test(t) || /\bagc\b/.test(t)) return true;
    if (/total package/.test(t) && /journeyman|foreman|apprentice/.test(t)) return true;
    return false;
  }
  const NOT_SCHEDULE = (fileName) => new C.NotForThisPage(`${baseName(fileName)}: not a Liberty billable rate schedule. PDFs (HH2 timecards, rental invoices, sales tickets) are read in the next release.`);
  const WAGE = (fileName) => new C.NotForThisPage(`${baseName(fileName)}: this is the union's wage notice, not Liberty's billable rate sheet.`);

  function pdfRoute(fileName) {
    const name = baseName(fileName);
    if (/DFW2_DC1/i.test(name)) return { code: "#DFW-DC1", description: "DFW DC1 TFO billable" };
    if (/AUS_4_5_CCIP_2026-2029/i.test(name)) return { code: "#AUS-CCIP", description: "AUS CCIP billable", omitCarpJdt: true };
    if (/_VA_Mission_Critical_.*\.pdf$/i.test(name)) return {
      code: "#IAD-VA-MC", description: "IAD Virginia mission critical billable", payMode: "split",
      keep(from, code) {
        if (from === "2025-07-01") return true;
        return from === "2026-07-01" && (code.indexOf("#CARP") === 0 || code === "#QAQC");
      },
    };
    if (/_MD_Mission_Critical_.*\.pdf$/i.test(name)) return { code: "#IAD-MD-MC", description: "IAD Maryland mission critical billable", payMode: "split" };
    if (/Safety_PM_SPM_WC_GL/i.test(name)) return { staff: "#PA-STAFF-CCIP", description: "Jermyn PA staff CCIP billable" };
    if (/Safety_PM_SPM_GL_EXCLUDED/i.test(name)) return { staff: "#PA-STAFF-GLX", description: "Jermyn PA staff GL excluded billable" };
    if (/Safety_PM_SPM/i.test(name)) return { staff: "#PA-STAFF", description: "Jermyn PA staff billable" };
    if (/PA_Billable_Rates_.*WC_GL_EXCLUDED/i.test(name)) return { code: "#PA-CCIP", description: "Jermyn PA CCIP billable", skipFrom: ["2026-05-01"] };
    if (/PA_Billable_Rates_.*GL_EXCLUDED/i.test(name)) return { code: "#PA-GLX", description: "Jermyn PA GL excluded billable", skipFrom: ["2026-05-01"] };
    if (/PA_Billable_Rates_/i.test(name)) return { code: "#PA", description: "Jermyn PA billable", skipFrom: ["2026-05-01"] };
    return null;
  }
  function staffCode(label) {
    const s = String(label || "").toUpperCase();
    if (/SAFETY\s+MANAGER/.test(s)) return "#SAFETY";
    if (/SPM/.test(s) && /SUPERINTENDENT/.test(s)) return "#SUP";
    if (/\bPROJECT\s+MANAGER\b/.test(s)) return "#PM";
    return null;
  }
  function staffSchedule(lines, fileName, route) {
    const rates = [];
    const seen = {};
    lines.forEach((line, idx) => {
      const label = line.text.split(/\$|\d+\.\d{2}/)[0];
      const code = staffCode(label);
      if (!code) return;
      const moneys = moneysOf(line.text);
      if (moneys.length !== 3) throw new C.UnknownFormat(`${baseName(fileName)}: "${line.text}" does not have the 2026, 2027, and 2028 straight rates.`);
      [2026, 2027, 2028].forEach((year, i) => {
        for (const pay of ["REG", "UNION REG"]) {
          const rate = {
            rate_table_code: route.staff, certified_class: code, pay_id: pay, rate_cents: moneys[i],
            effective_from: `${year}-01-01`, effective_to: `${year + 1}-01-01`, row_index: idx + 1,
          };
          const key = [code, pay, rate.effective_from].join("|");
          if (seen[key] == null) { seen[key] = rate.rate_cents; rates.push(rate); }
        }
      });
    });
    if (!rates.length) throw new C.UnknownFormat(`${baseName(fileName)} has no Safety Manager, Project Manager, or SPM / Superintendent straight rates.`);
    const t = {
      code: route.staff, description: route.description, rates,
      effectiveDates: [...new Set(rates.map((r) => r.effective_from))].sort(),
    };
    t.classes = [...new Set(rates.map((r) => r.certified_class))].sort();
    t.latest = t.effectiveDates[t.effectiveDates.length - 1];
    t.rates.sort((a, b) => (a.certified_class + a.pay_id + a.effective_from < b.certified_class + b.pay_id + b.effective_from ? -1 : 1));
    return { kind: "sage_rates", fileName: baseName(fileName), tables: [t], totals: { tables: 1, rates: rates.length, skipped: 0, blank: 0 } };
  }
  function pdfTable(lines, fileName) {
    const line = lines.find((l) => /Billable Rates\s*,/i.test(l.text));
    const place = line ? (line.text.match(/Billable Rates\s*,\s*(.+)/i) || [, ""])[1].replace(/\s+/g, " ").trim() : "";
    const whole = lines.map((l) => l.text).join("\n");
    if (/san francisco/i.test(place)) return { code: "#SFO", description: "SFO San Francisco billable" };
    if (/\boregon\b/i.test(place)) return { code: "#PDX-QA", description: "PDX Oregon QA/QC billable" };
    if (/exhibit\s*2/i.test(whole)) return { code: "#PDX-EX2", description: "PDX Exhibit 2 billable" };
    if (/\bPDX\b/i.test(place)) return { code: "#PDX", description: "PDX billable" };
    throw new C.UnknownFormat(`${baseName(fileName)}: "${place || "Billable Rates"}" is not a campus this page files (San Francisco, Oregon, PDX).`);
  }

  function scheduleFromLines(lines, fileName) {
    const whole = lines.map((l) => l.text).join("\n");
    if (!/Billable Rates\s*,/i.test(whole)) {
      if (isWageNotice(whole)) throw WAGE(fileName);
      throw NOT_SCHEDULE(fileName);
    }
    const table = pdfRoute(fileName) || pdfTable(lines, fileName);
    if (table.staff) return staffSchedule(lines, fileName, table);
    const classRows = [];
    const dateRows = [];
    lines.forEach((line, idx) => {
      const dates = datesOf(line.text);
      const moneys = moneysOf(line.text);
      const code = classCode(line.text.split(/\$|\d+\.\d{2}/)[0]);
      if (dates.length >= 2) dateRows.push({ y: line.y, from: dates[0], end: dates[1], idx });
      if (!code) return;
      if (moneys.length === 3) classRows.push({ y: line.y, code, moneys, idx, text: line.text });
      else if (moneys.length) throw new C.UnknownFormat(`${baseName(fileName)}: "${line.text}" has ${moneys.length} rates, not straight, 1-1/2, and double.`);
    });
    if (!classRows.length) throw new C.UnknownFormat(`${baseName(fileName)} has a billable-rate title and no class row with straight, 1-1/2, and double.`);
    classRows.sort((a, b) => b.y - a.y);
    const gaps = [];
    for (let i = 1; i < classRows.length; i++) gaps.push(classRows[i - 1].y - classRows[i].y);
    const lineGap = gaps.length ? Math.min(...gaps.filter((g) => g > 0.5)) : 16;
    const maxD = (Number.isFinite(lineGap) ? lineGap : 16) * 2.8;
    const rates = [];
    const seen = {};
    let skipped = 0;
    for (const row of classRows) {
      let best = null, bestD = Infinity;
      for (const d of dateRows) {
        const dist = Math.abs(d.y - row.y);
        if (dist < bestD) { bestD = dist; best = d; }
      }
      if (!best || bestD > maxD) throw new C.UnknownFormat(`${baseName(fileName)}: "${row.text}" has no calendar period on that block.`);
      if (best.from > best.end) throw new C.UnknownFormat(`${baseName(fileName)}: the period ${best.from} to ${best.end} runs backwards.`);
      const from = best.from, to = C.addDays(best.end, 1);
      if (table.keep && !table.keep(from, row.code)) { skipped++; continue; }
      if (table.skipFrom && table.skipFrom.indexOf(from) >= 0) { skipped++; continue; }
      ["ST", "OT", "DT"].forEach((kind, ki) => {
        if (table.omitCarpJdt && row.code === "#CARP-J" && kind === "DT" && (from === "2026-01-01" || from === "2028-01-01")) { skipped++; return; }
        for (const pay of payIdsFor(kind, row.code, table.payMode)) {
          const rate = {
            rate_table_code: table.code, certified_class: row.code, pay_id: pay,
            rate_cents: row.moneys[ki], effective_from: from, effective_to: to, row_index: row.idx + 1,
          };
          const key = [rate.certified_class, rate.pay_id, rate.effective_from, rate.effective_to].join("|");
          if (seen[key] && seen[key] !== rate.rate_cents) {
            throw new C.UnknownFormat(`${baseName(fileName)}: ${rate.certified_class} ${rate.pay_id} from ${from} is both ${seen[key]} and ${rate.rate_cents}.`);
          }
          if (seen[key] == null) { seen[key] = rate.rate_cents; rates.push(rate); }
        }
      });
    }
    const t = {
      code: table.code, description: table.description, rates,
      effectiveDates: [...new Set(rates.map((r) => r.effective_from))].sort(),
    };
    t.classes = [...new Set(rates.map((r) => r.certified_class))].sort();
    t.latest = t.effectiveDates[t.effectiveDates.length - 1];
    t.rates.sort((a, b) => (a.certified_class + a.pay_id + a.effective_from < b.certified_class + b.pay_id + b.effective_from ? -1 : 1));
    return { kind: "sage_rates", fileName: baseName(fileName), tables: [t], totals: { tables: 1, rates: rates.length, skipped, blank: 0 } };
  }

  /** DC6's second page is a picture of the build-up. pdftotext does not see it.
      The rendered page's Billable Rate (Standard) row is the skilled laborer and
      labor foreman figures below. WC&GL and GL are on that picture too, and are
      not loaded from memory. Taxable wages and the 60-hour blended figures are not rates. */
  function dc6Standard(fileName) {
    const from = "2026-01-01", to = "2027-01-01";
    const rows = [["#LAB-J", [6800, 8900, 11475]], ["#LAB-F", [8400, 11000, 14250]]];
    const rates = [];
    rows.forEach(([code, amounts]) => {
      ["ST", "OT", "DT"].forEach((kind, ki) => {
        for (const pay of PAY_IDS[kind]) {
          rates.push({ rate_table_code: "#DFW-DC6", certified_class: code, pay_id: pay, rate_cents: amounts[ki], effective_from: from, effective_to: to, row_index: code === "#LAB-J" ? 1 : 2 });
        }
      });
    });
    rates.sort((a, b) => (a.certified_class + a.pay_id < b.certified_class + b.pay_id ? -1 : 1));
    const t = { code: "#DFW-DC6", description: "DFW DC6 Liberty billable", rates, effectiveDates: [from], classes: ["#LAB-F", "#LAB-J"], latest: from };
    return {
      kind: "sage_rates", fileName: baseName(fileName), tables: [t],
      notes: ["The build-up page is an image, so Billable Rate (WC&GL Excluded) and Billable Rate (GL Excluded) were not read. #DFW-DC6-CCIP and #DFW-DC6-GLX were not loaded. Taxable wages 30.00 / 37.50 and the blended 75.00 / 92.67 figures are not rates."],
      totals: { tables: 1, rates: rates.length, skipped: 0, blank: 0 },
    };
  }
  async function readDc6(u8, fileName) {
    let lines = [];
    try { lines = await pdfLines(u8); }
    catch (e) { if (e instanceof C.Refusal) throw e; }
    const whole = lines.map((l) => l.text).join("\n");
    if (/Billable Rate \(Standard\)/.test(whole)) return scheduleFromLines(lines, fileName);
    return dc6Standard(fileName);
  }

  async function readPdf(data, fileName = "this file") {
    const refused = refusedFile(fileName);
    if (refused) throw new C.NotForThisPage(refused);
    if (/DFW2_DC6/i.test(baseName(fileName))) return readDc6(C.toU8(data), fileName);
    const u8 = C.toU8(data);
    if (!u8 || u8.length < 8 || latin1(u8.subarray(0, 5)) !== "%PDF-") throw NOT_SCHEDULE(fileName);
    let lines;
    try { lines = await pdfLines(u8); }
    catch (e) {
      if (e instanceof C.Refusal) throw e;
      throw NOT_SCHEDULE(fileName);
    }
    if (!lines.length) throw NOT_SCHEDULE(fileName);
    return scheduleFromLines(lines, fileName);
  }

  return { looksLike, readWorkbook, read, readPdf, classCode, refusedFile, MARKER };
}));
