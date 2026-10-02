/* projects.js - the job register, Projects.xlsx: Job #, Project Name, Campus,
   Region. One row per job; dropping it adds the jobs the page does not have
   and fills in a blank campus or region on the ones it does. Nothing is
   renamed and nothing is removed: Settings does that, one job at a time.

   REGISTER is every row of the Projects workbook (job, name, campus, region).
   It carries no rates. A campus that matches a portfolio-map id, in any case,
   is stored as that id. A job already on file is kept, including one the
   sheet does not list. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.Projects = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const REQUIRED = ["Job #", "Project Name"];
  function headerIndex(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = (rows[i] || []).map((v) => C.norm(v));
      if (REQUIRED.every((h) => cells.includes(C.norm(h))) && cells.includes("campus")) return i;
    }
    return -1;
  }
  const looksLike = (wb) => headerIndex(C.rowsOf(wb.Sheets[wb.SheetNames[0]], 10)) >= 0;
  function readWorkbook(wb, fileName = "this file") {
    const rows = C.rowsOf(wb.Sheets[wb.SheetNames[0]]);
    const hi = headerIndex(rows);
    if (hi < 0) throw new C.UnknownFormat(`${fileName} is not a Projects register (no row with Job #, Project Name and Campus).`);
    const col = {};
    (rows[hi] || []).forEach((v, j) => { const k = C.norm(v); if (k && !(k in col)) col[k] = j; });
    const at = (r, name) => { const j = col[C.norm(name)]; return j == null ? null : r[j]; };
    const jobs = [], seen = new Map();
    let dup = 0, blank = 0;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (C.isBlankRow(r)) { blank++; continue; }
      const job_number = C.str(at(r, "Job #"));
      if (!/^\d{2}-\d{2}-\d{6}$/.test(job_number)) throw new C.UnknownFormat(`${fileName}: row ${i + 1}: Job # "${job_number}" is not NN-NN-NNNNNN.`);
      const name = C.oneLine(at(r, "Project Name"));
      if (seen.has(job_number)) { dup++; continue; }   // the register repeats a few rows; the first wins
      seen.set(job_number, i + 1);
      jobs.push({ row_index: i + 1, job_number, short_name: name || job_number, name: name || null, campus: alignCampus(C.oneLine(at(r, "Campus"))), region: C.oneLine(at(r, "Region")) || null });
    }
    if (!jobs.length) throw new C.UnknownFormat(`${fileName} has the header of a Projects register and no jobs.`);
    const campuses = {};
    for (const j of jobs) campuses[j.campus || "(none)"] = (campuses[j.campus || "(none)"] || 0) + 1;
    return { kind: "projects", fileName, jobs, totals: { jobs: jobs.length, repeated: dup, blank, campuses } };
  }
  const read = (data, fileName) => readWorkbook(C.readBook(data), fileName);
  // the sales tax on rentals at each campus, as the weekly cost workbook carried it; a job's tax_bp starts here and is edited in Settings
  const CAMPUS_TAX_BP = { "CDR E1": 700, "CDR": 700, "PHL": 600, "BWI": 600, "SBN": 0, "DFW2": 825, "DFW": 825, "AUS": 825 };
  function taxFor(campus) {
    const c = String(campus || "").trim().toUpperCase();
    if (!c) return null;
    if (c in CAMPUS_TAX_BP) return CAMPUS_TAX_BP[c];
    const head = c.split(/[\s-]/)[0];
    return head in CAMPUS_TAX_BP ? CAMPUS_TAX_BP[head] : null;
  }
  function mapApi() {
    const g = typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : null);
    if (g && g.PortfolioMap && g.PortfolioMap.canonicalCampus) return g.PortfolioMap;
    if (typeof require === "function") {
      try { return require("./portfolio_map.js"); } catch (e) { return null; }
    }
    return null;
  }
  /** A campus that names a portfolio-map id (CDR E1, DFW2, aus) is stored as that id. */
  function alignCampus(name) {
    const raw = C.oneLine(name);
    if (!raw) return null;
    const PM = mapApi();
    if (PM && PM.canonicalCampus) return PM.canonicalCampus(raw) || raw;
    return raw;
  }
const REGISTER_ROWS = [
    ["50-60-224050", "110", "BWI", "Baltimore, MD"],
    ["50-60-224158", "100", "PHL", "Philadelphia, PA"],
    ["50-60-224162", "104", "PHL", "Philadelphia, PA"],
    ["50-60-224197", "201", "SBN", "South Bend, IN"],
    ["50-60-224198", "202", "SBN", "South Bend, IN"],
    ["50-60-225008", "204", "SBN", "South Bend, IN"],
    ["50-60-225009", "203", "SBN", "South Bend, IN"],
    ["50-60-225020", "105", "PHL", "Philadelphia, PA"],
    ["50-60-225032", "101/102", "PHL", "Philadelphia, PA"],
    ["50-60-225040", "DC1", "DFW2", "Dallas-Fort Worth, TX"],
    ["50-60-225104", "Site", "CDR E1", "Cedar Rapids, IA"],
    ["50-60-225120", "DC5", "CDR E1", "Cedar Rapids, IA"],
    ["50-60-225121", "DC4", "CDR E1", "Cedar Rapids, IA"],
    ["50-60-226021", "DC7", "CDR E1", "Cedar Rapids, IA"],
    ["60-26-100595", "DC7 TFO", "CDR E1", "Cedar Rapids, IA"],
    ["60-26-100191", "AUS 4&5 Stampede (a)", "AUS", "Temple, TX"],
    ["60-26-100381", "AUS 4&5 Stampede (b)", "AUS", "Temple, TX"],
    ["50-60-226157", "DC7 TFO", "CDR E1", "Cedar Rapids, IA"],
    ["50-10-226035", "Signature Aviation IAD", "IAD", "Washington Dulles, VA"],
    ["50-40-222153", "Suffolk PDX 112 TM", "PDX", "Portland, OR"],
    ["50-40-223021", "Suffolk PDX 170 TM", "PDX", "Portland, OR"],
    ["50-60-124005", "Scholes - PHL 104 TM", "PHL", "Philadelphia, PA"],
    ["50-60-124012", "Joyce Electrical - PHL 104 TM", "PHL", "Philadelphia, PA"],
    ["50-60-223144", "IAD 215 MC", "IAD", "Washington Dulles, VA"],
    ["50-60-223150", "PDX 080 TM", "PDX", "Portland, OR"],
    ["50-60-224022", "PDX 171 TM", "PDX", "Portland, OR"],
    ["50-60-224049", "IAD 211 TM", "IAD", "Washington Dulles, VA"],
    ["50-60-224052", "IAD 210 TM", "IAD", "Washington Dulles, VA"],
    ["50-60-224175", "CMH 099", "CMH", "Columbus, OH"],
    ["50-60-224189", "LCK062", "LCK", "Columbus, OH"],
    ["50-60-224207", "PDX 172", "PDX", "Portland, OR"],
    ["50-60-224211", "IAD 421 TM", "IAD", "Washington Dulles, VA"],
    ["50-60-225029", "PDX 202 TM", "PDX", "Portland, OR"],
    ["50-60-225031", "PDX 173 TM", "PDX", "Portland, OR"],
    ["50-60-225033", "IAD 230 TM", "IAD", "Washington Dulles, VA"],
    ["50-60-225039", "IAD 1000 TM", "IAD", "Washington Dulles, VA"],
    ["50-60-225096", "PDX 174 GR TM", "PDX", "Portland, OR"],
    ["50-60-225101", "PDX 203 TM", "PDX", "Portland, OR"],
    ["50-60-225141", "IAD 018 TM", "IAD", "Washington Dulles, VA"],
    ["50-60-225168", "IAD 045 TM", "IAD", "Washington Dulles, VA"],
    ["50-60-226094", "Project Gravity", null, null],
    ["50-60-226144", "IAD 215", "IAD", "Washington Dulles, VA"],
    ["50-60-226300", "Compass Bldg E Tenant Fit-Out", null, null],
    ["60-26-100291", "PDX 204", "PDX", "Portland, OR"],
    ["60-26-100491", "IAD 537", "IAD", "Washington Dulles, VA"],
    ["60-26-100492", "IAD 536", "IAD", "Washington Dulles, VA"],
    ["60-26-100493", "IAD 534", "IAD", "Washington Dulles, VA"],
    ["60-26-100494", "IAD 535", "IAD", "Washington Dulles, VA"],
    ["60-26-100682", "PHL 101 - LS FE Procurement", "PHL", "Philadelphia, PA"],
    ["60-26-100783", "DFW2 DC-1 TFO", "DFW2", "Dallas-Fort Worth, TX"],
    ["60-26-100884", "SBN AUX Bldg A&C Att. Tank", "SBN", "South Bend, IN"],
    ["60-26-300181", "Water Remediation", null, null],
    ["60-26-300691", "B&S Office Trailer Fitout TM", null, null],
    ["60-26-301081", "Helix Trailer Decking", null, null],
  ];
  const REGISTER = REGISTER_ROWS.map(([job_number, short_name, campus, region]) => ({
    job_number, short_name, name: short_name || null, campus: campus || null, region: region || null,
  }));
  /**
   * Add sheet jobs that are not already on file. Fill a blank campus or region.
   * Leave a job the sheet omits, and leave a name or a campus that is already set.
   * make(job) builds the stored row for a new job; the default copies the sheet row.
   */
  function mergeInto(existing, incoming, make) {
    const jobs = existing || [];
    const by = new Map(jobs.map((j) => [j.job_number, j]));
    let added = 0, filled = 0;
    for (const src of incoming || []) {
      const campus = alignCampus(src.campus);
      const region = src.region || null;
      const hit = by.get(src.job_number);
      if (!hit) {
        const row = make ? make(Object.assign({}, src, { campus, region })) : Object.assign({}, src, { campus, region });
        jobs.push(row);
        by.set(row.job_number, row);
        added++;
      } else {
        if (!hit.campus && campus) { hit.campus = campus; filled++; }
        if (!hit.region && region) { hit.region = region; filled++; }
      }
    }
    return { jobs, added, filled };
  }
  return { REQUIRED, CAMPUS_TAX_BP, REGISTER, taxFor, alignCampus, mergeInto, looksLike, readWorkbook, read };
}));
