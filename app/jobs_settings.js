/* jobs_settings.js - Settings → Jobs, grouped by the ten campus codes.

   One line per project: short name, job number, name, and the rate-table
   code. The editor is a panel opened from that line. A stored campus that
   names one of the ten codes (CDR E1, DFW2) shows and saves as that code.
   Anything else is one Unassigned group, not an eleventh campus. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./portfolio_map.js"));
  else root.JobsSettings = factory(root.PortfolioMap);
}(typeof self !== "undefined" ? self : this, function (PM) {
  "use strict";

  const CODES = ["PHL", "SBN", "IAD", "PDX", "DFW", "LCK", "CMH", "CDR", "AUS", "BWI"];

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** One of the ten codes, or null. A label that starts with a code is that code. */
  function campusCode(label) {
    if (PM && PM.canonicalCampus) {
      const canon = PM.canonicalCampus(label);
      if (canon) return canon;
    }
    const raw = String(label == null ? "" : label).trim().toUpperCase();
    if (!raw || raw === "OTHER" || raw === "UNASSIGNED" || raw === "(NONE)") return null;
    const order = (PM && PM.CAMPUS_ORDER ? PM.CAMPUS_ORDER : CODES).slice().sort((a, b) => b.length - a.length);
    for (let i = 0; i < order.length; i++) if (raw === order[i] || raw.startsWith(order[i])) return order[i];
    return null;
  }

  function rateToken(code) {
    const s = String(code == null ? "" : code).trim();
    if (!s) return "";
    const m = s.match(/#[A-Za-z0-9][A-Za-z0-9./_-]*/);
    return m ? m[0] : s;
  }

  function groupsOf(jobs) {
    const order = PM && PM.CAMPUS_ORDER ? PM.CAMPUS_ORDER : CODES;
    const groups = {};
    for (let i = 0; i < order.length; i++) groups[order[i]] = [];
    const loose = [];
    for (const j of jobs || []) {
      const code = campusCode(j && j.campus);
      if (code && groups[code]) groups[code].push(j);
      else loose.push(j);
    }
    const sections = [];
    for (let i = 0; i < order.length; i++) if (groups[order[i]].length) sections.push({ code: order[i], jobs: groups[order[i]] });
    if (loose.length) sections.push({ code: "Unassigned", jobs: loose });
    return sections;
  }

  function rateChoices(tables, selected) {
    const out = [];
    const seen = {};
    for (const t of tables || []) {
      const code = t && t.code ? String(t.code) : "";
      if (!code || seen[code]) continue;
      seen[code] = true;
      out.push(code);
    }
    if (selected && !seen[selected]) out.push(String(selected));
    return out;
  }

  function campusSelect(selected) {
    const code = campusCode(selected) || "";
    const order = PM && PM.CAMPUS_ORDER ? PM.CAMPUS_ORDER : CODES;
    const opts = [`<option value=""${code ? "" : " selected"}>Unassigned</option>`];
    for (let i = 0; i < order.length; i++) {
      const c = order[i];
      opts.push(`<option value="${esc(c)}"${c === code ? " selected" : ""}>${esc(c)}</option>`);
    }
    return `<select name="campus">${opts.join("")}</select>`;
  }

  function rateSelect(tables, selected) {
    const token = selected ? String(selected) : "";
    const opts = [`<option value=""${token ? "" : " selected"}>No rate table</option>`];
    const choices = rateChoices(tables, token);
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      opts.push(`<option value="${esc(c)}"${c === token ? " selected" : ""}>${esc(rateToken(c) || c)}</option>`);
    }
    return `<select name="rate_table_code">${opts.join("")}</select>`;
  }

  function line(j, on) {
    const token = rateToken(j.rate_table_code);
    const rate = token || "No rate table";
    const href = "#/settings?tab=jobs&job=" + encodeURIComponent(j.job_number);
    return `<a class="job-line${on ? " on" : ""}${j.active === false ? " faint" : ""}" href="${href}" data-job="${esc(j.job_number)}">
      <span class="job-short">${esc(j.short_name || "")}</span>
      <span class="job-num">${esc(j.job_number)}</span>
      <span class="job-title">${esc(j.name || "")}</span>
      <span class="job-rate${token ? "" : " muted"}">${esc(rate)}</span>
    </a>`;
  }

  function fields(job, tables) {
    const n = job ? job.job_number : "";
    return `<label>Job #<input name="job_number" required pattern="\\d{2}-\\d{2}-\\d{6}" value="${esc(n)}" placeholder="50-60-225121"></label>
      <label>Short name<input name="short_name" required value="${esc(job ? job.short_name : "")}" placeholder="DC4"></label>
      <label>Name<input name="name" value="${esc(job && job.name ? job.name : "")}" placeholder="CDR1 East DC4"></label>
      <label>Campus${campusSelect(job ? job.campus : "")}</label>
      <label>Region<input name="region" value="${esc(job && job.region ? job.region : "")}" placeholder="Cedar Rapids, IA"></label>
      <label>Rate table${rateSelect(tables, job ? job.rate_table_code : "")}</label>`;
  }

  function editor(o, job) {
    const edit = !!o.edit;
    const selected = o.selected || "";
    if (selected === "new") {
      if (!edit) return "";
      return `<aside class="job-editor"><h2>Add job</h2>
        <form id="addjob"><div class="job-fields">${fields(null, o.tables)}</div><button class="primary">Add job</button></form>
        <p class="muted small"><a href="#/settings?tab=jobs">Close</a></p></aside>`;
    }
    if (!job) return "";
    const title = job.short_name || job.job_number;
    if (!edit) {
      const token = rateToken(job.rate_table_code);
      return `<aside class="job-editor"><h2>${esc(title)}</h2>
        <dl class="job-read">
          <dt>Job #</dt><dd class="job-num">${esc(job.job_number)}</dd>
          <dt>Short name</dt><dd>${esc(job.short_name || "")}</dd>
          <dt>Name</dt><dd>${esc(job.name || "")}</dd>
          <dt>Campus</dt><dd>${esc(campusCode(job.campus) || "Unassigned")}</dd>
          <dt>Region</dt><dd>${esc(job.region || "")}</dd>
          <dt>Rate table</dt><dd>${esc(token || "No rate table")}</dd>
        </dl>
        <p class="muted small"><a href="#/settings?tab=jobs">Close</a></p></aside>`;
    }
    return `<aside class="job-editor"><h2>${esc(title)}</h2>
      ${job.active === false ? `<p><span class="pill">inactive</span></p>` : ""}
      <form class="job" data-n="${esc(job.job_number)}"><div class="job-fields">${fields(job, o.tables)}</div><button class="primary">Save</button></form>
      <p class="muted small"><a href="#/settings?tab=jobs">Close</a></p></aside>`;
  }

  function render(o) {
    const opts = o || {};
    const jobs = opts.jobs || [];
    const selected = opts.selected || "";
    const byNo = {};
    for (let i = 0; i < jobs.length; i++) byNo[jobs[i].job_number] = jobs[i];
    const open = selected === "new" || !!byNo[selected];
    const sections = groupsOf(jobs);
    const blocks = sections.map((s) => `<section class="job-campus" data-campus="${esc(s.code)}"><h2>${esc(s.code)}</h2>${s.jobs.map((j) => line(j, j.job_number === selected)).join("")}</section>`);
    const add = opts.edit ? `<p class="jobs-add"><a href="#/settings?tab=jobs&job=new">Add job</a></p>` : "";
    return `<div class="jobs-set${open ? " has-editor" : ""}">
      <div class="jobs-list">
        <p class="muted small">Every project, under its campus. The line is the short name, the job number, and the name. The rate table is its code. Open a project to edit it.</p>
        ${add}
        ${blocks.join("") || `<p class="muted">No jobs yet. Drop the Projects register on Update, or add one.</p>`}
      </div>
      ${open ? editor(opts, byNo[selected] || null) : ""}
    </div>`;
  }

  return { CAMPUS_ORDER: CODES, campusCode, groupsOf, rateToken, render };
}));
