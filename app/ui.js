/* ui.js - the page. Every piece of markup is built with the html`` tag,
   which escapes every interpolation, and put on the page with mount().
   File names, vendor job labels, notes and names all come from outside.

   Pages (hash routes):
     #/                 Portfolio - every job this month, grouped by campus
     #/job/<n>?m=       Job - the tiles, labor by class and code, rentals, purchases, held
     #/report/<n>?m=    Report - print it, choose Save as PDF (#/report/all for every job)
     #/statement/<n>?m=&v=  the client's rental statement for one vendor
     #/update           Update - drop the files, read the cards, press Record
     #/settings         Settings - jobs, vendors, their job names, rate tables, employees, pay types, people, files */
(function (root) {
  "use strict";
  const C = root.Common, B = root.Buckets, L = root.LaborModel, R = root.RentalsModel, V = root.OnRentVendors,
    Intake = root.Intake, E = root.ExportXlsx, cfg = root.CostConfig;
  const RELEASE = "0.1.0";

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
      if (r.page === "job" && r.parts[1]) body = await jobView(r.parts[1], monthQ(r.q));
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
    const [jobs, vendors, map, tables, rates, employees, policy, members] = await Promise.all([
      db.view("jobs", {}, { order: "job_number" }), db.view("vendors", {}, { order: "vendor_key" }), db.view("vendor_job_map"),
      db.view("rate_tables", {}, { order: "code" }), db.view("billable_rates"),
      db.canEdit() ? db.view("employees") : Promise.resolve([]), db.view("pay_type_policy"), db.view("members").catch(() => [])]);
    const jobMap = {};
    for (const m of map) (jobMap[m.vendor_key] = jobMap[m.vendor_key] || {})[m.vendor_job_ref] = m.job_number;
    const live = rates.filter((r) => !r.retired_at).map((r) => Object.assign({}, r, r.effective && !r.effective_from ? rangeOf(r.effective) : {}));
    const jobByNumber = Object.fromEntries(jobs.map((j) => [j.job_number, j]));
    const vendorByKey = Object.fromEntries(vendors.map((v) => [v.vendor_key, v]));
    return { jobs, vendors, jobMap, tables, rates: live, allRates: rates, employees, policy, members, jobByNumber, vendorByKey,
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
      policy: Object.fromEntries(st.settings.policy.map((p) => [p.pay_type_name, p.policy])), jobs: st.settings.jobs },
    vendorSettings: st.settings.rental, jobMap: st.settings.jobMap, existing: (sha) => st.db.existing(sha), asOf: st.asOf || {},
  });

  // ---- header and foot ------------------------------------------------------------------------
  async function topView() {
    const f = (await st.db.view("v_freshness"))[0] || {};
    const on = f.onrent_as_of || {};
    const chip = (cls, text, title) => html`<span class="chip ${cls}" title="${title || ""}"><span class="dot"></span>${text}</span>`;
    const age = (iso) => { if (!iso) return "none"; const d = Math.round((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000); return d <= 10 ? "fresh" : "stale"; };
    const nav = (p, label) => html`<a href="#/${p}" class="${st.route.page === p || (p === "" && !st.route.page) ? "on" : ""}">${label}</a>`;
    return html`<header class="top"><span class="brand">GR Cost</span>
      <nav>${nav("", "Portfolio")}${st.db.canEdit() ? nav("update", "Update") : ""}${nav("settings", "Settings")}</nav>
      <span class="spacer"></span>
      ${chip(age(f.hh2_through), f.hh2_through ? `HH2 through ${C.fmtDay(f.hh2_through)}` : "No HH2 yet", "labor")}
      ${Object.keys(on).length ? Object.entries(on).map(([k, d]) => chip(age(d), `${vendorName(k)} ${C.fmtDay(d)}`, "on-rent report")) : chip("none", "No on-rent report yet")}
      ${chip(age(f.po_as_of), f.po_as_of ? `POs as of ${C.fmtDay(f.po_as_of)}` : "No PO export yet", "Purchase Pro export")}
      ${st.db.mode === "demo" ? chip("demo", "Demo: nothing is saved") : html`<span class="chip">${st.user ? st.user.email : ""} · ${st.db.role}</span>`}
    </header>`;
  }
  const titleBlock = () => html`<footer class="titleblock"><span>GR Cost v${RELEASE}</span><span>${st.db.mode === "demo" ? "demo mode" : "live"}</span><span>${st.settings ? n1(st.settings.jobs.length, "job") : ""}</span><span>money in cents, rounded half up</span></footer>`;

  // ---- Portfolio ----------------------------------------------------------------------------------
  const monthNav = (m, base) => html`<div class="row noprint"><a href="${base}?m=${prevMonth(m)}">&larr; ${C.fmtMonth(prevMonth(m))}</a><span class="big">${C.fmtMonth(m)}</span><a href="${base}?m=${nextMonth(m)}">${C.fmtMonth(nextMonth(m))} &rarr;</a></div>`;
  async function portfolioView(m) {
    const rows = await st.db.view("v_job_month", { month: m + "-01" });
    const by = Object.fromEntries(rows.map((r) => [r.job_number, r]));
    const groups = {};
    for (const j of st.settings.jobs.filter((j) => j.active !== false)) (groups[j.campus || "Other"] = groups[j.campus || "Other"] || []).push(j);
    const tot = rows.reduce((t, r) => ({ labor: t.labor + r.labor_cents, rent: t.rent + r.rental_cents + r.rental_lo_cents, purch: t.purch + r.purchase_cents, pending: t.pending + r.pending_cents, all: t.all + r.total_cents }), { labor: 0, rent: 0, purch: 0, pending: 0, all: 0 });
    const withCost = rows.filter((r) => r.total_cents).length;
    return html`<div class="row" style="justify-content:space-between"><h1>Portfolio</h1>${monthNav(m, "#/")}<a class="noprint" href="#/report/all?m=${m}"><button>Report (PDF)</button></a></div>
      <div class="tiles">${tile("total", "All jobs, this month", tot.all, `${n1(withCost, "job")} with cost`)}${tile("labor", "Labor", tot.labor)}${tile("equipment", "Rentals to client", tot.rent)}${tile("materials", "Purchases (POs)", tot.purch, tot.pending ? `${money(tot.pending, true)} awaiting a decision` : "")}</div>
      ${Object.entries(groups).sort().map(([campus, jobs]) => html`<h2>${campus}${jobs[0].region ? html` <span class="muted small">${jobs[0].region}</span>` : ""}</h2><div class="cards">${jobs.map((j) => jobCard(j, by[j.job_number], m))}</div>`)}
      ${st.settings.jobs.length === 0 ? html`<div class="notice">No jobs yet. Drop the Projects register or an HH2 export on Update, or add them in <a href="#/settings">Settings</a>.</div>` : ""}`;
  }
  const tile = (cls, label, cents, sub) => html`<div class="tile ${cls}"><div class="label">${label}</div><div class="value">${money(cents, true)}</div><div class="sub">${sub || ""}</div></div>`;
  function jobCard(j, r, m) {
    if (!r || !r.total_cents && !r.labor_held_hours && !r.pending_lines) return html`<div class="card"><h3><a href="#/job/${j.job_number}?m=${m}">${j.short_name}</a> <span class="muted small">${j.job_number}</span></h3><p class="muted">Nothing recorded for ${C.fmtMonth(m)}.</p></div>`;
    return html`<div class="card"><h3><a href="#/job/${j.job_number}?m=${m}">${j.short_name}</a> <span class="muted small">${j.name || j.job_number}</span></h3>
      <table><tr><td>Labor</td><td class="num">${money(r.labor_cents)}</td><td class="muted small">${hours(r.labor_hours)} h${r.labor_held_hours ? html`, <span class="warn">${hours(r.labor_held_hours)} held</span>` : ""}</td></tr>
      <tr><td>Rentals</td><td class="num">${money(r.rental_cents)}</td><td class="muted small">${r.rental_lines} on rent${r.rental_lo_cents ? `, Liberty-owned ${money(r.rental_lo_cents)}` : ""}</td></tr>
      <tr><td>Purchases</td><td class="num">${money(r.purchase_cents)}</td><td class="muted small">${r.pending_lines ? html`<span class="warn">${n1(r.pending_lines, "PO")} awaiting a decision</span>` : ""}</td></tr>
      <tr class="total"><td>Total</td><td class="num">${money(r.total_cents)}</td><td></td></tr></table></div>`;
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
    return { job: st.settings.jobByNumber[n] || { job_number: n, short_name: n }, month: m, tile: tileRows[0] || null, classes, rentals, purchases, held,
      lines: lines.map((r) => Object.assign({}, r, { hours_x100: r.hours_x100 != null ? r.hours_x100 : Math.round(r.hours * 100) })), items };
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
  const heldWhat = (h) => h.status === "held:no rate" ? `${classLabel(h.certified_class)} · ${h.pay_id}${h.rate_table_code ? ` · table ${h.rate_table_code}` : ""}`
    : h.status === "held:unknown job" ? `${h.job_number} ${h.job_name || ""}` : h.status === "held:no rate table" ? `${jobName(h.job_number)} has no rate table`
    : h.status === "held:PTO pay type" ? h.pay_type_name : h.status === "held:no class" ? `employee ${h.employee_number}` : h.employee_number || "";
  const heldTab = (held) => held.some((h) => h.status === "held:no rate" || h.status === "held:no rate table") ? "rates" : held.some((h) => h.status === "held:unknown job") ? "jobs" : held.some((h) => h.status === "held:no class") ? "employees" : "paytypes";
  function purchaseTable(rows, d) {
    const counted = rows.filter((r) => r.status === "auto" || r.status === "confirmed");
    return html`<table><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Description</th><th>Type</th><th>Bucket</th><th class="num">Committed</th><th></th></tr>
      ${rows.slice().sort((a, b) => (a.doc_date + a.doc_number < b.doc_date + b.doc_number ? -1 : 1)).map((r) => html`<tr class="${r.status === "needs_decision" ? "held" : ""}"><td class="mono">${r.doc_number}</td><td class="small">${r.doc_date ? C.fmtDay(r.doc_date) : ""}</td><td>${r.vendor_name_raw || r.vendor_key || ""}</td><td>${r.description || ""}</td><td class="small">${r.order_type || ""}</td><td class="small">${r.bucket ? B.META[r.bucket] ? B.META[r.bucket].name : r.bucket : ""}</td><td class="num">${r.total_cents == null ? html`<span class="warn">no amount</span>` : money(r.total_cents)}</td><td><span class="pill ${r.status === "needs_decision" ? "held" : r.status === "excluded" ? "excluded" : "priced"}">${r.status === "needs_decision" ? "needs a decision" : r.status === "excluded" ? (r.cancelled ? "cancelled" : r.quote ? "quote" : "excluded") : "counted"}</span></td></tr>`)}
      <tr class="total"><td colspan="6">Counted · ${n1(counted.length, "PO")}</td><td class="num">${money(counted.reduce((a, r) => a + (r.total_cents || 0), 0))}</td><td></td></tr></table>`;
  }
  async function jobView(n, m) {
    const d = await jobData(n, m);
    const t = d.tile;
    const byCode = {};
    for (const r of d.lines) { const c = byCode[r.cost_code || "(none)"] || (byCode[r.cost_code || "(none)"] = { code: r.cost_code || "(none)", name: r.cost_code_name || "", hours: 0, cost: 0, held: 0 }); c.hours += r.hours_x100; if (r.status === "priced") c.cost += r.cost_cents; else if (r.status !== "excluded") c.held += r.hours_x100; }
    const classRows = pricedClasses(d);
    const heldNow = d.held.filter((h) => h.first_day <= C.monthEnd(m) && h.last_day >= m + "-01");
    const table = d.job.rate_table_code ? st.settings.tables.find((x) => x.code === d.job.rate_table_code) : null;
    return html`<div class="row" style="justify-content:space-between"><h1>${d.job.short_name} <span class="muted">${d.job.name || ""} · ${d.job.job_number}</span></h1>${monthNav(m, "#/job/" + n)}
        <span class="row noprint"><a href="#/report/${n}?m=${m}"><button>Report (PDF)</button></a>${st.db.canEdit() ? html`<button id="xlsx">Export .xlsx</button>` : ""}</span></div>
      <p class="muted small">${d.job.campus ? `${d.job.campus}${d.job.region ? ` · ${d.job.region}` : ""} · ` : ""}${d.job.rate_table_code ? `rate table ${d.job.rate_table_code}${table && table.description ? ` (${table.description})` : ""}` : html`<span class="warn">no rate table: its labor is held until one is set in Settings</span>`} · rentals taxed ${pct(d.job.tax_bp == null ? 700 : d.job.tax_bp)}, markup ${pct(d.job.markup_bp == null ? 1000 : d.job.markup_bp)} on ${d.job.markup_base === "rent" ? "rent" : "rent + tax"}</p>
      ${t ? html`<div class="tiles">${tile("labor", "Labor", t.labor_cents, `${hours(t.labor_hours)} hours${t.labor_held_hours ? `, ${hours(t.labor_held_hours)} held` : ""}${t.labor_through ? ` · HH2 through ${C.fmtDay(t.labor_through)}` : ""}`)}
        ${tile("equipment", "Rentals to client", t.rental_cents, `${t.rental_lines} on rent${t.rental_as_of ? ` as of ${C.fmtDay(t.rental_as_of)}` : ""}${t.rental_no_monthly ? `, ${t.rental_no_monthly} with no monthly figure` : ""}`)}
        ${t.rental_lo_cents ? tile("lo", "Liberty-owned equipment", t.rental_lo_cents, "rent only") : ""}
        ${tile("materials", "Purchases (POs)", t.purchase_cents, `${t.purchase_rental_cents ? `rental POs ${money(t.purchase_rental_cents, true)}` : ""}${t.purchase_nb_cents ? `${t.purchase_rental_cents ? " · " : ""}non-billable ${money(t.purchase_nb_cents, true)}` : ""}${t.pending_lines ? `${t.purchase_rental_cents || t.purchase_nb_cents ? " · " : ""}${n1(t.pending_lines, "PO")} awaiting a decision` : ""}`)}
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
      </div></div>
      <h2>Purchases (POs)</h2>
      ${d.purchases.length ? html`<p class="muted small">Purchase Pro's committed amount per PO, by order date, from the latest export. Quotes and cancelled POs are listed and not counted.</p>${purchaseTable(d.purchases, d)}` : html`<p class="muted">No POs dated this month in the latest Purchase Pro export.</p>`}
      ${d.lines.length ? html`<h2>Labor by cost code</h2><table><tr><th>Cost code</th><th>Name</th><th class="num">Hours</th><th class="num">Cost</th><th class="num">Held hours</th></tr>
        ${Object.values(byCode).sort((a, b) => (a.code < b.code ? -1 : 1)).map((c) => html`<tr><td class="mono">${c.code}</td><td>${c.name}</td><td class="num">${C.fmtHours(c.hours)}</td><td class="num">${money(c.cost)}</td><td class="num ${c.held ? "warn" : ""}">${c.held ? C.fmtHours(c.held) : ""}</td></tr>`)}</table>` : ""}`;
  }
  async function exportJob(n, m) {
    const d = await jobData(n, m);
    const summary = L.summarize(d.lines);
    const purchases = d.purchases.map((p) => ({ vendor: p.vendor_name_raw || p.vendor_key || "", doc_number: p.doc_number, doc_date: p.doc_date, description: p.description, cost_code: p.cost_code, bucket: p.bucket, amount_cents: p.total_cents || 0, status: p.status }));
    const wb = E.jobMonth({ job: d.job, month: m, labor: { summary, rows: d.lines }, rentals: statementsFor(d), purchases });
    E.download(wb, E.fileSafe(`${d.job.short_name} ${m} cost.xlsx`));
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
    const t = d.tile || { labor_cents: 0, labor_hours: 0, labor_held_hours: 0, rental_cents: 0, rental_lo_cents: 0, rental_lines: 0, purchase_cents: 0, pending_lines: 0, total_cents: 0 };
    const classRows = pricedClasses(d);
    const stmts = statementsFor(d);
    const counted = d.purchases.filter((p) => p.status === "auto" || p.status === "confirmed");
    return html`<section style="break-inside:avoid-page;margin-bottom:28px"><h2 style="font-size:16px;color:inherit;text-transform:none;letter-spacing:0">${d.job.short_name} <span class="muted">${d.job.name || ""} · ${d.job.job_number}${d.job.campus ? ` · ${d.job.campus}` : ""}</span></h2>
      <div class="tiles">${tile("labor", "Labor", t.labor_cents, `${hours(t.labor_hours)} hours${t.labor_held_hours ? `, ${hours(t.labor_held_hours)} held` : ""}`)}${tile("equipment", "Rentals to client", t.rental_cents, `${t.rental_lines} on rent`)}${t.rental_lo_cents ? tile("lo", "Liberty-owned", t.rental_lo_cents, "rent only") : ""}${tile("materials", "Purchases (POs)", t.purchase_cents, t.pending_lines ? `${n1(t.pending_lines, "PO")} awaiting a decision` : "")}${tile("total", "Total", t.total_cents)}</div>
      ${classRows.length ? classTable(classRows, "Labor") : ""}
      ${stmts.map((s) => statementTable(s, d))}
      ${counted.length ? html`<h3>Purchase orders · ${n1(counted.length, "PO")}</h3><table><tr><th>PO #</th><th>Date</th><th>Supplier</th><th>Description</th><th>Type</th><th class="num">Committed</th></tr>
        ${counted.slice().sort((a, b) => (a.doc_date + a.doc_number < b.doc_date + b.doc_number ? -1 : 1)).map((r) => html`<tr><td class="mono">${r.doc_number}</td><td class="small">${r.doc_date ? C.fmtDay(r.doc_date) : ""}</td><td>${r.vendor_name_raw || r.vendor_key || ""}</td><td>${r.description || ""}</td><td class="small">${r.order_type || ""}</td><td class="num">${money(r.total_cents)}</td></tr>`)}
        <tr class="total"><td colspan="5">Purchases</td><td class="num">${money(counted.reduce((a, r) => a + (r.total_cents || 0), 0))}</td></tr></table>` : ""}</section>`;
  }
  function statementTable(s, d) {
    return html`<h3>${vendorName(s.vendor_key)} · on rent as of ${C.fmtDay(s.as_of)}</h3>
      <table><tr><th>Equipment #</th><th>Description</th><th class="num">Qty</th><th>On rent since</th><th class="num">Monthly rent</th><th class="num">Tax</th><th class="num">Markup</th><th class="num">Total</th></tr>
      ${s.rows.map((r) => html`<tr><td class="mono">${r.equipment_no}</td><td>${r.description}${r.liberty_owned ? html` <span class="pill">Liberty-owned</span>` : ""}</td><td class="num">${r.qty}</td><td>${r.on_rent_date ? C.fmtDay(r.on_rent_date) : ""}</td><td class="num">${r.monthly_rent_cents == null ? html`<span class="muted">${r.rate_period || ""} ${money(r.rate_cents)}</span>` : money(r.monthly_rent_cents)}</td><td class="num">${money(r.tax_cents)}</td><td class="num">${money(r.markup_cents)}</td><td class="num">${money(r.total_cents)}</td></tr>`)}
      <tr class="total"><td colspan="4">Total · rent${s.settings.taxable ? ` + ${pct(s.settings.tax_bp)} tax` : ""} + ${pct(s.settings.markup_bp)} markup</td><td class="num">${money(s.total.rent + s.total.liberty_owned)}</td><td class="num">${money(s.total.tax)}</td><td class="num">${money(s.total.markup)}</td><td class="num">${money(s.total.total)}</td></tr></table>
      ${s.offRent.length ? html`<p class="muted small">Off rent since the previous report: ${s.offRent.map((l) => `${l.equipment_no} ${l.description} (${C.fmtDay(l.off_rent_date)})`).join("; ")}</p>` : ""}
      ${s.noMonthly ? html`<p class="muted small">${s.noMonthly} line${s.noMonthly > 1 ? "s" : ""} carr${s.noMonthly > 1 ? "y" : "ies"} only a day or week rate; shown, not totalled.</p>` : ""}`;
  }
  async function statementView(n, m, vendor_key) {
    const d = await jobData(n, m);
    const s = statementsFor(d).find((x) => x.vendor_key === vendor_key);
    if (!s) return html`${printBar()}<p class="muted">No ${vendorName(vendor_key)} report covers ${C.fmtMonth(m)} for ${d.job.short_name}${st.db.canEdit() ? "" : ", or the statement's lines are for editors"}.</p>`;
    return html`${printBar()}<h1>${d.job.short_name} · Equipment on rent · ${C.fmtMonth(m)}</h1><p class="muted small">${d.job.name || ""} · ${d.job.job_number} · prepared ${C.fmtDay(C.todayIso())}</p>${statementTable(s, d)}`;
  }

  // ---- Update ---------------------------------------------------------------------------------------------
  function updateView() {
    return html`<h1>Update</h1><p class="muted">Drop the HH2 Labor Detail export, the vendors' on-rent reports (United Rentals, Sunbelt, Herc, EquipmentShare, or the page's own CSV), the Purchase Pro PO export, a Sage rate table export, or the Projects register. A zip or a folder is fine; each file is read by what is in it, not its name. Nothing is saved until you press Record.</p>
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
    const tabs = [["jobs", "Jobs"], ["vendors", "Vendors"], ["jobmap", "Vendor job names"], ["rates", "Rate tables"], ["employees", "Employees"], ["paytypes", "Pay types"], ["members", "People"], ["files", "Files"]];
    let body;
    if (tab === "jobs") {
      const held = edit ? await st.db.view("v_labor_held", { status: "held:unknown job" }) : [];
      const unknown = {}; for (const h of held) { const u = unknown[h.job_number] || (unknown[h.job_number] = { job_number: h.job_number, job_name: h.job_name, hours: 0 }); u.hours += h.hours; }
      const tableOpts = (sel) => html`<option value="" ${sel ? "" : "selected"}>(none: labor held)</option>${S.tables.map((t) => html`<option value="${t.code}" ${t.code === sel ? "selected" : ""}>${t.code}${t.description ? ` ${t.description}` : ""}</option>`)}`;
      body = html`<p class="muted small">Every job the company tracks. Its Sage rate table prices its labor; its tax and markup bill its rentals to the client. Drop the Projects register on Update to add jobs with their campus and region.</p>
        <table><tr><th>Job</th><th>Short name</th><th>Name</th><th>Campus</th><th>Region</th><th>Rate table</th><th class="num">Rental tax %</th><th class="num">Markup %</th><th>Markup on</th>${edit ? html`<th></th>` : ""}</tr>
        ${S.jobs.map((j) => html`<tr class="${j.active === false ? "faint" : ""}"><form class="job" data-n="${j.job_number}"><td class="mono">${j.job_number}</td><td>${edit ? html`<input name="short_name" value="${j.short_name}" required style="width:80px">` : j.short_name}</td><td>${j.name || ""}</td>
          <td>${edit ? html`<input name="campus" value="${j.campus || ""}" style="width:80px">` : j.campus || ""}</td><td>${edit ? html`<input name="region" value="${j.region || ""}" style="width:140px">` : j.region || ""}</td>
          <td>${edit ? html`<select name="rate_table_code">${tableOpts(j.rate_table_code)}</select>` : j.rate_table_code || html`<span class="warn">none</span>`}</td>
          <td class="num">${edit ? html`<input name="tax" type="number" step="0.01" min="0" max="50" value="${(j.tax_bp == null ? 700 : j.tax_bp) / 100}" style="width:70px">` : pct(j.tax_bp == null ? 700 : j.tax_bp)}</td>
          <td class="num">${edit ? html`<input name="markup" type="number" step="0.01" min="0" max="100" value="${(j.markup_bp == null ? 1000 : j.markup_bp) / 100}" style="width:70px">` : pct(j.markup_bp == null ? 1000 : j.markup_bp)}</td>
          <td>${edit ? html`<select name="markup_base"><option value="rent_plus_tax" ${j.markup_base !== "rent" ? "selected" : ""}>rent + tax</option><option value="rent" ${j.markup_base === "rent" ? "selected" : ""}>rent</option></select>` : j.markup_base === "rent" ? "rent" : "rent + tax"}</td>
          ${edit ? html`<td><button>Save</button>${j.active === false ? html` <span class="pill">inactive</span>` : ""}</td>` : ""}</form></tr>`)}</table>
        ${Object.keys(unknown).length ? html`<div class="notice"><b>${n1(Object.keys(unknown).length, "job")} in the HH2 exports ${Object.keys(unknown).length > 1 ? "are" : "is"} not set up</b>, so their hours are held. Add the ones that are yours; leave the rest.
          <table>${Object.values(unknown).sort((a, b) => b.hours - a.hours).map((u) => html`<tr><td class="mono">${u.job_number}</td><td>${u.job_name || ""}</td><td class="num">${hours(u.hours)} h</td><td><button class="addjob" data-job="${u.job_number}" data-name="${u.job_name || ""}">Add</button></td></tr>`)}</table></div>` : ""}
        ${edit ? html`<form id="addjob" class="inline"><label>Job #<input name="job_number" required pattern="\\d{2}-\\d{2}-\\d{6}" placeholder="50-60-225121"></label><label>Short name<input name="short_name" required placeholder="DC4"></label><label>Name<input name="name" placeholder="CDR1 East DC4"></label><label>Campus<input name="campus" placeholder="CDR E1"></label><label>Region<input name="region" placeholder="Cedar Rapids, IA"></label><label>Rate table<select name="rate_table_code">${tableOpts("")}</select></label><button class="primary">Add job</button></form>` : ""}`;
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
        body = html`<p class="muted small">The certified class comes from the employee number's prefix (FB2, FB5 and TTR are Laborer journeymen; FB7 and FB8 Carpenter journeymen) unless set here: a foreman, a general foreman, an apprentice, a superintendent, or a prefix the page does not know. Names stay on this tab; nowhere else, and never for viewers.</p>
          <table><tr><th>Employee #</th><th>Name</th><th>Certified class</th><th></th></tr>
          ${S.employees.slice().sort((a, b) => (noClass.has(b.employee_number) ? 1 : 0) - (noClass.has(a.employee_number) ? 1 : 0) || (a.employee_number < b.employee_number ? -1 : 1)).map((e) => html`<tr class="${noClass.has(e.employee_number) ? "held" : ""}"><form class="emp" data-n="${e.employee_number}"><td class="mono">${e.employee_number}</td><td>${e.name || ""}</td><td><select name="certified_class">${classOptions(e.certified_class)}</select>${!e.certified_class ? html` <span class="muted small">${L.classFromPrefix(e.employee_number) ? classLabel(L.classFromPrefix(e.employee_number)) : "no prefix default: set it"}</span>` : ""}</td><td><button>Save</button></td></form></tr>`)}</table>`;
      }
    } else if (tab === "paytypes") {
      body = html`<p class="muted small">Paid time off has hours but no billable rate; it is held for the audit, never priced. "Excluded" drops a pay type from the month entirely. Pay types not listed are rated.</p>
        <table><tr><th>Pay type name</th><th>Policy</th></tr>${S.policy.map((p) => html`<tr><td>${p.pay_type_name}</td><td>${p.policy}</td></tr>`)}</table>
        ${edit ? html`<form id="addpolicy" class="inline"><label>Pay type name<input name="pay_type_name" required></label><label>Policy<select name="policy"><option value="held_pto">held (PTO)</option><option value="excluded">excluded</option><option value="rated">rated</option></select></label><button>Set</button></form>` : ""}`;
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
    if (f("addjob")) f("addjob").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.insert("jobs", { job_number: d.job_number.trim(), short_name: d.short_name.trim(), name: d.name.trim() || null, campus: d.campus.trim() || null, region: d.region.trim() || null, rate_table_code: d.rate_table_code || null }); reload("Job added."); } catch (e) { toast(e.message); } });
    on("button.addjob", "click", async (ev) => { const b = ev.currentTarget; try { await st.db.insert("jobs", { job_number: b.dataset.job, short_name: (b.dataset.name || b.dataset.job).split(" ").slice(-1)[0], name: b.dataset.name || null, rate_table_code: L.tableForJob(b.dataset.job, st.settings.tables.map((t) => t.code)) }); reload("Job added; set its rate table so its hours price."); } catch (e) { toast(e.message); } });
    on("form.job", "submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.update("jobs", { job_number: ev.target.dataset.n }, { short_name: d.short_name.trim(), campus: d.campus.trim() || null, region: d.region.trim() || null, rate_table_code: d.rate_table_code || null, tax_bp: bp(d.tax), markup_bp: bp(d.markup), markup_base: d.markup_base }); reload("Job saved."); } catch (e) { toast(e.message); } });
    on("form.vendor", "submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.update("vendors", { vendor_key: ev.target.dataset.key }, { taxable: d.taxable === "true", liberty_owned: d.liberty_owned === "true" }); reload("Vendor saved."); } catch (e) { toast(e.message); } });
    on("select.mapjob", "change", async (ev) => { const s = ev.currentTarget; try { await st.db.mapVendorJob(s.dataset.vendor, s.dataset.ref, s.value || null); st.settings = await loadSettings(); toast(s.value ? `"${s.dataset.ref}" is ${jobName(s.value)} now.` : `"${s.dataset.ref}" is under other jobs.`); } catch (e) { toast(e.message); } });
    if (f("addrate")) f("addrate").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); const cents = C.cents(d.rate); if (!cents || cents <= 0) return toast("the rate must be money"); const cls = d.certified_class.trim().toUpperCase(); if (!cls.startsWith("#")) return toast("a certified class starts with #, as Sage writes it (#LAB-J)"); try { await st.db.insert("billable_rates", { rate_table_code: d.rate_table_code, certified_class: cls, pay_id: d.pay_id.trim().toUpperCase(), rate_cents: cents, effective: `[${d.from},${d.to || ""})`, effective_from: d.from, effective_to: d.to || null }); reload("Rate added; held hours with this key price now."); } catch (e) { toast(e.message); } });
    on("button.fillrate", "click", (ev) => { const b = ev.currentTarget, form = f("addrate"); if (!form) return; if (form.rate_table_code.value !== b.dataset.table) { location.hash = `#/settings?tab=rates&table=${encodeURIComponent(b.dataset.table)}`; st.fill = b.dataset; return; } form.certified_class.value = b.dataset.class; form.pay_id.value = b.dataset.pay; form.rate.focus(); form.scrollIntoView({ behavior: "smooth" }); });
    if (st.fill && f("addrate")) { const form = f("addrate"), d = st.fill; st.fill = null; if (form.rate_table_code.value === d.table) { form.certified_class.value = d.class; form.pay_id.value = d.pay; form.rate.focus(); } }
    on("button.retire", "click", async (ev) => { if (!confirm("Retire this rate? Hours it priced will be held until a new one is in force.")) return; try { await st.db.retireRate(ev.currentTarget.dataset.id); reload("Rate retired."); } catch (e) { toast(e.message); } });
    on("form.emp", "submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.update("employees", { employee_number: ev.target.dataset.n }, { certified_class: d.certified_class || null }); reload("Saved."); } catch (e) { toast(e.message); } });
    if (f("addpolicy")) f("addpolicy").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.upsert("pay_type_policy", [{ pay_type_name: d.pay_type_name.trim(), policy: d.policy }], "workspace_id,pay_type_name"); reload("Policy set."); } catch (e) { toast(e.message); } });
    if (f("invite")) f("invite").addEventListener("submit", async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target)); try { await st.db.insert("members", { email: d.email.trim(), role: d.role }); reload(`${d.email} invited; they sign in with that email.`); } catch (e) { toast(e.message); } });
  }

  // ---- wiring ------------------------------------------------------------------------------------------------------
  function wire() {
    const r = st.route;
    if (r.page === "update") wireUpdate();
    if (r.page === "settings") wireSettings();
    const x = $("#xlsx"); if (x) x.addEventListener("click", () => exportJob(r.parts[1], monthQ(r.q)).catch((e) => toast(e.message)));
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
  root.UI = { html, raw, mount, state: st, render, addFiles, recordAll, boot };
  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
})(typeof self !== "undefined" ? self : this);
