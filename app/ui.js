/* ui.js - the page. Every piece of markup is built with the html`` tag,
   which escapes every interpolation, and put on the page with mount().
   File names, vendor job labels, notes and names all come from outside.

   Pages (hash routes):
     #/                 Portfolio - the map, the ten campuses, this month's four tiles. It ends there.
     #/c/<code>?m=      Campus - that campus's tiles, then its projects as links
     #/p/<job>?m=       Project - Campus > Project, and the weekly cost review for that job only
     #/job/<n>?m=       Job - the tiles, labor by class and code, rentals, purchases, held
     #/report/<n>?m=    Report - print it, choose Save as PDF (#/report/all for every job)
     #/review           Redirect - a selected job opens #/p/, otherwise the portfolio
     #/statement/<n>?m=&v=  the client's rental statement for one vendor
     #/update           Update - drop the files, read the cards, press Record
     #/settings         Settings - jobs, vendors, their job names, rate tables, employees, pay types, people, files */
(function (root) {
  "use strict";
  const C = root.Common, B = root.Buckets, L = root.LaborModel, R = root.RentalsModel, Rev = root.ReviewModel, V = root.OnRentVendors, SS = root.SiteServices,
    Intake = root.Intake, E = root.ExportXlsx, cfg = root.CostConfig, PM = root.PortfolioMap, Pages = root.Pages;
  const RELEASE = "0.1.12";

  // ---- markup, escaped by default --------------------------------------------------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  class Raw { constructor(s) { this.s = s; } }
  const raw = (s) => new Raw(s);
  const part = (v) => (v == null || v === false ? "" : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join("") : esc(v));
  const html = (strings, ...vals) => new Raw(strings.reduce((out, str, i) => out + str + (i < vals.length ? part(vals[i]) : ""), ""));
  function mount(el, tpl) { const t = document.createElement("template"); t.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); el.replaceChildren(t.content); }
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const money = (c, whole) => C.fmtMoney(c, { whole });
  const hours = (h) => C.fmtHours(Math.round((h || 0) * 100));
  const pct = (bp) => (bp / 100).toFixed(2).replace(/\.?0+$/, "") + "%";
  const ym = (d) => String(d).slice(0, 7);
  const n1 = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  let toastTimer = null;
  function toast(msg, ms = 3500) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms); }

  // ---- state and routing ----------------------------------------------------------------
  const st = { db: null, route: { page: "", parts: [], q: {} }, settings: null, ctx: null, cards: [], month: ym(C.todayIso()), user: null, asOf: {} };
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [pathPart, qs] = h.split("?");
    const parts = pathPart.split("/").filter(Boolean);
    const q = {};
    for (const kv of (qs || "").split("&")) if (kv) { const [k, v] = kv.split("="); q[decodeURIComponent(k)] = decodeURIComponent(v || ""); }
    return { page: parts[0] || "", parts, q };
  }
  const monthQ = (q) => (q.m && /^\d{4}-\d{2}$/.test(q.m) ? q.m : st.month);
  const prevMonth = (m) => C.monthOf(C.addDays(m + "-01", -1));
  const nextMonth = (m) => C.monthOf(C.addDays(C.monthEnd(m), 1));

  async function render() {
    st.route = parseHash();
    const app = $("#app");
    try {
      if (!st.user && st.db.mode === "live") { mount(app, signinView()); wireSignin(); return; }
      if (!st.db.ws) { mount(app, chooseWorkspaceView()); wireChoose(); return; }
      if (!st.settings) st.settings = await loadSettings();
      const r = st.route;
      let body;
      if (r.page === "review") body = await reviewPage();
      else if (r.page === "c" && r.parts[1]) body = await campusView(decodeURIComponent(r.parts[1]), monthQ(r.q));
      else if (r.page === "p" && r.parts[1]) body = await projectView(decodeURIComponent(r.parts[1]), monthQ(r.q));
      else if (r.page === "job" && r.parts[1]) body = await jobView(r.parts[1], monthQ(r.q));
      else if (r.page === "report") body = await reportView(r.parts[1] || "all", monthQ(r.q));
      else if (r.page === "statement" && r.parts[1]) body = await statementView(r.parts[1], monthQ(r.q), r.q.v);
      else if (r.page === "update") body = updateView();
      else if (r.page === "settings") body = await settingsView(r.q.tab || "jobs");
      else body = await portfolioView(monthQ(r.q));
      const printing = r.page === "report" || r.page === "statement";
      mount(app, html`${printing ? "" : await topView()}<main>${body}</main>${titleBlock()}`);
      wire();
    } catch (e) {
      console.error(e);
      mount(app, html`${await topView().catch(() => "")}<main><div class="notice error"><b>Something went wrong.</b> ${e.message || String(e)}</div></main>`);
    }
    st.renders = (st.renders || 0) + 1; // a test waits on this
  }

  // ---- sign in ---------------------------------------------------------------------------
  const signinView = () => html`<main class="signin"><div class="card">
    <h1>GR Cost</h1><p class="muted">Sign in with the 6-digit code emailed to you. No password.</p>
    <form id="send" class="inline"><label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@libertybuilds.com"></label><button class="primary">Send code</button></form>
    <form id="verify" class="inline" hidden><label>Code<input name="token" inputmode="numeric" pattern="[0-9]{6}" required placeholder="123456"></label><button class="primary">Sign in</button></form>
    <p id="msg" class="muted small"></p></div></main>`;
  function wireSignin() {
    let email = "";
    $("#send").addEventListener("submit", async (ev) => { ev.preventDefault(); email = ev.target.email.value.trim(); try { await st.db.sendCode(email); $("#verify").hidden = false; $("#msg").textContent = `Code sent to ${email}.`; } catch (e) { $("#msg").textContent = e.message; } });
    $("#verify").addEventListener("submit", async (ev) => { ev.preventDefault(); try { st.user = await st.db.verify(email, ev.target.token.value.trim()); await st.db.loadWorkspaces(); if (st.db.workspaces.length === 1) st.db.use(st.db.workspaces[0].id); render(); } catch (e) { $("#msg").textContent = e.message; } });
  }
  const chooseWorkspaceView = () => html`<main class="signin"><div class="card"><h1>Which workspace?</h1>
    ${st.db.workspaces.length ? html`<ul>${st.db.workspaces.map((w) => html`<li><button class="link" data-ws="${w.id}">${w.name}</button> <span class="muted small">${w.role}</span></li>`)}</ul>` : html`<p class="muted">You are not in a workspace yet. Ask an owner to invite your email, or start one:</p>`}
    <form id="newws" class="inline"><label>New workspace<input name="name" required placeholder="Liberty Builds"></label><button>Create</button></form>
    <p><button class="link" id="signout">Sign out</button></p></div></main>`;
  function wireChoose() {
    $$("[data-ws]").forEach((b) => b.addEventListener("click", () => { st.db.use(b.dataset.ws); render(); }));
    $("#newws").addEventListener("submit", async (ev) => { ev.preventDefault(); try { const id = await st.db.createWorkspace(ev.target.name.value.trim()); await st.db.loadWorkspaces(); st.db.use(id); render(); } catch (e) { toast(e.message); } });
    $("#signout").addEventListener("click", async () => { await st.db.signOut(); st.user = null; render(); });
  }

  // ---- shared data ------------------------------------------------------------------------
  async function loadSettings() {
    const db = st.db;
    const [jobs, vendors, map, tables, rates, employees, policy, members, wasteVendors, prefixes] = await Promise.all([
      db.view("jobs", {}, { order: "job_number" }), db.view("vendors", {}, { order: "vendor_key" }), db.view("vendor_job_map"),
      db.view("rate_tables", {}, { order: "code" }), db.view("billable_rates"),
      db.canEdit() ? db.view("employees") : Promise.resolve([]), db.view("pay_type_policy"), db.view("members").catch(() => []), db.view("waste_vendors").catch(() => []),
      db.view("prefix_classes", {}, { order: "prefix" }).catch(() => [])]);
    const jobMap = {};
    for (const m of map) (jobMap[m.vendor_key] = jobMap[m.vendor_key] || {})[m.vendor_job_ref] = m.job_number;
    const live = rates.filter((r) => !r.retired_at).map((r) => Object.assign({}, r, r.effective && !r.effective_from ? rangeOf(r.effective) : {}));
    const jobByNumber = Object.fromEntries(jobs.map((j) => [j.job_number, j]));
    const vendorByKey = Object.fromEntries(vendors.map((v) => [v.vendor_key, v]));
    return { jobs, vendors, jobMap, tables, rates: live, allRates: rates, employees, policy, members, wasteVendors, prefixes, prefixMap: L.prefixMap(prefixes), jobByNumber, vendorByKey,
      // the shape rentals_model.settingsFor reads: tax and markup are the job's, taxable is the vendor's
      rental: { vendors: vendorByKey, jobs: jobByNumber } };
  }
  /** "[2026-07-01,2027-07-01)" -> {effective_from, effective_to} */
  function rangeOf(s) { const m = String(s).match(/^([\[(])([^,]*),([^\])]*)([\])])$/); if (!m) return {}; return { effective_from: m[2] || null, effective_to: m[3] ? (m[4] === "]" ? C.addDays(m[3], 1) : m[3]) : null }; }
  const jobName = (n) => { const j = st.settings.jobByNumber[n]; return j ? j.short_name : n; };
  const vendorName = (k) => { const v = st.settings.vendorByKey[k]; return v ? v.name : V.vendorName(k); };
  const classLabel = (c) => (c ? `${L.classLabel(c)} (${c})` : "(no class)");
  const intakeCtx = () => ({
    labor: { rates: st.settings.rates, employees: Object.fromEntries(st.settings.employees.map((e) => [e.employee_number, e])),
      policy: Object.fromEntries(st.settings.policy.map((p) => [p.pay_type_name, p.policy])), jobs: st.settings.jobs, prefixes: st.settings.prefixMap },
    vendorSettings: st.settings.rental, jobMap: st.settings.jobMap, existing: (sha) => st.db.existing(sha), asOf: st.asOf || {}, wasteVendors: st.settings.wasteVendors,
  });

  // ---- header and foot ------------------------------------------------------------------------
  /** Navigation and the session only. opts.freshness and opts.reports are the uploads already on file; the header does not list them. Update shows the current drop, and Settings keeps the file history. */
  function headerMarkup(opts) {
    const page = opts.page || "";
    const portOn = !page || page === "c" || page === "p";
    const chip = (cls, text) => html`<span class="chip ${cls}"><span class="dot"></span>${text}</span>`;
    const nav = (p, label, on) => html`<a href="${p === "" ? (opts.home || "#/") : `#/${p}`}" class="${on ? "on" : ""}">${label}</a>`;
    const session = opts.mode === "demo" ? chip("demo", "Demo: nothing is saved") : html`<span class="chip">${opts.user && opts.user.email ? opts.user.email : ""} · ${opts.role || ""}</span>`;
    return html`<header class="top"><span class="brand">GR Cost</span>
      <nav>${nav("", "Portfolio", portOn)}${nav("review", "Review", page === "review")}${opts.canEdit ? nav("update", "Update", page === "update") : ""}${nav("settings", "Settings", page === "settings")}</nav>
      <span class="spacer"></span>
      ${session}
    </header>`;
  }
  async function topView() {
    const f = (await st.db.view("v_freshness"))[0] || {};
    return headerMarkup({
      page: st.route.page, canEdit: st.db.canEdit(), mode: st.db.mode, user: st.user, role: st.db.role, home: Pages.portfolioHref(monthQ(st.route.q)),
      freshness: f, reports: f.uploads || [],
    });
  }
  const titleBlock = () => html`<footer class="titleblock"><span>GR Cost v${RELEASE}</span><span>${st.db.mode === "demo" ? "demo mode" : "live"}</span><span>${st.settings ? n1(st.settings.jobs.length, "job") : ""}</span><span>money in cents, rounded half up</span></footer>`;

  // ---- Portfolio ----------------------------------------------------------------------------------
  const monthNav = (m, base) => html`<div class="row noprint"><a href="${base}?m=${prevMonth(m)}">&larr; ${C.fmtMonth(prevMonth(m))}</a><span class="big">${C.fmtMonth(m)}</span><a href="${base}?m=${nextMonth(m)}">${C.fmtMonth(nextMonth(m))} &rarr;</a></div>`;
  const reviewState = () => st.review || (st.review = { campuses: null, projects: null, sort: {} });
  function laborNoteFor(rows, month, fresh) {
    const tot = PM.monthScope(rows, null);
    const f = (fresh || [])[0] || {};
    if (!tot.hours && f.hh2_through && C.monthOf(f.hh2_through) !== month) return `no hours in ${C.fmtMonth(month)} yet; HH2 through ${C.fmtDay(f.hh2_through)} (see ${C.fmtMonth(C.monthOf(f.hh2_through))})`;
    if (tot.hours) return `${hours(tot.hours)} hours${tot.held ? `, ${hours(tot.held)} held` : ""}`;
    return "";
  }
  async function monthRows(m) {
    const [rows, fresh] = await Promise.all([st.db.view("v_job_month", { month: m + "-01" }), st.db.view("v_freshness").catch(() => [])]);
    return { rows, fresh };
  }
  async function portfolioView(m) {
    const { rows, fresh } = await monthRows(m);
    const tot = PM.monthScope(rows, null);
    return raw(Pages.portfolio({
      title: "Mission Critical",
      month: m, jobs: st.settings.jobs, rows, laborNote: laborNoteFor(rows, m, fresh),
      pendingLines: tot.pendingLines, canEdit: st.db.canEdit(),
    }));
  }
  async function campusView(code, m) {
    const { rows, fresh } = await monthRows(m);
    const list = Pages.jobsForCampus(st.settings.jobs, code);
    const ids = list.map((j) => j.job_number);
    const tot = PM.monthScope(rows, ids);
    const f = (fresh || [])[0] || {};
    const note = !tot.hours && f.hh2_through && C.monthOf(f.hh2_through) !== m ? `no hours in ${C.fmtMonth(m)} yet; HH2 through ${C.fmtDay(f.hh2_through)}`
      : tot.hours ? `${hours(tot.hours)} hours${tot.held ? `, ${hours(tot.held)} held` : ""}` : "";
    return raw(Pages.campus({ code, month: m, jobs: st.settings.jobs, rows, laborNote: note }));
  }
  async function projectView(n, m) {
    const scope = Pages.reviewScope(st.settings.jobs, n);
    const job = scope.job || { job_number: n, short_name: n, campus: null, active: true };
    const { rows, fresh } = await monthRows(m);
    const tot = PM.monthScope(rows, [n]);
    const f = (fresh || [])[0] || {};
    const note = tot.hours ? `${hours(tot.hours)} hours${tot.held ? `, ${hours(tot.held)} held` : ""}` : "";
    const q = st.route.q;
    const reviewHtml = Pages.retargetReview(await buildReview({
      jobs: scope.jobs.length ? scope.jobs : [job],
      projects: [n],
      tab: reviewTab(q),
      week: q.w || null,
    }), n, m);
    return raw(Pages.project({ job, month: m, rows, laborNote: note, reviewHtml, tab: reviewTab(q), week: q.w || "" }));
  }

  const tile = (cls, label, cents, sub) => html`<div class="tile ${cls}"><div class="label">${label}</div><div class="value">${money(cents, true)}</div><div class="sub">${sub || ""}</div></div>`;
  /** short_name is the label; name is the longer title. The register and HH2 often store the same string in both, and the report used to print it twice. */
  function jobHead(j) {
    const short = (j && (j.short_name || j.job_number)) || "";
    const name = j && j.name && String(j.name).trim() !== String(short).trim() ? j.name : "";
    return { short, name };
  }

  // ---- Job ----------------------------------------------------------------------------------------
  async function jobData(n, m) {
    const db = st.db, from = m + "-01", to = C.monthEnd(m);
    const [tileRows, classes, rentals, purchases, held, lines] = await Promise.all([
      db.view("v_job_month", { job_number: n, month: from }), db.view("v_labor_class_month", { job_number: n, month: from }),
      db.view("v_rental_month", { job_number: n, month: from }),
      db.view("v_purchase_docs", { job_number: n }, { range: { col: "doc_date", from, to } }).catch(() => []),
      db.canEdit() ? db.view("v_labor_held", { job_number: n }) : Promise.resolve([]),
      db.canEdit() ? db.view("v_labor_priced", { job_number: n }, { range: { col: "work_date", from, to } }) : Promise.resolve([])]);
    const items = db.canEdit() ? await db.view("v_rental_items", { job_number: n }).catch(() => []) : [];
    const [candidates, recur, charges, site, plex, dump, pulls] = await Promise.all([
      db.view("v_recurring_candidates", { job_number: n }).catch(() => []), db.view("v_recurring_month", { job_number: n, month: from }).catch(() => []),
      db.view("recurring_charges", { job_number: n }).catch(() => []),
      db.view("v_site_services_month", { job_number: n, month: from }).catch(() => []), db.view("v_trailer_plex_month", { job_number: n, month: from }).catch(() => []),
      db.view("v_dumpster_month", { job_number: n, month: from }).catch(() => []), db.view("dumpster_pulls", { job_number: n }, { range: { col: "pull_date", from, to }, order: "pull_date" }).catch(() => [])]);
    return { job: st.settings.jobByNumber[n] || { job_number: n, short_name: n }, month: m, tile: tileRows[0] || null, classes, rentals, purchases, held,
      lines: lines.map((r) => Object.assign({}, r, { hours_x100: r.hours_x100 != null ? r.hours_x100 : Math.round(r.hours * 100) })), items,
      candidates: candidates.slice().sort((a, b) => b.monthly_cents - a.monthly_cents), recur, charges: charges.slice().sort((a, b) => (a.start_month < b.start_month ? -1 : 1)),
      siteCounts: SS.fromViews(site, plex), dump: dump.slice().sort((a, b) => (a.vendor_name < b.vendor_name ? -1 : 1)), pulls };
  }
  function statementsFor(d) {
    // the month's statement per vendor from the items on rent at the month's snapshot
    const out = [];
    for (const rm of d.rentals) {
      const its = d.items.filter((i) => i.vendor_key === rm.vendor_key && i.first_seen <= rm.as_of && i.last_seen >= rm.as_of);
      const dropped = d.items.filter((i) => i.vendor_key === rm.vendor_key && i.off_rent_date && i.off_rent_date <= rm.as_of && i.off_rent_date >= d.month + "-01");
      const snap = { vendor_key: rm.vendor_key, as_of: rm.as_of, lines: its.map((i) => Object.assign({}, i, { vendor_job_ref: "x" })) };
      out.push(R.statement(snap, st.settings.rental, { x: d.job.job_number }, d.job.job_number, dropped.map((i) => Object.assign({}, i, { vendor_job_ref: "x" }))));
    }
    return out;
  }
  const classSort = (a, b) => ((a.certified_class || "~") + a.pay_id < (b.certified_class || "~") + b.pay_id ? -1 : 1);
  const pricedClasses = (d) => d.classes.filter((r) => r.status === "priced").sort(classSort);
  function classTable(rows, label) {
    return html`<table><tr><th>Class</th><th>Pay ID</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">Cost</th></tr>
      ${rows.map((r) => html`<tr><td>${classLabel(r.certified_class)}</td><td>${r.pay_id}${r.pay_type_name && r.pay_type_name !== r.pay_id ? html` <span class="muted small">${r.pay_type_name}</span>` : ""}</td><td class="num">${hours(r.hours)}</td><td class="num">${money(r.rate_cents)}</td><td class="num">${money(r.cost_cents)}</td></tr>`)}
      <tr class="total"><td colspan="2">${label}</td><td class="num">${hours(rows.reduce((a, r) => a + r.hours, 0))}</td><td></td><td class="num">${money(rows.reduce((a, r) => a + r.cost_cents, 0))}</td></tr></table>`;
  }
  function heldClassTable(rows) {
    return html`<h3>Held, not in the cost</h3><table><tr><th>Class</th><th>Pay ID</th><th>Why</th><th class="num">Hours</th></tr>
      ${rows.map((r) => html`<tr class="held"><td>${classLabel(r.certified_class)}</td><td>${r.pay_id}</td><td>${String(r.status || "").replace(/^held:/, "")}</td><td class="num">${hours(r.hours)}</td></tr>`)}
      <tr class="total"><td colspan="3">Held</td><td class="num">${hours(rows.reduce((a, r) => a + (+r.hours || 0), 0))}</td></tr></table>`;
  }
  const heldWhat = (h) => h.status === "held:no rate" ? `${classLabel(h.certified_class)} · ${h.pay_id}${h.rate_table_code ? ` · table ${h.rate_table_code}` : ""}`
    : h.status === "held:unknown job" ? `${h.job_number} ${h.job_name || ""}` : h.status === "held:no rate table" ? `${jobName(h.job_number)} has no rate table`
    : h.status === "held:PTO pay type" ? h.pay_type_name : h.status === "held:no class" ? `employee ${h.employee_number}` : h.employee_number || "";
  const heldTab = (held) => held.some((h) => h.status === "held:no rate" || h.status === "held:no rate table") ? "rates" : held.some((h) => h.status === "held:unknown job") ? "jobs" : held.some((h) => h.status === "held:no class") ? "employees" : "paytypes";
  const bucketName = (b) => (b ? (B.META[b] ? B.META[b].name : b) : "");
  const poSort = (a, b) => ((a.doc_date || "") + a.doc_number < (b.doc_date || "") + b.doc_number ? -1 : 1);
  const poStatus = (r) => html`<span class="pill ${r.status === "needs_decision" ? "held" : r.status === "excluded" || r.order_type === "Rental" ? "excluded" : "priced"}">${r.status === "needs_decision" ? "needs a decision" : r.status === "excluded" ? (r.cancelled ? "cancelled" : r.quote ? "quote" : "left out") : r.order_type === "Rental" ? "rental PO, apart" : r.status === "confirmed" ? "counted, by decision" : "counted"}</span>`;
  /** the decision an editor makes on a PO the export could not count: count it on a job, in a bucket, or leave it out */
  function decideForm(r, defaultJob) {
    if (!st.db.canEdit()) return "";
    const job = st.settings.jobByNumber[r.job_number] ? r.job_number : defaultJob || (st.settings.jobs[0] || {}).job_number || "";
    const noAmount = r.total_cents == null;
    return html`<form class="decide inline" data-doc="${r.id}" style="margin-top:4px">
      ${noAmount ? html`<span class="muted small">No committed amount yet: it counts by itself once an export carries one, or</span>` : html`<label>Job<select name="job_number">${st.settings.jobs.map((j) => html`<option value="${j.job_number}" ${j.job_number === job ? "selected" : ""}>${j.short_name} · ${j.job_number}</option>`)}</select></label><label>Bucket<select name="bucket">${B.ALL.map((b) => html`<option value="${b}" ${b === (r.bucket || "MATERIALS") ? "selected" : ""}>${B.META[b].name}</option>`)}</select></label>`}
      <label>Reason<input name="reason" placeholder="${noAmount ? "why it is left out" : "optional"}" style="min-width:180px"></label>
      ${noAmount ? "" : html`<button name="decision" value="assign" class="primary">Count it</button>`}<button name="decision" value="exclude">Leave it out</button></form>`;
  }
  function purchaseTable(rows, d) {
    const counted = rows.filter((r) => (r.status === "auto" || r.status === "confirmed") && r.order_type !== "Rental");
    return html`<table><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Description</th><th>Type</th><th>Bucket</th><th class="num">Committed</th><th></th></tr>
      ${rows.slice().sort(poSort).map((r) => html`<tr class="${r.status === "needs_decision" ? "held" : ""}"><td class="mono">${r.doc_number}${r.shared_number > 1 ? html` <span class="warn small">on ${r.shared_number} orders</span>` : ""}</td><td class="small">${r.doc_date ? C.fmtDay(r.doc_date) : ""}</td><td>${r.vendor_name_raw || r.vendor_key || ""}</td><td>${r.description || ""}</td><td class="small">${r.order_type || ""}</td><td class="small">${bucketName(r.bucket)}</td><td class="num">${r.total_cents == null ? html`<span class="warn">no amount</span>` : money(r.total_cents)}</td><td>${poStatus(r)}</td></tr>${r.status === "needs_decision" && st.db.canEdit() ? html`<tr><td colspan="8">${decideForm(r, d.job.job_number)}</td></tr>` : ""}`)}
      <tr class="total"><td colspan="6">Counted · ${n1(counted.length, "PO")}</td><td class="num">${money(counted.reduce((a, r) => a + (r.total_cents || 0), 0))}</td><td></td></tr></table>`;
  }
  function recurringCard(d) {
    if (!d.recur.length) return "";
    return html`<div class="card" style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><b>Recurring charges, confirmed</b><span class="muted small">${n1(d.recur.length, "charge")} in force</span></div>
      <table>${d.recur.map((r) => html`<tr><td>${r.vendor_name} <span class="muted small">${r.description}${r.units > 1 ? ` × ${r.units}` : ""}</span>${r.liberty_owned ? html` <span class="pill">Liberty-owned</span>` : ""}</td><td class="num">${money(r.rent_cents)}</td><td class="num muted small">${r.markup_cents ? `+ ${money(r.markup_cents)} markup` : "rent only"}</td><td class="num">${money(r.total_cents)}</td></tr>`)}
      <tr class="total"><td colspan="3">To client</td><td class="num">${money(d.recur.reduce((a, r) => a + r.total_cents, 0))}</td></tr></table></div>`;
  }
  function recurringSection(d) {
    const edit = st.db.canEdit();
    const off = d.candidates.filter((c) => !c.on_feed), on = d.candidates.filter((c) => c.on_feed);
    const seen = (c) => `${c.months_seen} mo, ${C.fmtMonth(ym(c.first_month))} to ${C.fmtMonth(ym(c.last_month))}${c.current ? "" : " (ended)"}`;
    const forms = (c) => html`<form class="confirm inline" data-key="${c.key}" data-job="${c.job_number}" style="margin-top:4px">
      <input type="hidden" name="vendor_code" value="${c.vendor_code || ""}"><input type="hidden" name="vendor_name" value="${c.vendor_name}"><input type="hidden" name="description" value="${c.description}"><input type="hidden" name="cost_code" value="${c.cost_code || ""}"><input type="hidden" name="monthly_cents" value="${c.monthly_cents}"><input type="hidden" name="units" value="${c.units}">
      <label>From<input type="month" name="start_month" value="${ym(c.first_month)}" required></label><label>Until<input type="month" name="end_month" value="${c.current ? "" : ym(c.last_month)}"></label>
      <label><input type="checkbox" name="liberty_owned" ${c.liberty_owned ? "checked" : ""}> Liberty-owned, rent only</label><label><input type="checkbox" name="amount_includes_tax" checked> the amount includes tax</label>
      <button class="primary">Confirm as monthly rental</button></form>
      <form class="dismiss inline" data-key="${c.key}" data-job="${c.job_number}"><label>Not a rental because<input name="reason" required placeholder="a service, a purchase, billed through the PO..." style="min-width:220px"></label><button>Set aside</button></form>`;
    return html`<h2>Recurring charges on the Job Cost To Date</h2>
      <p class="muted small">Charges that come back every month on Liberty's cost ledger: the same vendor, line and amount. The ones no on-rent report covers are the off-feed rentals; confirm one as a monthly rental and it counts under Rentals from the month you say until the month you end it, with the job's markup. A charge from a vendor on a feed is shown against the report, never counted twice.</p>
      ${off.length ? html`<table><tr><th>Vendor</th><th>Line</th><th>Seen</th><th class="num">A month</th><th>Invoices</th></tr>
        ${off.map((c) => html`<tr class="${c.current ? "" : "faint"}"><td>${c.vendor_name}${c.liberty_owned ? html` <span class="pill">Liberty-owned</span>` : ""}</td><td>${c.description}${c.cost_code ? html` <span class="muted small mono">${c.cost_code}</span>` : ""}</td><td class="small">${seen(c)}</td><td class="num">${money(c.monthly_cents)}${c.units > 1 ? html` <span class="muted small">${c.units} × ${money(c.amount_cents)}</span>` : ""}</td><td class="small muted mono">${(c.invoices || []).slice(0, 2).join(", ")}</td></tr>${edit ? html`<tr><td colspan="5">${forms(c)}</td></tr>` : ""}`)}</table>` : html`<p class="muted">No recurring charge off the feeds waits for a decision${d.charges.length || on.length ? "" : "; drop the job's Job Cost To Date on Update to look"}.</p>`}
      ${on.length ? html`<details><summary class="muted small">${n1(on.length, "recurring charge")} from vendors on a feed, ${money(on.filter((c) => c.current).reduce((a, c) => a + c.monthly_cents, 0))} a month invoiced: compare with the reports</summary>
        <table><tr><th>Vendor</th><th>Line</th><th>Seen</th><th class="num">A month</th></tr>${on.map((c) => html`<tr class="${c.current ? "" : "faint"}"><td>${c.vendor_name}</td><td>${c.description}</td><td class="small">${seen(c)}</td><td class="num">${money(c.monthly_cents)}</td></tr>`)}</table>
        ${d.rentals.length ? html`<p class="muted small">The reports this month: ${d.rentals.map((r) => `${vendorName(r.vendor_key)} ${money(r.rent_cents)} rent at run-rate`).join("; ")}.</p>` : ""}</details>` : ""}
      ${d.charges.length ? html`<h3>Confirmed</h3><table><tr><th>Vendor</th><th>Line</th><th class="num">A month</th><th>From</th><th>Until</th>${edit ? html`<th></th>` : ""}</tr>
        ${d.charges.map((r) => html`<tr><td>${r.vendor_name}${r.liberty_owned ? html` <span class="pill">Liberty-owned</span>` : ""}</td><td>${r.description}${r.units > 1 ? ` × ${r.units}` : ""}</td><td class="num">${money(r.monthly_cents)}</td><td class="small">${C.fmtMonth(ym(r.start_month))}</td><td class="small">${r.end_month ? C.fmtMonth(ym(r.end_month)) : "open"}</td>${edit ? html`<td class="nowrap"><form class="endcharge inline" data-id="${r.id}" style="display:inline"><input type="month" name="end_month" value="${r.end_month ? ym(r.end_month) : ""}"><button>Set last month</button></form> <button class="delcharge" data-id="${r.id}">Remove</button></td>` : ""}</tr>`)}</table>` : ""}`;
  }
  const KIND_NAME = { standard: "standard", high_rise: "high-rise", elevator_fit: "elevator-fit", handicap: "handicap", enhanced: "enhanced", womens: "women's" };
  const restroomLine = (r) => `${Object.entries(r.byKind).map(([k, n]) => `${n} ${KIND_NAME[k] || k}`).join(", ") || "none on the reports"}${r.trailers || r.static || r.containers ? `; ${[r.trailers ? n1(r.trailers, "restroom trailer") : "", r.static ? n1(r.static, "static unit") : "", r.containers ? n1(r.containers, "restroom container") : ""].filter(Boolean).join(", ")}${r.stations ? ` (${r.stations} stations)` : ""}` : ""}`;
  const restroomExtras = (r) => [r.sinks ? n1(r.sinks, "sink") : "", r.holding_tanks ? n1(r.holding_tanks, "holding tank") : "", r.waste_water_systems ? n1(r.waste_water_systems, "waste & water system") : "", r.service_per_week ? `serviced up to ${r.service_per_week}x weekly` : ""].filter(Boolean).join(" · ");
  const dumpLine = (x) => x.source === "log" ? `from the log${x.haul_lines ? `, the ledger says ${x.haul_lines}` : ""}` : x.source === "ledger" ? "from the ledger, a pull an invoice" : "bills a lump: log the pulls";
  const pullsOf = (rows) => (rows.some((x) => x.pulls != null) ? rows.reduce((a, x) => a + (x.pulls || 0), 0) : null);
  function siteSection(d, m) {
    const c = d.siteCounts, r = c.restrooms, t = c.trailers, s = c.storage, edit = st.db.canEdit();
    const pullsTotal = pullsOf(d.dump);
    return html`<h2>Site services</h2>
      <p class="muted small">Counted on the month's on-rent reports (restrooms, trailers, containers) and on the haulers' invoices on the ledger or the pull log below (dumpsters). A modular building arrives as sleeves; the front, middles and rear under one contract make one x-plex.</p>
      <div class="cards">
        <div class="card"><h3>Restrooms</h3><p class="big">${r.units}</p><p class="small">${restroomLine(r)}</p><p class="muted small">${restroomExtras(r)}</p></div>
        <div class="card"><h3>Trailers</h3><p class="big">${t.buildings}</p><p class="small">${SS.trailerLabel(t)}</p>
          <p class="muted small">${s.container_units ? `${n1(s.container_units, "storage container")} (${Object.entries(s.containers).map(([k, n]) => `${n} × ${k}`).join(", ")})` : "no storage containers"}${s.trailers ? ` · ${n1(s.trailers, "storage trailer")}` : ""}</p>
          ${t.notes.length ? html`<p class="warn small">${t.notes.join("; ")}</p>` : ""}</div>
        <div class="card"><h3>Dumpsters</h3><p class="big">${pullsTotal == null ? html`<span class="muted">?</span>` : pullsTotal}<span class="muted small"> pulls</span></p>
          ${d.dump.length ? html`<table>${d.dump.map((x) => html`<tr><td>${x.vendor_name}${x.container_yd ? html` <span class="muted small">${x.container_yd} yd</span>` : ""}</td><td class="num">${x.pulls == null ? html`<span class="muted">no count</span>` : html`<b>${x.pulls}</b>`}</td></tr><tr><td colspan="2" class="small muted" style="padding-top:0">${dumpLine(x)}${x.ledger_cents ? ` · ${money(x.ledger_cents)} on the ledger` : ""}</td></tr>`)}</table>` : html`<p class="muted small">No hauler on the ledger or in the log this month.</p>`}
          ${c.dumpsters.units ? html`<p class="muted small">${n1(c.dumpsters.units, "roll-off")} on the rental reports (${Object.entries(c.dumpsters.byYards).map(([k, n]) => `${n} × ${k}`).join(", ")})</p>` : ""}</div>
      </div>
      <h3>Dumpster log · ${C.fmtMonth(m)}</h3>
      ${d.pulls.length ? html`<table><tr><th>Date</th><th>Hauler</th><th class="num">Size</th><th class="num">Pulls</th><th>Ticket</th><th class="num">Tons</th><th class="num">Cost</th><th>Note</th>${edit ? html`<th></th>` : ""}</tr>
        ${d.pulls.map((p) => html`<tr><td class="small">${C.fmtDay(p.pull_date)}</td><td>${p.vendor_name}</td><td class="num">${p.container_yd ? `${p.container_yd} yd` : ""}</td><td class="num">${p.pulls}</td><td class="mono small">${p.ticket_no || ""}</td><td class="num">${p.tonnage || ""}</td><td class="num">${p.cost_cents ? money(p.cost_cents) : ""}</td><td class="small">${p.note || ""}</td>${edit ? html`<td><button class="delpull" data-id="${p.id}">Remove</button></td>` : ""}</tr>`)}</table>` : html`<p class="muted">No pulls logged this month${edit ? "; the field adds them here, one line a pull or a day" : ""}.</p>`}
      ${edit ? html`<form class="addpull inline" data-job="${d.job.job_number}"><label>Date<input type="date" name="pull_date" value="${C.todayIso().slice(0, 7) === m ? C.todayIso() : m + "-01"}" required></label><label>Hauler<input name="vendor_name" required list="haulers" placeholder="Sourgum" style="width:150px"><datalist id="haulers">${(st.settings.wasteVendors || []).map((w) => html`<option value="${w.name || w.pattern}">`)}</datalist></label><label>Size (yd)<input name="container_yd" type="number" min="1" max="100" style="width:60px"></label><label>Pulls<input name="pulls" type="number" min="1" value="1" required style="width:60px"></label><label>Ticket #<input name="ticket_no" style="width:110px"></label><label>Tons<input name="tonnage" type="number" step="0.01" min="0" style="width:70px"></label><label>Cost $<input name="cost" type="number" step="0.01" min="0" style="width:90px"></label><label>Note<input name="note" style="width:160px"></label><button class="primary">Add pull</button></form>` : ""}`;
  }
  async function jobView(n, m) {
    const d = await jobData(n, m);
    const t = d.tile;
    const byCode = {};
    for (const r of d.lines) { const c = byCode[r.cost_code || "(none)"] || (byCode[r.cost_code || "(none)"] = { code: r.cost_code || "(none)", name: r.cost_code_name || "", hours: 0, cost: 0, held: 0 }); c.hours += r.hours_x100; if (r.status === "priced") c.cost += r.cost_cents; else if (r.status !== "excluded") c.held += r.hours_x100; }
    const classRows = pricedClasses(d);
    const heldNow = d.held.filter((h) => h.first_day <= C.monthEnd(m) && h.last_day >= m + "-01");
    const table = d.job.rate_table_code ? st.settings.tables.find((x) => x.code === d.job.rate_table_code) : null;
    const head = jobHead(d.job);
    return html`<div class="row" style="justify-content:space-between"><h1>${head.short} <span class="muted">${head.name ? `${head.name} · ` : ""}${d.job.job_number}</span></h1>${monthNav(m, "#/job/" + n)}
        <span class="row noprint"><a href="#/report/${n}?m=${m}"><button>Report (PDF)</button></a>${st.db.canEdit() ? html`<button id="xlsx">Export .xlsx</button>` : ""}</span></div>
      <p class="muted small">${d.job.campus ? `${d.job.campus}${d.job.region ? ` · ${d.job.region}` : ""} · ` : ""}${d.job.rate_table_code ? `rate table ${d.job.rate_table_code}${table && table.description ? ` (${table.description})` : ""}` : html`<span class="warn">no rate table: its labor is held until one is set in Settings</span>`} · rentals taxed ${pct(d.job.tax_bp == null ? 700 : d.job.tax_bp)}, markup ${pct(d.job.markup_bp == null ? 1000 : d.job.markup_bp)} on ${d.job.markup_base === "rent" ? "rent" : "rent + tax"}</p>
      ${t ? html`<div class="tiles">${tile("labor", "Labor", t.labor_cents, `${hours(t.labor_hours)} hours${t.labor_held_hours ? `, ${hours(t.labor_held_hours)} held` : ""}${t.labor_through ? ` · HH2 through ${C.fmtDay(t.labor_through)}` : ""}`)}
        ${tile("equipment", "Rentals to client", t.rental_cents + (t.offfeed_cents || 0), `${t.rental_lines} on rent${t.rental_as_of ? ` as of ${C.fmtDay(t.rental_as_of)}${t.rental_as_of > C.monthEnd(m) ? " (first report after the month)" : ""}` : ""}${t.rental_no_monthly ? `, ${t.rental_no_monthly} with no monthly figure` : ""}${t.offfeed_lines ? ` · ${n1(t.offfeed_lines, "recurring charge")}` : ""}`)}
        ${t.rental_lo_cents ? tile("lo", "Liberty-owned equipment", t.rental_lo_cents, "rent only") : ""}
        ${tile("materials", "Purchases (material POs)", t.purchase_cents, `${t.purchase_nb_cents ? `non-billable ${money(t.purchase_nb_cents, true)}` : ""}${t.purchase_rental_cents ? `${t.purchase_nb_cents ? " · " : ""}rental POs ${money(t.purchase_rental_cents, true)} apart` : ""}${t.pending_lines ? `${t.purchase_rental_cents || t.purchase_nb_cents ? " · " : ""}${n1(t.pending_lines, "PO")} awaiting a decision` : ""}`)}
        ${tile("total", "Total", t.total_cents)}</div>` : html`<div class="notice">Nothing recorded for ${d.job.short_name} in ${C.fmtMonth(m)}.</div>`}
      <div class="grid2"><div>
        <h2>Labor by class</h2>
        ${classRows.length ? classTable(classRows, "Priced") : html`<p class="muted">No priced labor this month.</p>`}
        ${heldNow.length ? html`<h2>Held, not priced</h2><p class="muted small">Hours that need an answer in Settings before they carry a cost. They price the moment it is given; nothing is re-uploaded.</p>
          <table><tr><th>Why</th><th>What</th><th class="num">Hours</th><th>Days</th></tr>
          ${heldNow.map((h) => html`<tr class="held"><td>${h.status.slice(5)}</td><td>${heldWhat(h)}</td><td class="num">${hours(h.hours)}</td><td class="small">${C.fmtDay(h.first_day)} to ${C.fmtDay(h.last_day)}</td></tr>`)}</table>
          <p class="noprint"><a href="#/settings?tab=${heldTab(heldNow)}">Answer in Settings &rarr;</a></p>` : ""}
      </div><div>
        <h2>Rentals</h2>
        ${d.rentals.length ? d.rentals.map((r) => html`<div class="card" style="margin-bottom:10px"><div class="row" style="justify-content:space-between"><b>${vendorName(r.vendor_key)}</b><span class="muted small">as of ${C.fmtDay(r.as_of)} · ${r.lines} on rent</span></div>
          <table><tr><td>Rent</td><td class="num">${money(r.rent_cents)}</td></tr><tr><td>Tax ${r.taxable ? pct(r.tax_bp) : "(not taxed)"}</td><td class="num">${money(r.tax_cents)}</td></tr><tr><td>Markup ${pct(r.markup_bp)} on ${r.markup_base === "rent_plus_tax" ? "rent + tax" : "rent"}</td><td class="num">${money(r.markup_cents)}</td></tr>
          <tr class="total"><td>To client</td><td class="num">${money(r.total_cents)}</td></tr>${r.liberty_owned_cents ? html`<tr><td>Liberty-owned, rent only</td><td class="num">${money(r.liberty_owned_cents)}</td></tr>` : ""}</table>
          ${r.no_monthly ? html`<p class="warn small">${r.no_monthly} line${r.no_monthly > 1 ? "s" : ""} carr${r.no_monthly > 1 ? "y" : "ies"} only a day or week rate and ${r.no_monthly > 1 ? "are" : "is"} not in the month.</p>` : ""}
          <p class="noprint"><a href="#/statement/${n}?m=${m}&v=${r.vendor_key}">Statement for the client &rarr;</a></p></div>`) : html`<p class="muted">No on-rent report covers this month.</p>`}
        ${recurringCard(d)}
      </div></div>
      ${recurringSection(d)}
      ${siteSection(d, m)}
      <h2>Purchases (material POs)</h2>
      ${d.purchases.length ? html`<p class="muted small">Purchase Pro's committed amount per PO, by order date, from the latest export. Material POs count; a rental PO is a commitment to a rental vendor and is shown apart (the rental itself is on a feed or a recurring charge). Quotes and cancelled POs are listed and not counted.</p>${purchaseTable(d.purchases, d)}` : html`<p class="muted">No POs dated this month in the latest Purchase Pro export.</p>`}
      ${d.lines.length ? html`<h2>Labor by cost code</h2><table><tr><th>Cost code</th><th>Name</th><th class="num">Hours</th><th class="num">Cost</th><th class="num">Held hours</th></tr>
        ${Object.values(byCode).sort((a, b) => (a.code < b.code ? -1 : 1)).map((c) => html`<tr><td class="mono">${c.code}</td><td>${c.name}</td><td class="num">${C.fmtHours(c.hours)}</td><td class="num">${money(c.cost)}</td><td class="num ${c.held ? "warn" : ""}">${c.held ? C.fmtHours(c.held) : ""}</td></tr>`)}</table>` : ""}`;
  }
  async function exportBuckets(m) {
    const rows = (await st.db.view("v_month_buckets", { month: m + "-01" })).filter((r) => r.cents).sort((a, b) => (a.job_number + a.bucket < b.job_number + b.bucket ? -1 : 1));
    if (!rows.length) return toast(`Nothing recorded for ${C.fmtMonth(m)}.`);
    E.download(E.monthBuckets(rows.map((r) => Object.assign({}, r, { month: ym(r.month) }))), E.fileSafe(`GR Cost ${m} buckets.xlsx`));
  }
  async function exportJob(n, m) {
    const d = await jobData(n, m);
    const summary = L.summarize(d.lines);
    const purchases = d.purchases.map((p) => ({ vendor: p.vendor_name_raw || p.vendor_key || "", doc_number: p.doc_number, doc_date: p.doc_date, description: p.description, cost_code: p.cost_code, bucket: p.bucket, amount_cents: p.total_cents || 0, status: p.status }));
    const wb = E.jobMonth({ job: d.job, month: m, labor: { summary, rows: d.lines }, rentals: statementsFor(d), purchases, recurring: d.recur,
      site: { counts: d.siteCounts, trailerLabel: SS.trailerLabel(d.siteCounts.trailers), restroomLine: restroomLine(d.siteCounts.restrooms), dump: d.dump, pulls: d.pulls } });
    E.download(wb, E.fileSafe(`${d.job.short_name} ${m} cost.xlsx`));
  }

  // ---- Weekly cost review (the Liberty dashboard) ---------------------------------------------------
  function reviewTab(q) {
    if (q.tab === "rental") return "rental";
    if (q.tab === "po" || q.tab === "committed") return "po";
    return "labor";
  }
  /** A c or j on #/review is the same isolation the portfolio uses. */
  function applyReviewQuery(rev, q) {
    const code = PM.canonicalCampus((q.c || "").trim());
    const jobNo = (q.j || "").trim();
    const job = jobNo && st.settings.jobByNumber[jobNo];
    const jobOk = job && job.active !== false;
    if (jobOk) {
      rev.projects = [job.job_number];
      const jobCode = PM.canonicalCampus(job.campus);
      rev.campuses = jobCode ? [jobCode] : null;
    } else if (code) {
      rev.campuses = [code];
      rev.projects = null;
    } else {
      rev.campuses = null;
      rev.projects = null;
    }
  }
  async function buildReview(opts) {
    const o = opts || {};
    const tab = o.tab || "labor";
    const db = st.db;
    const showNames = db.canEdit();
    const [laborRows, items, pos, fresh] = await Promise.all([
      db.view("v_labor_priced").catch(() => []),
      db.view("v_rental_items").catch(() => []),
      db.view("v_purchase_docs").catch(() => []),
      db.view("v_freshness").catch(() => [])]);
    const names = Object.fromEntries((st.settings.employees || []).map((e) => [e.employee_number, e.name]));
    const vendors = st.settings.vendorByKey || {};
    const ids = new Set(o.projects || []);
    const keep = (row) => !ids.size || ids.has(row.job_number);
    const labor = laborRows.filter((r) => r.status === "priced" && keep(r)).map((r) => ({
      week_ending: r.week_ending || L.weekEnding(r.work_date), job_number: r.job_number,
      employee: showNames ? (names[r.employee_number] || r.employee_number) : null,
      employee_key: r.employee_number, certified_class: r.certified_class,
      cost_code: r.cost_code, cost_code_name: r.cost_code_name, pay_type: r.pay_type, pay_type_name: r.pay_type_name,
      hours: r.hours != null ? +r.hours : (r.hours_x100 || 0) / 100, cost_cents: r.cost_cents || 0,
    }));
    const rentals = items.filter((i) => !i.off_rent_date && keep(i)).map((i) => ({
      job_number: i.job_number, vendor_key: i.vendor_key,
      vendor_name: (vendors[i.vendor_key] && vendors[i.vendor_key].name) || i.vendor_key,
      description: i.description || "(no description)",
      category: (i.raw && (i.raw.cat_class || i.raw.code1_label)) || "Equipment",
      qty: +i.qty || 0, monthly_rent_cents: i.monthly_rent_cents, liberty_owned: !!i.liberty_owned,
    }));
    const purchases = pos.filter(keep).map((p) => ({
      doc_date: p.doc_date, doc_number: p.doc_number, job_number: p.job_number,
      supplier: p.vendor_name_raw || p.vendor_key || "", committed_cents: p.total_cents,
      cancelled: p.cancelled, quote: p.quote, status: p.status, order_type: p.order_type,
    }));
    const rev = reviewState();
    const f = fresh[0] || {};
    const onDates = Object.values(f.onrent_as_of || {}).filter(Boolean).sort();
    const model = Rev.build({
      jobs: o.jobs || [],
      labor, rentals, purchases, rentalSettings: st.settings.rental,
      week: o.week || null, campuses: o.campuses === undefined ? null : o.campuses, projects: o.projects === undefined ? null : o.projects, tab, sort: (o.sort || rev.sort), showNames,
      today: C.todayIso(), updated: f.hh2_through || f.po_as_of || null,
      onrentAsOf: onDates.length ? onDates[onDates.length - 1] : null,
    });
    rev.week = model.week;
    return Rev.html(model);
  }
  async function reviewPage() {
    const dest = Pages.reviewRedirect(st.route, st.review);
    if (location.hash !== dest) location.hash = dest;
    return "";
  }
  function wireReview() {
    const box = $(".gr-dash") || $(".wcr");
    if (!box) return;
    const rev = reviewState();
    const tab = reviewTab(st.route.q);
    const onProject = st.route.page === "p" && st.route.parts[1];
    const projectJob = onProject ? decodeURIComponent(st.route.parts[1]) : "";
    const goProject = (job, week) => {
      location.hash = Pages.projectHref(job, monthQ(st.route.q), { tab, w: week || "" });
    };
    const week = $("#selWeek") || $("#wcr-week");
    if (week) week.addEventListener("change", () => {
      rev.week = week.value;
      if (onProject) goProject(projectJob, week.value);
      else location.hash = `#/review?tab=${tab}&w=${encodeURIComponent(week.value)}`;
    });
    $$("th[data-sort]", box).forEach((th) => th.addEventListener("click", () => {
      const [which, key] = th.dataset.sort.split(":");
      const cur = rev.sort[which] || {};
      rev.sort[which] = { key, dir: cur.key === key && cur.dir === "asc" ? "desc" : "asc" };
      render();
    }));
    $$(".dd-btn", box).forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const dd = b.closest(".dd");
      if (!dd) return;
      const open = dd.classList.contains("open");
      $$(".dd.open").forEach((d) => d.classList.remove("open"));
      if (!open) dd.classList.add("open");
    }));
    if (!st.reviewDoc) {
      st.reviewDoc = true;
      document.addEventListener("click", () => $$(".dd.open").forEach((d) => d.classList.remove("open")));
    }
    const read = (sel) => $$(sel, box).filter((x) => x.checked).map((x) => x.value);
    const stay = () => render();
    $$("[data-campus]", box).forEach((el) => el.addEventListener("change", () => {
      const all = $$("[data-campus]", box);
      const checked = read("[data-campus]");
      rev.campuses = checked.length === all.length ? null : checked;
      rev.projects = null;
      stay();
    }));
    const campusAll = $("[data-campus-all]", box);
    if (campusAll) campusAll.addEventListener("change", () => { rev.campuses = campusAll.checked ? null : []; rev.projects = null; stay(); });
    $$("[data-only-campus]", box).forEach((b) => b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); rev.campuses = [b.dataset.onlyCampus]; rev.projects = null; stay(); }));
    $$("[data-project]", box).forEach((el) => el.addEventListener("change", () => {
      const all = $$("[data-project]", box);
      const checked = read("[data-project]");
      rev.projects = checked.length === all.length ? null : checked;
      stay();
    }));
    const projectAll = $("[data-project-all]", box);
    if (projectAll) projectAll.addEventListener("change", () => { rev.projects = projectAll.checked ? null : []; stay(); });
    $$("[data-only-project]", box).forEach((b) => b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); rev.projects = [b.dataset.onlyProject]; stay(); }));
    const clear = $("#btnClear");
    if (clear) clear.addEventListener("click", () => {
      rev.campuses = null; rev.projects = null; rev.week = null;
      const next = `#/review?tab=${tab}`;
      if (location.hash === next) render(); else location.hash = next;
    });
        const print = $("#btnPrint") || $("#wcr-print");
    if (print) print.addEventListener("click", () => window.print());
  }

  // ---- Report (print -> Save as PDF) and Statement ---------------------------------------------------
  const printBar = () => html`<div class="row noprint" style="justify-content:space-between;margin-bottom:12px"><a href="javascript:history.back()">&larr; Back</a><span class="muted small">Print this page and choose <b>Save as PDF</b>.</span><button class="primary" id="print">Print / Save as PDF</button></div>`;
  async function reportView(which, m) {
    const jobs = which === "all" ? st.settings.jobs.filter((j) => j.active !== false) : [st.settings.jobByNumber[which] || { job_number: which, short_name: which }];
    const sections = [];
    for (const j of jobs) {
      const d = await jobData(j.job_number, m);
      if (!d.tile && which === "all") continue;
      sections.push(reportSection(d));
    }
    return html`${printBar()}<h1>${which === "all" ? "All jobs" : jobs[0].short_name} · ${C.fmtMonth(m)}</h1><p class="muted small">Cost for the month: labor from HH2 time at the Sage rate tables, rentals from the vendors' on-rent reports, purchases from Purchase Pro's committed POs. Prepared ${C.fmtDay(C.todayIso())} by GR Cost.</p>
      ${sections.length ? sections : html`<p class="muted">Nothing recorded for ${C.fmtMonth(m)}.</p>`}`;
  }
  function reportSection(d) {
    const t = d.tile || { labor_cents: 0, labor_hours: 0, labor_held_hours: 0, rental_cents: 0, rental_lo_cents: 0, rental_lines: 0, offfeed_cents: 0, offfeed_lines: 0, purchase_cents: 0, pending_lines: 0, total_cents: 0 };
    const classRows = pricedClasses(d);
    const heldRows = d.classes.filter((r) => String(r.status || "").startsWith("held:")).sort(classSort);
    const stmts = statementsFor(d);
    const counted = d.purchases.filter((p) => (p.status === "auto" || p.status === "confirmed") && p.order_type !== "Rental");
    const pending = d.purchases.filter((p) => p.status === "needs_decision");
    const head = jobHead(d.job);
    const unpriced = !t.labor_cents && t.labor_held_hours;
    return html`<section style="break-inside:avoid-page;margin-bottom:28px"><h2 style="font-size:16px;color:inherit;text-transform:none;letter-spacing:0">${head.short} <span class="muted">${head.name ? `${head.name} · ` : ""}${d.job.job_number}${d.job.campus ? ` · ${d.job.campus}` : ""}</span></h2>
      ${unpriced ? html`<p class="warn small">${!d.job.rate_table_code ? "No rate table is assigned, so this labor has no cost. Assign one in Settings and these hours price without another upload." : "These hours have no matching rate, so the labor cost is $0 until Settings has the class and pay ID."}</p>` : ""}
      <div class="tiles">${tile("labor", "Labor", t.labor_cents, `${hours(t.labor_hours)} hours${t.labor_held_hours ? `, ${hours(t.labor_held_hours)} held` : ""}`)}${tile("equipment", "Rentals to client", t.rental_cents + (t.offfeed_cents || 0), `${t.rental_lines} on rent${t.offfeed_lines ? `, ${t.offfeed_lines} recurring` : ""}`)}${t.rental_lo_cents ? tile("lo", "Liberty-owned", t.rental_lo_cents, "rent only") : ""}${tile("materials", "Purchases (material POs)", t.purchase_cents, t.pending_lines ? `${n1(t.pending_lines, "PO")} awaiting a decision` : "")}${tile("total", "Total", t.total_cents)}</div>
      ${classRows.length ? classTable(classRows, "Labor") : ""}
      ${heldRows.length ? heldClassTable(heldRows) : ""}
      ${stmts.map((s) => statementTable(s, d))}
      ${d.recur.length ? html`<h3>Recurring rentals · confirmed from the Job Cost To Date</h3><table><tr><th>Vendor</th><th>Line</th><th class="num">A month</th><th class="num">Markup</th><th class="num">Total</th></tr>
        ${d.recur.map((r) => html`<tr><td>${r.vendor_name}${r.liberty_owned ? html` <span class="pill">Liberty-owned</span>` : ""}</td><td>${r.description}${r.units > 1 ? ` × ${r.units}` : ""}</td><td class="num">${money(r.rent_cents)}</td><td class="num">${money(r.markup_cents)}</td><td class="num">${money(r.total_cents)}</td></tr>`)}
        <tr class="total"><td colspan="4">Recurring rentals</td><td class="num">${money(d.recur.reduce((a, r) => a + r.total_cents, 0))}</td></tr></table>` : ""}
      ${d.siteCounts.restrooms.units || d.siteCounts.trailers.buildings || d.dump.length ? html`<h3>Site services</h3><table><tr><th>Restrooms</th><th>Trailers</th><th>Storage</th><th>Dumpsters</th></tr>
        <tr><td>${d.siteCounts.restrooms.units} units: ${restroomLine(d.siteCounts.restrooms)}${restroomExtras(d.siteCounts.restrooms) ? `; ${restroomExtras(d.siteCounts.restrooms)}` : ""}</td><td>${SS.trailerLabel(d.siteCounts.trailers)}</td><td>${d.siteCounts.storage.container_units ? n1(d.siteCounts.storage.container_units, "container") : "none"}</td><td>${d.dump.map((x) => `${x.vendor_name}: ${x.pulls == null ? "spend only" : n1(x.pulls, "pull")} (${x.source})`).join("; ") || "none"}</td></tr></table>` : ""}
      ${counted.length ? html`<h3>Purchase orders · ${n1(counted.length, "PO")}</h3><table><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Description</th><th>Type</th><th class="num">Committed</th></tr>
        ${counted.slice().sort((a, b) => (a.doc_date + a.doc_number < b.doc_date + b.doc_number ? -1 : 1)).map((r) => html`<tr><td class="mono">${r.doc_number}</td><td class="small">${r.doc_date ? C.fmtDay(r.doc_date) : ""}</td><td>${r.vendor_name_raw || r.vendor_key || ""}</td><td>${r.description || ""}</td><td class="small">${r.order_type || ""}</td><td class="num">${money(r.total_cents)}</td></tr>`)}
        <tr class="total"><td colspan="5">Purchases</td><td class="num">${money(counted.reduce((a, r) => a + (r.total_cents || 0), 0))}</td></tr></table>` : ""}
      ${pending.length ? html`<h3>Purchase orders awaiting a decision · ${n1(pending.length, "PO")}</h3><p class="muted small">Left out of the total until each one is counted or left out in Settings.</p><table><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Description</th><th class="num">Committed</th></tr>
        ${pending.slice().sort(poSort).map((r) => html`<tr class="held"><td class="mono">${r.doc_number}</td><td class="small">${r.doc_date ? C.fmtDay(r.doc_date) : ""}</td><td>${r.vendor_name_raw || r.vendor_key || ""}</td><td>${r.description || ""}</td><td class="num">${r.total_cents == null ? html`<span class="warn">no amount</span>` : money(r.total_cents)}</td></tr>`)}</table>` : ""}</section>`;
  }
  function statementTable(s, d) {
    return html`<h3>${vendorName(s.vendor_key)} · on rent as of ${C.fmtDay(s.as_of)}</h3>
      <table><tr><th>Equipment #</th><th>Description</th><th class="num">Qty</th><th>On rent since</th><th class="num">Monthly rent</th><th class="num">Tax</th><th class="num">Markup</th><th class="num">Total</th></tr>
      ${s.rows.map((r) => html`<tr><td class="mono">${r.equipment_no}</td><td>${r.description}${r.liberty_owned ? html` <span class="pill">Liberty-owned</span>` : ""}</td><td class="num">${r.qty_unknown ? html`<span class="muted" title="quantity not in this export">?</span>` : r.qty}</td><td>${r.on_rent_date ? C.fmtDay(r.on_rent_date) : ""}</td><td class="num">${r.monthly_rent_cents == null ? html`<span class="muted">${r.rate_period || ""} ${money(r.rate_cents)}</span>` : money(r.monthly_rent_cents)}</td><td class="num">${money(r.tax_cents)}</td><td class="num">${money(r.markup_cents)}</td><td class="num">${money(r.total_cents)}</td></tr>`)}
      <tr class="total"><td colspan="4">Total · rent${s.settings.taxable ? ` + ${pct(s.settings.tax_bp)} tax` : ""} + ${pct(s.settings.markup_bp)} markup</td><td class="num">${money(s.total.rent + s.total.liberty_owned)}</td><td class="num">${money(s.total.tax)}</td><td class="num">${money(s.total.markup)}</td><td class="num">${money(s.total.total)}</td></tr></table>
      ${s.offRent.length ? html`<p class="muted small">Off rent since the previous report: ${s.offRent.map((l) => `${l.equipment_no} ${l.description} (${C.fmtDay(l.off_rent_date)})`).join("; ")}</p>` : ""}
      ${s.noMonthly ? html`<p class="muted small">${s.noMonthly} line${s.noMonthly > 1 ? "s" : ""} carr${s.noMonthly > 1 ? "y" : "ies"} only a day or week rate; shown, not totalled.</p>` : ""}`;
  }
  async function statementView(n, m, vendor_key) {
    const d = await jobData(n, m);
    const s = statementsFor(d).find((x) => x.vendor_key === vendor_key);
    if (!s) return html`${printBar()}<p class="muted">No ${vendorName(vendor_key)} report covers ${C.fmtMonth(m)} for ${d.job.short_name}${st.db.canEdit() ? "" : ", or the statement's lines are for editors"}.</p>`;
    const head = jobHead(d.job);
    return html`${printBar()}<h1>${head.short} · Equipment on rent · ${C.fmtMonth(m)}</h1><p class="muted small">${head.name ? `${head.name} · ` : ""}${d.job.job_number} · prepared ${C.fmtDay(C.todayIso())}</p>${statementTable(s, d)}`;
  }

  // ---- Update ---------------------------------------------------------------------------------------------
  function updateView() {
    return html`<h1>Update</h1><p class="muted">Drop the HH2 Labor Detail export, the vendors' on-rent reports (United Rentals, Sunbelt, Herc, EquipmentShare, or the page's own CSV), the Purchase Pro PO export, each job's Job Cost To Date, a Sage rate table export or a Liberty billable rate sheet (xlsx or the billable PDF), or the Projects register. A zip or a folder is fine; each file is read by what is in it, not its name. Nothing is saved until you press Record.</p>
      <div class="drop" id="drop"><div><b>Drop files here</b>, or <label><button type="button" id="pick">choose files</button><input id="files" type="file" multiple></label> or <label><button type="button" id="pickdir">a folder</button><input id="dir" type="file" webkitdirectory multiple></label></div></div>
      <div id="cards">${cardsView()}</div>`;
  }
  function cardsView() {
    const cards = Intake.sortCards(st.cards);
    const ready = cards.filter((c) => c.status === "ready");
    return html`${cards.length ? html`<div class="row noprint" style="justify-content:space-between"><span class="muted">${n1(cards.length, "file")} · ${ready.length} ready</span>
      <span class="row">${st.recording ? html`<span class="muted">Recording…</span>` : html`<button id="clear">Clear</button><button class="primary" id="record" ${ready.length ? "" : "disabled"}>Record ${ready.length ? ready.length : ""}</button>`}</span></div>` : ""}
      <div class="cards" style="grid-template-columns:1fr">${cards.map((c) => cardView(c, st.cards.indexOf(c)))}</div>`;
  }
  function cardView(c, i) {
    const stamp = c.status === "ready" ? html`<span class="stamp">${c.stamp}</span>` : c.status === "recorded" ? html`<span class="stamp" style="border-color:var(--accent);color:var(--accent)">recorded</span>`
      : c.status === "needs-decision" ? html`<span class="stamp warn">needs a decision</span>` : c.status === "refused" ? html`<span class="stamp bad">refused</span>` : c.status === "already-on-file" ? html`<span class="stamp faint">already on file</span>` : html`<span class="stamp faint">${c.status}</span>`;
    return html`<div class="card filecard ${c.status}" data-i="${i}"><div class="row" style="justify-content:space-between"><div><b>${c.title || c.name}</b><div class="muted small mono">${c.fileName}${c.size ? ` · ${Math.round(c.size / 1024)} KB` : ""}</div></div>${stamp}</div>
      ${c.reason ? html`<p class="${c.status === "refused" ? "bad" : c.status === "recorded" ? "ok" : "warn"}" style="margin:8px 0 0">${c.reason}</p>` : ""}
      ${c.need === "as_of" ? html`<form class="inline asof" data-i="${i}" style="margin-top:8px"><label>As of<input type="date" name="as_of" value="${C.todayIso()}" required></label><button>Read with this date</button></form>` : ""}
      ${c.need === "supersede" ? html`<form class="inline supersede" data-i="${i}" style="margin-top:8px"><label>Why does this file replace ${c.overlaps.map((o) => o.file_name).join(", ")}?<input name="reason" required placeholder="re-pulled after a timecard correction" style="min-width:320px"></label><button>Record as the replacement</button></form>` : ""}
      ${c.notes && c.notes.length ? html`<ul>${c.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ""}
      ${c.progress != null && c.progress < 1 ? html`<div class="progress"><div style="width:${Math.round(c.progress * 100)}%"></div></div>` : ""}</div>`;
  }
  async function addFiles(files) {
    const list = [];
    for (const f of files) list.push({ name: f.webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    st.ctx = intakeCtx();
    const cards = await Intake.inspectAll(list, st.ctx);
    const have = new Set(st.cards.map((c) => c.sha256).filter(Boolean));
    for (const c of cards) if (!(c.sha256 && have.has(c.sha256))) st.cards.push(c);
    refreshCards();
  }
  const refreshCards = () => { mount($("#cards"), cardsView()); wireCards(); };
  async function refreshTop() { const h = $("header.top"); if (!h) return; const t = document.createElement("template"); t.innerHTML = (await topView()).s; h.replaceWith(t.content.firstElementChild); }
  async function reread(i, asOf) {
    const c = st.cards[i];
    st.asOf = Object.assign({}, st.asOf, { [c.fileName]: asOf });
    const n = await Intake.inspect(c.bytes, c.fileName, intakeCtx());
    st.cards[i] = n; refreshCards();
  }
  /** what Record did, in a line on the card */
  function recordedNote(c, r) {
    const k = c.doc && c.doc.kind;
    if (k === "sage_rates") {
      const u = r.upload || {}, num = (f) => (r[f] != null ? r[f] : u[f]), a = r.assigned || u.assigned || [];
      const billed = Object.entries(c.matched || {}).flatMap(([code, jobs]) => jobs.map((j) => `${jobName(j)} ${code}`));
      return `${num("inserted") != null ? `${num("inserted")} rates added, ${num("retired") || 0} retired, ${num("skipped") || 0} already there. ` : ""}${a.length ? `Newly assigned: ${a.map((x) => `${jobName(x.job_number)} ${x.rate_table_code}`).join(", ")}. ` : ""}${billed.length ? `Jobs billed from these tables: ${billed.join(", ")}.` : "No job in Settings carries these table numbers; set them on the Jobs tab."}`;
    }
    if (k === "projects") return r.added ? `${n1(r.added, "job")} added; campus and region filled in where blank.` : "Every job was already on file; campus and region filled in where blank.";
    if (k === "purchase_orders") return `This export now stands for every PO; the month's purchases come from it.`;
    if (k === "jctd") { const n = r.candidates || 0, sm = c.candidates ? c.candidates.filter((x) => !x.on_feed).length : 0; return n ? `${n1(n, "recurring charge")} found${sm ? `, ${sm} off the feeds: confirm them as monthly rentals on the job page` : ", all from vendors on a feed"}.` : "No recurring charge found on it."; }
    if (k === "hh2_labor") return "";
    return "";
  }
  async function recordAll() {
    st.recording = true; refreshCards();
    // the register first (it adds jobs), then rate tables (they attach to jobs), then the feeds that price against both
    const order = { projects: 0, sage_rates: 1 };
    const queue = st.cards.filter((c) => c.status === "ready").sort((a, b) => ((order[a.doc && a.doc.kind] != null ? order[a.doc.kind] : 2) - (order[b.doc && b.doc.kind] != null ? order[b.doc.kind] : 2)));
    for (const c of queue) {
      try {
        const r = await st.db.record(c, { supersede: c.supersede || null, onProgress: (p) => { c.progress = p; const el = $(`.filecard[data-i="${st.cards.indexOf(c)}"] .progress > div`); if (el) el.style.width = Math.round(p * 100) + "%"; } });
        if (r.status === "recorded") { c.status = "recorded"; c.result = r; c.reason = recordedNote(c, r); c.need = null; }
        else if (r.status === "existing") { c.status = "already-on-file"; c.reason = `already on file${r.existing.recorded_by_name ? `, recorded by ${r.existing.recorded_by_name}` : ""}`; }
        else if (r.status === "needs-supersede") { c.status = "needs-decision"; c.need = "supersede"; c.overlaps = r.overlaps; c.reason = `the week ${C.fmtDay(c.doc.range.start)} to ${C.fmtDay(c.doc.range.end)} is already on file for the same people (${r.overlaps.map((o) => o.file_name).join(", ")}). Record this as its replacement, with a reason, or leave it.`; }
      } catch (e) { c.status = "refused"; c.reason = e.message || String(e); }
    }
    st.recording = false; st.settings = await loadSettings();
    for (const c of queue) if (c.status === "recorded" && c.result) c.reason = recordedNote(c, c.result); // job names the drop itself added
    refreshCards(); await refreshTop(); toast("Recorded. The Portfolio and job pages show it now.");
  }
  function wireCards() {
    const rec = $("#record"); if (rec) rec.addEventListener("click", recordAll);
    const clr = $("#clear"); if (clr) clr.addEventListener("click", () => { st.cards = []; refreshCards(); });
    $$("form.asof").forEach((f) => f.addEventListener("submit", (ev) => { ev.preventDefault(); reread(+f.dataset.i, f.as_of.value); }));
    $$("form.supersede").forEach((f) => f.addEventListener("submit", async (ev) => { ev.preventDefault(); const c = st.cards[+f.dataset.i]; c.supersede = { reason: f.reason.value.trim() }; c.status = "ready"; c.need = null; c.reason = ""; refreshCards(); await recordAll(); }));
  }
  function wireUpdate() {
    const drop = $("#drop"); if (!drop) return;
    drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", async (ev) => { ev.preventDefault(); drop.classList.remove("over"); addFiles(await filesFromDrop(ev.dataTransfer)); });
    $("#pick").addEventListener("click", () => $("#files").click()); $("#pickdir").addEventListener("click", () => $("#dir").click());
    $("#files").addEventListener("change", (ev) => addFiles(Array.from(ev.target.files)));
    $("#dir").addEventListener("change", (ev) => addFiles(Array.from(ev.target.files)));
    wireCards();
  }
  async function filesFromDrop(dt) {
    const out = [];
    const walk = async (entry, prefix) => {
      if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); Object.defineProperty(f, "webkitRelativePath", { value: prefix + f.name }); out.push(f); }
      else if (entry.isDirectory) { const reader = entry.createReader(); let batch; do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const e of batch) await walk(e, prefix + entry.name + "/"); } while (batch.length); }
    };
    const items = Array.from(dt.items || []);
    if (items.length && items[0].webkitGetAsEntry) { for (const it of items) { const e = it.webkitGetAsEntry(); if (e) await walk(e, ""); } return out; }
    return Array.from(dt.files);
  }

  // ---- Settings ----------------------------------------------------------------------------------------------
  const classOptions = (selected) => html`<option value="" ${selected ? "" : "selected"}>(by prefix)</option>${L.KNOWN_CLASSES.map((c) => html`<option value="${c}" ${c === selected ? "selected" : ""}>${classLabel(c)}</option>`)}`;
  async function settingsView(tab) {
    const S = st.settings, edit = st.db.canEdit();
    const tabs = [["jobs", "Jobs"], ["vendors", "Vendors"], ["jobmap", "Vendor job names"], ["rates", "Rate tables"], ["employees", "Employees"], ["paytypes", "Pay types"], ["purchases", "Purchases"], ["recurring", "Recurring"], ["waste", "Haulers"], ["members", "People"], ["files", "Files"]];
    let body;
    if (tab === "jobs") {
      const held = edit ? await st.db.view("v_labor_held", { status: "held:unknown job" }) : [];
      const unknown = {}; for (const h of held) { const u = unknown[h.job_number] || (unknown[h.job_number] = { job_number: h.job_number, job_name: h.job_name, hours: 0 }); u.hours += h.hours; }
      const JS = root.JobsSettings;
      if (!JS) throw new Error("jobs_settings.js did not load");
      body = html`${raw(JS.render({ jobs: S.jobs, tables: S.tables, edit, selected: st.route.q.job || "" }))}
        ${Object.keys(unknown).length ? html`<div class="notice"><b>${n1(Object.keys(unknown).length, "job")} in the HH2 exports ${Object.keys(unknown).length > 1 ? "are" : "is"} not set up</b>, so their hours are held. Add the ones that are yours; leave the rest.
          <table>${Object.values(unknown).sort((a, b) => b.hours - a.hours).map((u) => html`<tr><td class="mono">${u.job_number}</td><td>${u.job_name || ""}</td><td class="num">${hours(u.hours)} h</td><td><button class="addjob" data-job="${u.job_number}" data-name="${u.job_name || ""}">Add</button></td></tr>`)}</table></div>` : ""}`;
    } else if (tab === "vendors") {
      body = html`<p class="muted small">Rental vendors. Tax and markup are the job's (its site); here is only whether a vendor's rentals are taxed at all, and whether its lines are Liberty-owned equipment (rent only, no markup).</p>
        <table><tr><th>Vendor</th><th>Key</th><th>Taxed</th><th>Liberty-owned</th><th>Layout</th>${edit ? html`<th></th>` : ""}</tr>
        ${S.vendors.map((v) => { const lay = V.LAYOUTS.find((l) => l.vendor_key === v.vendor_key); return html`<tr><form class="vendor" data-key="${v.vendor_key}"><td>${v.name}</td><td class="mono">${v.vendor_key}</td>
          <td>${edit ? html`<select name="taxable"><option value="true" ${v.taxable ? "selected" : ""}>yes</option><option value="false" ${v.taxable ? "" : "selected"}>no</option></select>` : (v.taxable ? "yes" : "no")}</td>
          <td>${edit ? html`<select name="liberty_owned"><option value="false" ${v.liberty_owned ? "" : "selected"}>no</option><option value="true" ${v.liberty_owned ? "selected" : ""}>yes</option></select>` : (v.liberty_owned ? "yes" : "")}</td>
          <td class="small muted">${lay ? (lay.confirmed ? "reads" : "awaiting a real export") : "page's own CSV"}</td>${edit ? html`<td><button>Save</button></td>` : ""}</form></tr>`; })}</table>
        <p class="muted small">Layouts this page reads: ${V.confirmed().map((l) => l.name).join("; ")}. Awaiting a real export: ${V.awaiting().map((l) => l.name).join("; ") || "none"}.</p>`;
    } else if (tab === "jobmap") {
      const items = edit ? await st.db.view("v_rental_items") : [];
      const refs = {};
      for (const i of items) { const k = i.vendor_key + "|" + i.vendor_job_ref; const r = refs[k] || (refs[k] = { vendor_key: i.vendor_key, ref: i.vendor_job_ref, items: 0, on: 0, job: (S.jobMap[i.vendor_key] || {})[i.vendor_job_ref] || "" }); r.items++; if (!i.off_rent_date) r.on++; }
      const list = Object.values(refs).sort((a, b) => (a.job ? 1 : 0) - (b.job ? 1 : 0) || b.on - a.on);
      body = html`<p class="muted small">Each vendor names a site its own way ("CDR-SCCI-DC4", "QTS DC4", "DC BUILDING 201"). Say which job each one is; every line already recorded moves with it. Names left blank stay under "other jobs" and are never counted against a job.</p>
        ${list.length ? html`<table><tr><th>Vendor</th><th>The vendor's name for it</th><th class="num">On rent</th><th>Job</th></tr>
          ${list.map((r) => html`<tr><td>${vendorName(r.vendor_key)}</td><td>${r.ref}</td><td class="num">${r.on} <span class="muted">of ${r.items}</span></td><td><select class="mapjob" data-vendor="${r.vendor_key}" data-ref="${r.ref}"><option value="">(other jobs)</option>${S.jobs.map((j) => html`<option value="${j.job_number}" ${j.job_number === r.job ? "selected" : ""}>${j.short_name} · ${j.job_number}</option>`)}</select></td></tr>`)}</table>` : html`<p class="muted">${edit ? "No on-rent reports recorded yet." : "Editors match the vendors' names to jobs."}</p>`}`;
    } else if (tab === "rates") {
      const held = edit ? await st.db.view("v_labor_held") : [];
      const missing = {}; for (const h of held.filter((h) => h.status === "held:no rate")) { const k = [h.rate_table_code, h.certified_class, h.pay_id].join("|"); const u = missing[k] || (missing[k] = { rate_table_code: h.rate_table_code, certified_class: h.certified_class, pay_id: h.pay_id, hours: 0, first: h.first_day, jobs: new Set() }); u.hours += h.hours; u.jobs.add(h.job_number); if (h.first_day < u.first) u.first = h.first_day; }
      const noTable = {}; for (const h of held.filter((h) => h.status === "held:no rate table")) { const u = noTable[h.job_number] || (noTable[h.job_number] = { job_number: h.job_number, hours: 0 }); u.hours += h.hours; }
      const want = S.tables.find((t) => t.code === st.route.q.table) ? st.route.q.table : (S.tables[0] ? S.tables[0].code : "");
      const rates = S.rates.filter((r) => r.rate_table_code === want).sort((a, b) => (a.certified_class + a.pay_id + (a.effective_from || "") < b.certified_class + b.pay_id + (b.effective_from || "") ? -1 : 1));
      const jobsOn = (code) => S.jobs.filter((j) => j.rate_table_code === code).map((j) => j.short_name);
      body = html`<p class="muted small">Sage's rate tables, one per job or site, shared by the jobs billed from them. The key is exact: table, certified class and pay ID as HH2 writes it (UNION REG and REG are two keys). Drop a Sage rate table export on Update to load or refresh a table; a rate is never changed here, retire it and add the new one.</p>
        ${Object.keys(noTable).length ? html`<div class="notice"><b>${n1(Object.keys(noTable).length, "job has", "jobs have")} no rate table</b>, so their labor is held: ${Object.values(noTable).sort((a, b) => b.hours - a.hours).map((u) => `${jobName(u.job_number)} (${hours(u.hours)} h)`).join(", ")}. Set it on the <a href="#/settings?tab=jobs">Jobs</a> tab.</div>` : ""}
        ${Object.keys(missing).length ? html`<div class="notice"><b>${n1(Object.keys(missing).length, "rate is", "rates are")} missing</b>; these hours are held until they exist.
          <table>${Object.values(missing).sort((a, b) => b.hours - a.hours).map((u) => html`<tr><td class="mono">${u.rate_table_code || "(no table)"}</td><td>${classLabel(u.certified_class)}</td><td>${u.pay_id}</td><td class="small muted">${[...u.jobs].map(jobName).join(", ")}</td><td class="num">${hours(u.hours)} h</td><td>${u.rate_table_code ? html`<button class="fillrate" data-table="${u.rate_table_code}" data-class="${u.certified_class}" data-pay="${u.pay_id}" data-from="${u.first}">Add this rate</button>` : ""}</td></tr>`)}</table></div>` : ""}
        ${S.tables.length ? html`<div class="row" style="flex-wrap:wrap">${S.tables.map((t) => html`<a href="#/settings?tab=rates&table=${encodeURIComponent(t.code)}"><button class="${t.code === want ? "primary" : ""}">${t.code}${jobsOn(t.code).length ? ` · ${jobsOn(t.code).join(", ")}` : ""}</button></a>`)}</div>` : html`<p class="muted">No rate tables yet. Drop the Sage export on Update.</p>`}
        ${want ? html`<h2>${want} <span class="muted small">${(S.tables.find((t) => t.code === want) || {}).description || ""} · ${n1(rates.length, "rate")} in force${jobsOn(want).length ? ` · bills ${jobsOn(want).join(", ")}` : html` · <span class="warn">no job is billed from it</span>`}</span></h2>
          ${edit ? html`<form id="addrate" class="inline"><label>Table<select name="rate_table_code">${S.tables.map((t) => html`<option value="${t.code}" ${t.code === want ? "selected" : ""}>${t.code}</option>`)}</select></label><label>Class<input name="certified_class" required list="classes" placeholder="#LAB-J" style="width:110px"><datalist id="classes">${L.KNOWN_CLASSES.map((c) => html`<option value="${c}">${L.classLabel(c)}</option>`)}</datalist></label><label>Pay ID<input name="pay_id" required list="pays" placeholder="UNION REG" style="width:120px"><datalist id="pays">${[...new Set(S.rates.map((r) => r.pay_id).concat(["UNION REG", "UNION O/T", "UNION D/T", "REG", "O/T", "DOUBLETIME"]))].map((p) => html`<option value="${p}">`)}</datalist></label><label>$/hour<input name="rate" type="number" step="0.01" min="0.01" required style="width:90px"></label><label>From<input name="from" type="date" value="${C.todayIso().slice(0, 4)}-07-01" required></label><label>To (exclusive)<input name="to" type="date"></label><button class="primary">Add rate</button></form>` : ""}
          <table><tr><th>Class</th><th>Pay ID</th><th class="num">$/hour</th><th>In force</th>${edit ? html`<th></th>` : ""}</tr>
          ${rates.map((r) => html`<tr><td>${classLabel(r.certified_class)}</td><td>${r.pay_id}</td><td class="num">${money(r.rate_cents)}</td><td class="small">${r.effective_from ? C.fmtDay(r.effective_from) : ""} to ${r.effective_to ? C.fmtDay(C.addDays(r.effective_to, -1)) : "open"}</td>${edit ? html`<td><button class="retire" data-id="${r.id}">Retire</button></td>` : ""}</tr>`)}</table>` : ""}`;
    } else if (tab === "employees") {
      if (!edit) body = html`<p class="muted">Only editors see people.</p>`;
      else {
        const held = await st.db.view("v_labor_held", { status: "held:no class" });
        const noClass = new Set(held.map((h) => h.employee_number));
        const pm = S.prefixMap;
        body = html`<p class="muted small">An employee number's prefix sets the certified class by default (the table below: FB5 is a Laborer journeyman, FB8 a Carpenter journeyman); then the foremen, general foremen, apprentices and superintendents are picked by hand, one person at a time. A number no prefix covers is held until one does. Names stay on this tab; nowhere else, and never for viewers.</p>
          <h3>Prefix defaults</h3>
          <table><tr><th>Prefix</th><th>Certified class by default</th><th></th></tr>
          ${S.prefixes.map((p) => html`<tr><form class="prefix" data-p="${p.prefix}"><td class="mono">${p.prefix}</td><td><select name="certified_class">${L.KNOWN_CLASSES.map((c) => html`<option value="${c}" ${c === p.certified_class ? "selected" : ""}>${classLabel(c)}</option>`)}</select></td><td><button>Save</button> <button type="button" class="delprefix" data-p="${p.prefix}">Remove</button></td></form></tr>`)}</table>
          <form id="addprefix" class="inline"><label>Prefix<input name="prefix" required placeholder="FB5" maxlength="6" style="width:80px"></label><label>Class by default<select name="certified_class">${L.KNOWN_CLASSES.map((c) => html`<option value="${c}">${classLabel(c)}</option>`)}</select></label><button class="primary">Add prefix</button></form>
          <h3>People</h3>
          <table><tr><th>Employee #</th><th>Name</th><th>Certified class</th><th></th></tr>
          ${S.employees.slice().sort((a, b) => (noClass.has(b.employee_number) ? 1 : 0) - (noClass.has(a.employee_number) ? 1 : 0) || (a.employee_number < b.employee_number ? -1 : 1)).map((e) => html`<tr class="${noClass.has(e.employee_number) ? "held" : ""}"><form class="emp" data-n="${e.employee_number}"><td class="mono">${e.employee_number}</td><td>${e.name || ""}</td><td><select name="certified_class">${classOptions(e.certified_class)}</select>${!e.certified_class ? html` <span class="muted small">${L.classFromPrefix(e.employee_number, pm) ? classLabel(L.classFromPrefix(e.employee_number, pm)) : "no prefix default: set it"}</span>` : ""}</td><td><button>Save</button></td></form></tr>`)}</table>`;
      }
    } else if (tab === "paytypes") {
      body = html`<p class="muted small">Paid time off has hours but no billable rate; it is held for the audit, never priced. "Excluded" drops a pay type from the month entirely. Pay types not listed are rated.</p>
        <table><tr><th>Pay type name</th><th>Policy</th></tr>${S.policy.map((p) => html`<tr><td>${p.pay_type_name}</td><td>${p.policy}</td></tr>`)}</table>
        ${edit ? html`<form id="addpolicy" class="inline"><label>Pay type name<input name="pay_type_name" required></label><label>Policy<select name="policy"><option value="held_pto">held (PTO)</option><option value="excluded">excluded</option><option value="rated">rated</option></select></label><button>Set</button></form>` : ""}`;
    } else if (tab === "purchases") {
      const pend = (await st.db.view("v_purchase_docs", { status: "needs_decision" }).catch(() => [])).sort(poSort);
      body = html`<p class="muted small">POs the latest Purchase Pro export could not count by itself: on a job not in Settings, or with no committed amount yet. Count one on a job, in its bucket, or leave it out with a reason. A decision is about the PO, so it holds through the next export. If the job is real, add it on the Jobs tab instead: every PO on it then counts by itself.</p>
        ${pend.length ? html`<table><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Description</th><th>Type</th><th>PO's job</th><th class="num">Committed</th></tr>
          ${pend.map((r) => html`<tr class="held"><td class="mono">${r.doc_number}${r.shared_number > 1 ? html` <span class="warn small">on ${r.shared_number} orders</span>` : ""}</td><td class="small">${r.doc_date ? C.fmtDay(r.doc_date) : ""}</td><td>${r.vendor_name_raw || r.vendor_key || ""}</td><td>${r.description || ""}</td><td class="small">${r.order_type || ""}</td><td>${st.settings.jobByNumber[r.job_number] ? `${jobName(r.job_number)} · ${r.job_number}` : html`<span class="warn">${r.job_number || "(none)"} · not in Settings</span>`}</td><td class="num">${r.total_cents == null ? html`<span class="warn">no amount</span>` : money(r.total_cents)}</td></tr><tr><td colspan="7">${decideForm(r, "")}</td></tr>`)}</table>` : html`<p class="muted">Nothing waits for a decision.</p>`}`;
    } else if (tab === "recurring") {
      const all = (await st.db.view("recurring_charges", {}, { order: "job_number" }).catch(() => [])).sort((a, b) => (a.job_number + a.start_month < b.job_number + b.start_month ? -1 : 1));
      body = html`<p class="muted small">Every charge confirmed as a monthly rental, across jobs: counted under Rentals from its first month until its last, with the job's markup. The candidates wait on each job's page, found on its Job Cost To Date.</p>
        ${all.length ? html`<table><tr><th>Job</th><th>Vendor</th><th>Line</th><th class="num">A month</th><th>From</th><th>Until</th><th>Source</th>${edit ? html`<th></th>` : ""}</tr>
          ${all.map((r) => html`<tr><td><a href="#/job/${r.job_number}">${jobName(r.job_number)}</a></td><td>${r.vendor_name}${r.liberty_owned ? html` <span class="pill">Liberty-owned</span>` : ""}</td><td>${r.description}${r.units > 1 ? ` × ${r.units}` : ""}</td><td class="num">${money(r.monthly_cents)}</td><td class="small">${C.fmtMonth(ym(r.start_month))}</td><td class="small">${r.end_month ? C.fmtMonth(ym(r.end_month)) : "open"}</td><td class="small">${r.source}</td>${edit ? html`<td class="nowrap"><form class="endcharge inline" data-id="${r.id}" style="display:inline"><input type="month" name="end_month" value="${r.end_month ? ym(r.end_month) : ""}"><button>Set last month</button></form> <button class="delcharge" data-id="${r.id}">Remove</button></td>` : ""}</tr>`)}</table>` : html`<p class="muted">Nothing confirmed yet.</p>`}`;
    } else if (tab === "waste") {
      const wv = (S.wasteVendors || []).slice().sort((a, b) => (a.pattern < b.pattern ? -1 : 1));
      body = html`<p class="muted small">The dumpster haulers. A hauler that invoices one pull at a time is counted from the ledger, a pull an invoice; one that bills a lump shows spend, and the pulls come from the log on each job page. The pattern is matched inside the hauler's name as Sage and the log spell it.</p>
        <table><tr><th>Matches</th><th>Name</th><th>Bills</th><th class="num">A pull</th><th class="num">Container</th>${edit ? html`<th></th>` : ""}</tr>
        ${wv.map((w) => html`<tr><td class="mono">${w.pattern}</td><td>${w.name || ""}</td><td>${w.bills_per_haul ? "a pull at a time (counted from the ledger)" : "a lump (log the pulls)"}</td><td class="num">${w.haul_rate_cents ? money(w.haul_rate_cents) : ""}</td><td class="num">${w.container_yd ? `${w.container_yd} yd` : ""}</td>${edit ? html`<td><button class="delwaste" data-id="${w.id}">Remove</button></td>` : ""}</tr>`)}</table>
        ${edit ? html`<form id="addwaste" class="inline"><label>Matches<input name="pattern" required placeholder="sourgum" style="width:140px"></label><label>Name<input name="name" placeholder="Sourgum Waste" style="width:160px"></label><label>Bills<select name="bills_per_haul"><option value="true">a pull at a time</option><option value="false">a lump</option></select></label><label>A pull $<input name="rate" type="number" step="0.01" min="0" style="width:90px"></label><label>Container yd<input name="container_yd" type="number" min="1" max="100" style="width:60px"></label><button class="primary">Add hauler</button></form>` : ""}`;
    } else if (tab === "members") {
      body = html`<table><tr><th>Email</th><th>Role</th><th>Name</th></tr>${S.members.map((m) => html`<tr><td>${m.email}</td><td>${m.role}</td><td>${m.display_name || ""}</td></tr>`)}</table>
        ${st.db.role === "owner" ? html`<form id="invite" class="inline"><label>Email<input name="email" type="email" required></label><label>Role<select name="role"><option value="viewer">viewer (sees totals, never names)</option><option value="editor">editor</option><option value="owner">owner</option></select></label><button>Invite</button></form>` : html`<p class="muted small">Owners invite people.</p>`}`;
    } else {
      const ups = await st.db.view("uploads", {}, { order: "recorded_at", ascending: false, limit: 200 });
      body = html`<table><tr><th>File</th><th>Kind</th><th>Status</th><th>Covers</th><th>Recorded</th></tr>${ups.map((u) => html`<tr><td>${u.file_name}</td><td>${u.kind}</td><td><span class="pill">${u.status}</span>${u.supersede_reason ? html` <span class="muted small">${u.supersede_reason}</span>` : ""}</td><td class="small">${u.as_of ? C.fmtDay(u.as_of) : u.period_start ? `${C.fmtDay(u.period_start)} to ${C.fmtDay(u.period_end)}` : u.period ? u.period : ""}</td><td class="small">${u.recorded_at ? String(u.recorded_at).slice(0, 10) : ""}</td></tr>`)}</table>`;
    }
    return html`<h1>Settings</h1><div class="row noprint" style="flex-wrap:wrap">${tabs.map(([k, label]) => html`<a href="#/settings?tab=${k}"><button class="${k === tab ? "primary" : ""}">${label}</button></a>`)}</div><div style="margin-top:14px">${body}</div>`;
  }
  function wireSettings() {
    const reload = async (msg) => { st.settings = await loadSettings(); if (msg) toast(msg); render(); };
    const on = (sel, ev, fn) => $$(sel).forEach((el) => el.addEventListener(ev, fn));
    const f = (id) => $("#" + id);
    const bp = (v) => Math.round(+v * 100);
    if (f("addjob")) f("addjob").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); const campus = root.JobsSettings.campusCode(d.campus) || null; try { await st.db.insert("jobs", { job_number: d.job_number.trim(), short_name: d.short_name.trim(), name: d.name.trim() || null, campus, region: d.region.trim() || null, rate_table_code: d.rate_table_code || null }); location.hash = `#/settings?tab=jobs&job=${encodeURIComponent(d.job_number.trim())}`; reload("Job added."); } catch (e) { toast(e.message); } });
    on("button.addjob", "click", async (ev) => { const b = ev.currentTarget; try { await st.db.insert("jobs", { job_number: b.dataset.job, short_name: (b.dataset.name || b.dataset.job).split(" ").slice(-1)[0], name: b.dataset.name || null, rate_table_code: L.tableForJob(b.dataset.job, st.settings.tables.map((t) => t.code)) }); reload("Job added; set its rate table so its hours price."); } catch (e) { toast(e.message); } });
    on("form.job", "submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); const prev = st.settings.jobByNumber[ev.target.dataset.n] || {}; const campus = (root.JobsSettings.campusCode(d.campus) || null); const next = d.job_number.trim(); try { await st.db.update("jobs", { job_number: ev.target.dataset.n }, { job_number: next, short_name: d.short_name.trim(), name: (d.name || "").trim() || null, campus, region: (d.region || "").trim() || null, rate_table_code: d.rate_table_code || null, tax_bp: prev.tax_bp == null ? 700 : prev.tax_bp, markup_bp: prev.markup_bp == null ? 1000 : prev.markup_bp, markup_base: prev.markup_base || "rent_plus_tax" }); if (next !== ev.target.dataset.n) location.hash = `#/settings?tab=jobs&job=${encodeURIComponent(next)}`; reload("Job saved."); } catch (e) { toast(e.message); } });
    on("form.vendor", "submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.update("vendors", { vendor_key: ev.target.dataset.key }, { taxable: d.taxable === "true", liberty_owned: d.liberty_owned === "true" }); reload("Vendor saved."); } catch (e) { toast(e.message); } });
    on("select.mapjob", "change", async (ev) => { const s = ev.currentTarget; try { await st.db.mapVendorJob(s.dataset.vendor, s.dataset.ref, s.value || null); st.settings = await loadSettings(); toast(s.value ? `"${s.dataset.ref}" is ${jobName(s.value)} now.` : `"${s.dataset.ref}" is under other jobs.`); } catch (e) { toast(e.message); } });
    if (f("addrate")) f("addrate").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); const cents = C.cents(d.rate); if (!cents || cents <= 0) return toast("the rate must be money"); const cls = d.certified_class.trim().toUpperCase(); if (!cls.startsWith("#")) return toast("a certified class starts with #, as Sage writes it (#LAB-J)"); try { await st.db.insert("billable_rates", { rate_table_code: d.rate_table_code, certified_class: cls, pay_id: d.pay_id.trim().toUpperCase(), rate_cents: cents, effective: `[${d.from},${d.to || ""})`, effective_from: d.from, effective_to: d.to || null }); reload("Rate added; held hours with this key price now."); } catch (e) { toast(e.message); } });
    on("button.fillrate", "click", (ev) => { const b = ev.currentTarget, form = f("addrate"); if (!form) return; if (form.rate_table_code.value !== b.dataset.table) { location.hash = `#/settings?tab=rates&table=${encodeURIComponent(b.dataset.table)}`; st.fill = b.dataset; return; } form.certified_class.value = b.dataset.class; form.pay_id.value = b.dataset.pay; form.rate.focus(); form.scrollIntoView({ behavior: "smooth" }); });
    if (st.fill && f("addrate")) { const form = f("addrate"), d = st.fill; st.fill = null; if (form.rate_table_code.value === d.table) { form.certified_class.value = d.class; form.pay_id.value = d.pay; form.rate.focus(); } }
    on("button.retire", "click", async (ev) => { if (!confirm("Retire this rate? Hours it priced will be held until a new one is in force.")) return; try { await st.db.retireRate(ev.currentTarget.dataset.id); reload("Rate retired."); } catch (e) { toast(e.message); } });
    on("form.emp", "submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.update("employees", { employee_number: ev.target.dataset.n }, { certified_class: d.certified_class || null }); reload("Saved."); } catch (e) { toast(e.message); } });
    on("form.prefix", "submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.update("prefix_classes", { prefix: ev.target.dataset.p }, { certified_class: d.certified_class }); reload("Saved."); } catch (e) { toast(e.message); } });
    const ap = $("#addprefix"); if (ap) ap.addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ap)); try { await st.db.insert("prefix_classes", { prefix: d.prefix.trim().toUpperCase(), certified_class: d.certified_class }); reload("Prefix added."); } catch (e) { toast(e.message); } });
    $$("button.delprefix").forEach((b) => b.addEventListener("click", async () => { if (!confirm(`Remove the ${b.dataset.p} default? People on it with no class set are held until a class is set.`)) return; try { await st.db.remove("prefix_classes", { prefix: b.dataset.p }); reload("Removed."); } catch (e) { toast(e.message); } }));
    if (f("addpolicy")) f("addpolicy").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.upsert("pay_type_policy", [{ pay_type_name: d.pay_type_name.trim(), policy: d.policy }], "workspace_id,pay_type_name"); reload("Policy set."); } catch (e) { toast(e.message); } });
    if (f("invite")) f("invite").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.insert("members", { email: d.email.trim(), role: d.role }); reload(`${d.email} invited; they sign in with that email.`); } catch (e) { toast(e.message); } });
  }

  // ---- wiring ------------------------------------------------------------------------------------------------------
  function wirePortfolio() {
    const m = monthQ(st.route.q);
    const openCampus = (name) => {
      const hash = Pages.campusHref(name, m);
      if (location.hash === hash) render(); else location.hash = hash;
    };
    $$(".pf g.pf-dot").forEach((el) => {
      el.addEventListener("click", () => openCampus(el.getAttribute("data-campus")));
      el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openCampus(el.getAttribute("data-campus")); } });
    });
  }

  function wire() {
    const r = st.route;
    if (!r.page) wirePortfolio();
    if (r.page === "update") wireUpdate();
    if (r.page === "settings") wireSettings();
    if (r.page === "p") wireReview();
    const x = $("#xlsx"); if (x) x.addEventListener("click", () => exportJob(r.parts[1], monthQ(r.q)).catch((e) => toast(e.message)));
    const bk = $("#buckets"); if (bk) bk.addEventListener("click", () => exportBuckets(monthQ(r.q)).catch((e) => toast(e.message)));
    $$("form.confirm").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(f));
      if (d.end_month && d.end_month < d.start_month) return toast("The last month comes before the first.");
      try {
        await st.db.insert("recurring_charges", { job_number: f.dataset.job, candidate_key: f.dataset.key, vendor_code: d.vendor_code || null, vendor_name: d.vendor_name, description: d.description, cost_code: d.cost_code || null,
          monthly_cents: +d.monthly_cents, units: +d.units || 1, liberty_owned: !!d.liberty_owned, amount_includes_tax: !!d.amount_includes_tax, start_month: d.start_month + "-01", end_month: d.end_month ? d.end_month + "-01" : null, source: "jctd" });
        toast("Confirmed; it counts under Rentals now."); render();
      } catch (e) { toast(e.message); }
    }));
    $$("form.dismiss").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault(); const reason = f.reason.value.trim(); if (!reason) return toast("Say why it is not a rental.");
      try { await st.db.insert("recurring_dismissals", { job_number: f.dataset.job, candidate_key: f.dataset.key, reason }); toast("Set aside; it will not come back."); render(); } catch (e) { toast(e.message); }
    }));
    $$("form.endcharge").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault(); const v = f.end_month.value;
      try { await st.db.update("recurring_charges", { id: f.dataset.id }, { end_month: v ? v + "-01" : null }); toast(v ? `Last month set to ${C.fmtMonth(v)}.` : "Open again."); render(); } catch (e) { toast(e.message); }
    }));
    $$("form.addpull").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault(); const d = Object.fromEntries(new FormData(f));
      try {
        await st.db.insert("dumpster_pulls", { job_number: f.dataset.job, pull_date: d.pull_date, vendor_name: d.vendor_name.trim(), container_yd: d.container_yd ? +d.container_yd : null, pulls: +d.pulls || 1,
          ticket_no: d.ticket_no.trim() || null, tonnage: d.tonnage ? +d.tonnage : null, cost_cents: d.cost ? C.cents(d.cost) : null, note: d.note.trim() || null });
        toast("Pull logged."); render();
      } catch (e) { toast(e.message); }
    }));
    $$("button.delpull").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Remove this pull from the log?")) return; try { await st.db.remove("dumpster_pulls", { id: b.dataset.id }); toast("Removed."); render(); } catch (e) { toast(e.message); } }));
    const aw = $("#addwaste"); if (aw) aw.addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(aw)); try { await st.db.insert("waste_vendors", { pattern: d.pattern.trim().toLowerCase(), name: d.name.trim() || null, bills_per_haul: d.bills_per_haul === "true", haul_rate_cents: d.rate ? C.cents(d.rate) : null, container_yd: d.container_yd ? +d.container_yd : null }); st.settings = await loadSettings(); toast("Hauler added."); render(); } catch (e) { toast(e.message); } });
    $$("button.delwaste").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Remove this hauler? Its ledger lines stop counting as pulls; the log stays.")) return; try { await st.db.remove("waste_vendors", { id: b.dataset.id }); st.settings = await loadSettings(); toast("Removed."); render(); } catch (e) { toast(e.message); } }));
    $$("button.delcharge").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Remove this confirmed charge? Its months stop counting; the candidate comes back on the job page.")) return;
      try { await st.db.remove("recurring_charges", { id: b.dataset.id }); toast("Removed."); render(); } catch (e) { toast(e.message); }
    }));
    $$("form.decide").forEach((f) => f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const decision = (ev.submitter && ev.submitter.value) || "assign", d = Object.fromEntries(new FormData(f)), reason = (d.reason || "").trim();
      if (decision === "exclude" && !reason) return toast("Say why it is left out.");
      try {
        await st.db.insert("purchase_decisions", { doc_id: f.dataset.doc, job_number: decision === "assign" ? d.job_number : null, bucket: decision === "assign" ? d.bucket : null, decision, reason: reason || null });
        toast(decision === "assign" ? `Counted on ${jobName(d.job_number)}; its page shows it now.` : "Left out; it stays listed as such."); render();
      } catch (e) { toast(e.message); }
    }));
    const p = $("#print"); if (p) p.addEventListener("click", () => window.print());
    if (r.q.m) st.month = monthQ(r.q);
  }

  async function boot() {
    st.db = root.Db.open();
    if (st.db.mode === "live") { st.user = await st.db.session(); if (st.user) { await st.db.loadWorkspaces(); if (st.db.workspaces.length === 1) st.db.use(st.db.workspaces[0].id); } }
    else st.db.use();
    window.addEventListener("hashchange", render);
    render();
  }
  if (cfg.RELEASE !== RELEASE) console.warn(`config.js says ${cfg.RELEASE}, ui.js is ${RELEASE}: press Ctrl+F5`);
  root.UI = { html, raw, mount, state: st, render, addFiles, recordAll, boot, headerMarkup };
  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
})(typeof self !== "undefined" ? self : this);
