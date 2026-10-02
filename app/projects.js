/* projects.js - the job register, Projects.xlsx: Job #, Project Name, Campus,
   Region. One row per job; dropping it adds the jobs the page does not have
   and fills in a blank campus or region on the ones it does. Nothing is
   renamed and nothing is removed: Settings does that, one job at a time. */
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
      jobs.push({ row_index: i + 1, job_number, short_name: name || job_number, name: name || null, campus: C.oneLine(at(r, "Campus")) || null, region: C.oneLine(at(r, "Region")) || null });
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
  return { REQUIRED, CAMPUS_TAX_BP, taxFor, looksLike, readWorkbook, read };
}));
