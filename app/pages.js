/* pages.js - three hash routes in the one app.

   #/            the map, the ten campuses, and the month's four tiles.
                 It stops there. It does not list every project's rows.
   #/c/<code>    one campus: its tiles, then its projects as links.
   #/p/<job>     one project. The weekly cost review is mounted here,
                 and only this job's labor, rentals, and purchases.
   #/review      is not a page. It sends a selected job to #/p/, a
                 selected campus to #/c/, and everything else to #/. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"), require("./portfolio_map.js"));
  else root.Pages = factory(root.Common, root.PortfolioMap);
}(typeof self !== "undefined" ? self : this, function (C, PM) {
  "use strict";

  const ORDER = PM.CAMPUS_ORDER ? PM.CAMPUS_ORDER.slice() : ["PHL", "SBN", "IAD", "PDX", "DFW", "LCK", "CMH", "CDR", "AUS", "BWI"];
  const ALIAS = { "CDR E1": "CDR", "CDRE1": "CDR", "DFW2": "DFW" };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const chrome = `<style>.pf a.pf-row{padding:10px 14px;gap:10px;text-decoration:none;color:inherit;align-items:flex-start}.pf a.pf-row:hover{background:rgba(255,255,255,.04);text-decoration:none}.pf-projects{list-style:none;margin:8px 0 0;padding:0}.pf-projects li{padding:10px 2px;border-bottom:1px solid rgba(42,68,102,.9)}</style>`;
  const money = (cents) => C.fmtMoney(cents || 0, { whole: true });
  const n1 = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

  function campusCode(label) {
    if (PM.canonicalCampus) return PM.canonicalCampus(label);
    const raw = String(label == null ? "" : label).trim();
    if (!raw) return null;
    const k = raw.toUpperCase().replace(/\s+/g, " ");
    if (k === "OTHER" || k === "UNASSIGNED" || k === "(NONE)") return null;
    if (ORDER.indexOf(k) >= 0) return k;
    if (ALIAS[k]) return ALIAS[k];
    const head = (k.split(/[^A-Z0-9]+/).filter(Boolean)[0]) || "";
    if (ALIAS[head]) return ALIAS[head];
    if (ORDER.indexOf(head) >= 0) return head;
    return null;
  }

  function activeJobs(jobs) {
    return (jobs || []).filter((j) => j && j.active !== false);
  }

  function groupCampuses(jobs) {
    const groups = {};
    for (let i = 0; i < ORDER.length; i++) groups[ORDER[i]] = [];
    for (const j of activeJobs(jobs)) {
      const code = campusCode(j.campus);
      if (code && groups[code]) groups[code].push(j);
    }
    return groups;
  }

  function jobsForCampus(jobs, code) {
    const want = campusCode(code);
    if (!want) return [];
    return activeJobs(jobs).filter((j) => campusCode(j.campus) === want);
  }

  /** The jobs array and the project filter Rev.build should see for one project page. */
  function reviewScope(jobs, jobNumber) {
    const n = String(jobNumber || "").trim();
    const job = activeJobs(jobs).find((j) => j.job_number === n) || (jobs || []).find((j) => j && j.job_number === n) || null;
    return { job, jobs: job ? [job] : [], projects: n ? [n] : [] };
  }

  function qs(pairs) {
    const parts = [];
    for (let i = 0; i < pairs.length; i++) if (pairs[i][1]) parts.push(encodeURIComponent(pairs[i][0]) + "=" + encodeURIComponent(pairs[i][1]));
    return parts.length ? "?" + parts.join("&") : "";
  }
  function portfolioHref(month) { return "#/" + (month ? "?m=" + encodeURIComponent(month) : ""); }
  function campusHref(code, month) { return "#/c/" + encodeURIComponent(campusCode(code) || code) + qs([["m", month || ""]]); }
  function projectHref(jobNumber, month, extra) {
    const x = extra || {};
    return "#/p/" + encodeURIComponent(jobNumber) + qs([["m", month || ""], ["tab", x.tab || ""], ["w", x.w || ""]]);
  }

  /**
   * #/review is not a scrolling page. A job (query j, or one project already
   * chosen) opens that project. A campus with no job opens that campus.
   * Anything else opens the portfolio. tab and w travel with a job.
   */
  function reviewRedirect(route, review) {
    const q = (route && route.q) || {};
    const month = q.m && /^\d{4}-\d{2}$/.test(q.m) ? q.m : "";
    const fromReview = review && review.projects && review.projects.length === 1 ? review.projects[0] : "";
    const job = String(q.j || "").trim() || fromReview;
    if (job) return projectHref(job, month, { tab: q.tab || "", w: q.w || "" });
    const code = campusCode(q.c) || (review && review.campuses && review.campuses.length === 1 ? campusCode(review.campuses[0]) : "");
    if (code) return campusHref(code, month);
    return portfolioHref(month);
  }

  /** Keep the weekly review's tab links on this project instead of #/review. */
  function retargetReview(html, jobNumber, month) {
    const base = "#/p/" + encodeURIComponent(jobNumber) + "?m=" + encodeURIComponent(month || "") + "&tab=";
    return String(html || "").replace(/#\/review\?tab=/g, base);
  }

  function tile(cls, label, cents, sub) {
    return `<div class="tile ${cls}"><div class="label">${esc(label)}</div><div class="value">${esc(money(cents))}</div><div class="sub">${esc(sub || "")}</div></div>`;
  }
  function tiles(tot, laborNote) {
    return `<div class="tiles">${tile("total", "Total", tot.all, `${n1(tot.withCost, "job")} with cost`)}${tile("labor", "Labor", tot.labor, laborNote || "")}${tile("equipment", "Rentals", tot.rent, "on-rent reports and confirmed recurring charges")}${tile("materials", "Purchases", tot.purch, tot.pending ? `${money(tot.pending)} awaiting a decision` : "")}</div>`;
  }
  function monthLinks(month, hrefFor) {
    const prev = C.monthOf(C.addDays(month + "-01", -1));
    const next = C.monthOf(C.addDays(C.monthEnd(month), 1));
    return `<div class="row pf-months noprint"><a href="${esc(hrefFor(prev))}">&larr; ${esc(C.fmtMonth(prev))}</a><span class="big">${esc(C.fmtMonth(month))}</span><a href="${esc(hrefFor(next))}">${esc(C.fmtMonth(next))} &rarr;</a></div>`;
  }

  function campusRows(campuses, month) {
    return campuses.map((c) => `<a class="pf-row" href="${esc(campusHref(c.code, month))}" data-campus="${esc(c.code)}">
      <span class="pf-bullet ${c.hasCost ? "on" : ""}"></span>
      <span class="pf-row-main"><span class="pf-row-name">${esc(c.code)}</span>${c.region ? `<span class="pf-row-region">${esc(c.region)}</span>` : ""}${c.active ? `<span class="pf-live">Active</span>` : ""}</span>
      <span class="pf-row-fig"><span class="pf-row-money">${esc(money(c.total))}</span><span class="pf-row-jobs">${esc(n1(c.jobs.length, "job"))}</span></span>
    </a>`).join("");
  }

  function describeCampuses(jobs, rows) {
    const groups = groupCampuses(jobs);
    return ORDER.map((code) => {
      const list = groups[code];
      const t = PM.monthScope(rows, list.map((j) => j.job_number));
      const place = PM.locate(code);
      return {
        code, jobs: list, total: t.all, hours: t.hours, held: t.held, place,
        region: (place && place.place) || ((list.find((j) => j.region) || {}).region) || "",
        hasCost: t.all !== 0,
        active: t.all !== 0 || t.hours !== 0 || t.held !== 0,
      };
    });
  }

  /** Portfolio. Map, ten campuses, four tiles. No per-project weekly rows. */
  function portfolio(o) {
    const month = o.month;
    const rows = o.rows || [];
    const campuses = describeCampuses(o.jobs, rows);
    const tot = PM.monthScope(rows, null);
    const points = campuses.filter((c) => c.place).map((c) => ({ id: c.code, name: c.code, lon: c.place.lon, lat: c.place.lat, hasCost: c.hasCost, selected: false }));
    const svg = PM.svg({ points });
    const laborNote = o.laborNote || (tot.hours ? "" : "");
    return `${chrome}<div class="pf" data-page="portfolio">
      <div class="pf-head">
        <div class="pf-intro">
          <h1 class="pf-title">${esc(o.title || "Mission Critical")}</h1>
          <p class="pf-sub">${esc(n1(ORDER.length, "campus", "campuses"))} · ${esc(money(tot.all))} this month. Figures come from HH2, the on-rent reports, and Purchase Pro.</p>
        </div>
        <div class="pf-tools noprint">
          ${monthLinks(month, (mm) => portfolioHref(mm))}
          <span class="row"><a href="#/report/all?m=${esc(month)}"><button type="button">Report (PDF)</button></a><button id="buckets" type="button" title="one row per job, month and bucket, the shape GRforecast imports">Export for GRforecast</button></span>
        </div>
      </div>
      ${tiles(tot, o.laborNote || laborNote)}
      ${o.pendingLines && o.canEdit ? `<p class="noprint"><a href="#/settings?tab=purchases">${esc(n1(o.pendingLines, "PO awaits", "POs await"))} a decision &rarr;</a></p>` : ""}
      <div class="pf-band">
        <div class="pf-map">${svg}
          <div class="pf-legend"><span><i class="cost"></i>Has cost this month</span><span><i></i>No cost yet</span><span class="note">Each dot is a campus, where it is.</span></div>
        </div>
        <aside class="pf-side">
          <div class="pf-side-in">
            <div class="pf-side-head"><div class="pf-side-title">Campuses</div><div class="pf-side-col">this month</div></div>
            <div class="pf-rows">${campusRows(campuses, month)}</div>
          </div>
        </aside>
      </div>
      ${activeJobs(o.jobs).length === 0 ? `<div class="notice">No jobs yet. Drop the Projects register or an HH2 export on Update, or add them in <a href="#/settings">Settings</a>.</div>` : ""}
    </div>`;
  }

  /** One campus. Its tiles, then its projects as links. */
  function campus(o) {
    const month = o.month;
    const code = campusCode(o.code) || String(o.code || "").trim();
    const list = jobsForCampus(o.jobs, code);
    const tot = PM.monthScope(o.rows || [], list.map((j) => j.job_number));
    const place = PM.locate(code);
    const links = list.slice().sort((a, b) => String(a.short_name || a.job_number).localeCompare(String(b.short_name || b.job_number), undefined, { numeric: true })).map((j) => {
      const short = j.short_name || j.job_number;
      return `<li><a href="${esc(projectHref(j.job_number, month))}">${esc(short)}</a> <span class="muted small">${esc(j.job_number)}</span></li>`;
    }).join("");
    return `${chrome}<div class="pf" data-page="campus" data-campus="${esc(code)}">
      <p class="noprint"><a href="${esc(portfolioHref(month))}">&larr; All campuses</a></p>
      <div class="pf-head">
        <div class="pf-intro">
          <h1 class="pf-title">${esc(code)}</h1>
          <p class="pf-sub">${place && place.place ? esc(place.place) + " · " : ""}${esc(n1(list.length, "project"))} · ${esc(money(tot.all))} this month.</p>
        </div>
        <div class="pf-tools noprint">${monthLinks(month, (mm) => campusHref(code, mm))}</div>
      </div>
      ${tiles(tot, o.laborNote || "")}
      <h2>Projects</h2>
      ${links ? `<ul class="pf-projects">${links}</ul>` : `<p class="muted">No projects on ${esc(code)} yet.</p>`}
    </div>`;
  }

  /** One project. Header is Campus > Project. The weekly review is this job only. */
  function project(o) {
    const month = o.month;
    const job = o.job || { job_number: o.jobNumber, short_name: o.jobNumber };
    const code = campusCode(job.campus) || "";
    const label = PM.selectionLabel(code || job.campus, job.short_name || job.job_number);
    const tot = PM.monthScope(o.rows || [], [job.job_number]);
    const back = code ? campusHref(code, month) : portfolioHref(month);
    const backLabel = code || "All campuses";
    return `<div class="pf" data-page="project" data-job="${esc(job.job_number)}">
      <p class="noprint"><a href="${esc(back)}">&larr; ${esc(backLabel)}</a></p>
      <div class="pf-head">
        <div class="pf-intro">
          <h1 class="pf-title">${esc(label)}</h1>
          <p class="pf-sub">${esc(job.job_number)} · ${esc(C.fmtMonth(month))}.</p>
        </div>
        <div class="pf-tools noprint">${monthLinks(month, (mm) => projectHref(job.job_number, mm, { tab: o.tab || "", w: o.week || "" }))}</div>
      </div>
      ${tiles(tot, o.laborNote || "")}
      ${o.reviewHtml || ""}
    </div>`;
  }

  return {
    CAMPUS_ORDER: ORDER, campusCode, jobsForCampus, reviewScope, reviewRedirect, retargetReview,
    portfolioHref, campusHref, projectHref, portfolio, campus, project,
  };
}));
