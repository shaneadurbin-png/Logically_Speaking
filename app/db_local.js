/* db_local.js - DEMO MODE: the same door as app/db.js, opening onto memory.

   Nothing is saved; close the tab and it is gone. It exists so the page can
   be opened with no project configured, and so the page can be exercised
   end to end by a test. The "views" here compute, with the page's own
   models, what the database views compute in SQL. */
(function (root) {
  "use strict";
  const C = root.Common, L = root.LaborModel, R = root.RentalsModel, V = root.OnRentVendors, Rec = root.RecurringModel, P = root.Projects, SS = root.SiteServices;
  const WS = "demo-workspace";
  const uuid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));
  const JOBS = [["50-60-225121", "DC4", "CDR1 East DC4", "#225121"], ["50-60-225120", "DC5", "CDR1 East DC5", "#225120"], ["50-60-226021", "DC7", "CDR1 East DC7", "#226021"], ["50-60-225104", "Site", "CDR1 East TM (Campus)", "#225104"]];
  const RATES = [["#LAB-J", "UNION REG", 8725], ["#LAB-J", "REG", 8725], ["#LAB-J", "UNION O/T", 12000], ["#LAB-J", "O/T", 12000], ["#LAB-J", "UNION D/T", 14950], ["#LAB-J", "DOUBLETIME", 14950],
    ["#LAB-GF", "UNION REG", 10825], ["#LAB-GF", "REG", 10825], ["#LAB-GF", "UNION O/T", 14625], ["#LAB-GF", "O/T", 14625],
    ["#CARP-J", "UNION REG", 9850], ["#CARP-J", "REG", 9850], ["#CARP-J", "UNION O/T", 12750], ["#CARP-J", "O/T", 12750], ["#CARP-J", "UNION D/T", 15650], ["#CARP-J", "DOUBLETIME", 15650]];

  function open() {
    const S = {
      jobs: JOBS.map(([job_number, short_name, name, rate_table_code]) => ({ id: uuid(), workspace_id: WS, job_number, short_name, name, campus: "CDR E1", region: "Cedar Rapids, IA", rate_table_code, tax_bp: 700, markup_bp: 1000, markup_base: "rent_plus_tax", active: true })),
      vendors: V.VENDORS.map((v) => ({ id: uuid(), workspace_id: WS, vendor_key: v.vendor_key, name: v.name, feed: "onrent", taxable: v.taxable, liberty_owned: !!v.liberty_owned })),
      vendor_job_map: [["united_rentals", "CDR-SCCI-DC4", "50-60-225121"], ["united_rentals", "CDR-SCCI-DC5", "50-60-225120"], ["united_rentals", "CDR-SCCI-DC7", "50-60-226021"], ["united_rentals", "CDR-SCCI-SITE", "50-60-225104"],
        ["sunbelt", "LIBERTY - CEDAR RAPIDS LT1", "50-60-225104"], ["sunbelt", "QTS DC4", "50-60-225121"]].map(([vendor_key, vendor_job_ref, job_number]) => ({ workspace_id: WS, vendor_key, vendor_job_ref, job_number })),
      rate_tables: JOBS.map(([, , name, code]) => ({ workspace_id: WS, code, description: name + " (Iowa CBA, demo)", source_file: null })),
      billable_rates: [], employees: [], prefix_classes: Object.entries(L.PREFIX_CLASS).map(([prefix, certified_class]) => ({ workspace_id: WS, prefix, certified_class })), pay_type_policy: L.PTO_PAY_TYPES.map((p) => ({ workspace_id: WS, pay_type_name: p, policy: "held_pto" })),
      members: [{ workspace_id: WS, email: "you@demo", role: "owner", display_name: "Demo editor" }],
      uploads: [], labor: [], snapshots: [], poExports: [], purchase_decisions: [], jctd: [], recurring_charges: [], recurring_dismissals: [], audit: [],
      waste_vendors: [{ id: "wv-1", workspace_id: WS, pattern: "sourgum", name: "Sourgum Waste", bills_per_haul: true, haul_rate_cents: 68500, container_yd: 30 }, { id: "wv-2", workspace_id: WS, pattern: "waste management", name: "Waste Management", bills_per_haul: false, haul_rate_cents: null, container_yd: 40 }],
      dumpster_pulls: [],
    };
    for (const t of S.rate_tables) for (const [certified_class, pay_id, rate_cents] of RATES) S.billable_rates.push({ id: uuid(), workspace_id: WS, rate_table_code: t.code, certified_class, pay_id, rate_cents, effective_from: "2026-07-01", effective_to: null, effective: "[2026-07-01,)", retired_at: null, note: "demo" });

    const self = { mode: "demo", ws: WS, role: "owner", user: { email: "you@demo", id: "demo" }, workspaces: [{ id: WS, role: "owner", name: "Demo workspace" }] };
    self.session = async () => self.user; self.sendCode = async () => ({}); self.verify = async () => self.user; self.signOut = async () => {};
    self.loadWorkspaces = async () => self.workspaces; self.use = () => self.workspaces[0]; self.canEdit = () => true; self.memberName = async () => "Demo editor";
    const live = () => S.uploads.filter((u) => u.status === "recorded" && !u.superseded_by);
    const ctx = () => ({ rates: S.billable_rates, employees: Object.fromEntries(S.employees.map((e) => [e.employee_number, e])), prefixes: L.prefixMap(S.prefix_classes), policy: Object.fromEntries(S.pay_type_policy.map((p) => [p.pay_type_name, p.policy])), jobs: S.jobs });
    const jobMap = () => { const m = {}; for (const x of S.vendor_job_map) (m[x.vendor_key] = m[x.vendor_key] || {})[x.vendor_job_ref] = x.job_number; return m; };
    const rentalSettings = () => ({ vendors: Object.fromEntries(S.vendors.map((v) => [v.vendor_key, v])), jobs: Object.fromEntries(S.jobs.map((j) => [j.job_number, j])) });
    const priced = () => L.price(S.labor.filter((r) => live().some((u) => u.id === r.upload_id)), ctx());
    const liveSnaps = () => S.snapshots.filter((s) => live().some((u) => u.id === s.upload_id));
    const latestPo = () => { const ups = live().filter((u) => u.kind === "purchase_orders").sort((a, b) => (a.as_of < b.as_of ? 1 : -1)); return ups.length ? S.poExports.find((p) => p.upload_id === ups[0].id) : null; };
    const monthsSpanned = () => { const ms = new Set(); const now = C.monthOf(C.todayIso()); for (const s of liveSnaps()) { let m = C.monthOf(C.addDays(s.as_of, -R.GRACE_DAYS)); while (m <= now) { ms.add(m); m = C.monthOf(C.addDays(C.monthEnd(m), 1)); } } for (const r of S.labor) ms.add(C.monthOf(r.work_date)); const po = latestPo(); if (po) for (const p of po.pos) ms.add(C.monthOf(p.order_date)); return [...ms].sort(); };
    const filt = (rows, f) => rows.filter((r) => Object.entries(f).every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
    const jobKnown = (n) => S.jobs.some((j) => j.job_number === n);
    const rentalMonth = () => {
      const out = [], jm = jobMap(), rs = rentalSettings(), byVendor = {};
      for (const s of liveSnaps()) (byVendor[s.vendor_key] = byVendor[s.vendor_key] || []).push(s);
      for (const [vendor_key, snaps] of Object.entries(byVendor)) for (const month of monthsSpanned()) {
        const s = R.snapshotForMonth(snaps, month);
        if (!s) continue;
        for (const j of Object.values(R.monthCost(s, rs, jm[vendor_key] || {}))) out.push({ workspace_id: WS, vendor_key, month: month + "-01", snapshot_id: s.id, as_of: s.as_of, job_number: j.job_number, lines: j.lines, no_monthly: j.noMonthly, rent_cents: j.rent, liberty_owned_cents: j.liberty_owned_rent, tax_cents: j.tax, markup_cents: j.markup, total_cents: j.total, taxable: j.settings.taxable, tax_bp: j.settings.tax_bp, markup_bp: j.settings.markup_bp, markup_base: j.settings.markup_base });
      }
      return out;
    };
    // a decision is about the PO (its number), so it holds through the next export, as in app.purchase_docs_resolved
    // ... and about one ORDER: it carries by number and OrderID, so a number shared by two orders is decided one order at a time
    const decisionFor = (po_number, order_id) => S.purchase_decisions.filter((x) => x.doc_number === po_number && (x.order_id || "") === (order_id || "") && x.line_id == null).sort((a, b) => (a.decided_at < b.decided_at ? 1 : a.decided_at > b.decided_at ? -1 : b.id - a.id))[0] || null;
    const purchaseDocs = () => { const po = latestPo(); if (!po) return []; const byNumber = {}; for (const p of po.pos) byNumber[p.po_number] = (byNumber[p.po_number] || 0) + 1;
      return po.pos.map((p) => { const dd = decisionFor(p.po_number, p.order_id); const job_number = (dd && dd.job_number) || p.job_number, bucket = (dd && dd.bucket) || p.bucket, known = jobKnown(job_number), shared = byNumber[p.po_number];
      const status = p.cancelled || p.quote ? "excluded" : dd && dd.decision === "exclude" ? "excluded" : p.committed_cents == null ? "needs_decision" : dd && (dd.decision === "assign" || dd.decision === "confirm") ? "confirmed" : shared > 1 ? "needs_decision" : !known ? "needs_decision" : "auto";
      return { id: po.upload_id + ":" + p.po_number + ":" + (p.order_id || "") + ":" + p.row_index, workspace_id: WS, upload_id: po.upload_id, source: "drop", direction: "cost", vendor_key: p.supplier_code, vendor_name_raw: p.supplier_name, doc_kind: "purchase_order", doc_number: p.po_number, doc_date: p.order_date, description: p.description, order_type: p.order_type, cancelled: p.cancelled, quote: p.quote, total_cents: p.committed_cents, job_number, cost_code: null, bucket, job_known: known, status, shared_number: shared, order_id: p.order_id || null }; }); };
    // the latest recorded JCTD per job stands for all of it
    const liveJctd = () => { const latest = {}; for (const u of live().filter((x) => x.kind === "jctd")) { const j = u.summary.job_number; if (!latest[j] || u.as_of > latest[j].as_of || (u.as_of === latest[j].as_of && u.recorded_at > latest[j].recorded_at)) latest[j] = u; } const ids = new Set(Object.values(latest).map((u) => u.id)); return S.jctd.filter((l) => ids.has(l.upload_id)); };
    const onFeed = (name) => !!V.vendorFromText(name);
    const isWaste = (name) => !!SS.wasteVendorFor(S.waste_vendors, name);
    const recurringCandidates = () => Rec.candidates(liveJctd(), { onFeed, exclude: isWaste }).filter((c) => !S.recurring_charges.some((r) => r.job_number === c.job_number && r.candidate_key === c.key) && !S.recurring_dismissals.some((d) => d.job_number === c.job_number && d.candidate_key === c.key)).map((c) => Object.assign({ workspace_id: WS }, c));
    const recurringMonth = () => { const out = [], now = C.monthOf(C.todayIso()); for (const r of S.recurring_charges) { const job = S.jobs.find((j) => j.job_number === r.job_number); let m = C.monthOf(r.start_month); const end = r.end_month ? C.monthOf(r.end_month) : now; while (m <= end && m <= now) { const c = Rec.monthCost(r, job); out.push({ workspace_id: WS, job_number: r.job_number, month: m + "-01", charge_id: r.id, candidate_key: r.candidate_key, vendor_code: r.vendor_code, vendor_name: r.vendor_name, description: r.description, cost_code: r.cost_code, units: r.units, liberty_owned: r.liberty_owned, amount_includes_tax: r.amount_includes_tax, start_month: r.start_month, end_month: r.end_month, source: r.source, rent_cents: c.rent, tax_cents: c.tax, markup_cents: c.markup, total_cents: c.total }); m = C.monthOf(C.addDays(C.monthEnd(m), 1)); } } return out; };
    // the lines of the snapshot that stands for each vendor and month, with their job: what the site-services views read
    const rentalMonthLines = () => { const out = [], jm = jobMap(), byVendor = {}; for (const s of liveSnaps()) (byVendor[s.vendor_key] = byVendor[s.vendor_key] || []).push(s);
      for (const [vendor_key, snaps] of Object.entries(byVendor)) for (const month of monthsSpanned()) { const s = R.snapshotForMonth(snaps, month); if (!s) continue; for (const l of s.lines) out.push(Object.assign({ workspace_id: WS, vendor_key, month: month + "-01", as_of: s.as_of, job_number: (jm[vendor_key] || {})[l.vendor_job_ref] || "unmapped" }, l)); }
      return out; };
    const byJobMonthVendor = (lines) => { const g = {}; for (const l of lines) { const k = [l.job_number, l.month, l.vendor_key].join("|"); (g[k] = g[k] || []).push(l); } return g; };
    const siteServicesMonth = () => { const out = []; for (const [k, ls] of Object.entries(byJobMonthVendor(rentalMonthLines()))) { const [job_number, month, vendor_key] = k.split("|"); for (const r of SS.viewRows(ls)) out.push(Object.assign({ workspace_id: WS, job_number, month, vendor_key }, r)); } return out; };
    const trailerPlexMonth = () => { const out = []; for (const [k, ls] of Object.entries(byJobMonthVendor(rentalMonthLines()))) { const [job_number, month, vendor_key] = k.split("|"); for (const r of SS.plexRows(ls)) out.push(Object.assign({ workspace_id: WS, job_number, month }, r, { vendor_key })); } return out; };
    const dumpsterMonth = () => SS.dumpsterMonth(liveJctd(), S.dumpster_pulls, S.waste_vendors).map((r) => ({ workspace_id: WS, job_number: r.job_number, month: r.month + "-01", waste_vendor_id: r.vendor_key.startsWith("wv:") ? r.vendor_key.slice(3) : null, vendor_name: r.vendor_name, source: r.source, pulls: r.pulls, entries: r.entries, haul_lines: r.haul_lines, ledger_lines: r.ledger_lines, ledger_cents: r.ledger_cents, log_cost_cents: r.log_cost_cents, tonnage: r.tonnage || null, container_yd: r.container_yd }));
    const VIEWS = {
      waste_vendors: () => S.waste_vendors, dumpster_pulls: () => S.dumpster_pulls, v_site_services_month: siteServicesMonth, v_trailer_plex_month: trailerPlexMonth, v_dumpster_month: dumpsterMonth,
      jctd_lines: liveJctd, recurring_charges: () => S.recurring_charges, recurring_dismissals: () => S.recurring_dismissals, v_recurring_candidates: recurringCandidates, v_recurring_month: recurringMonth,
      jobs: () => S.jobs, vendors: () => S.vendors, vendor_job_map: () => S.vendor_job_map, rate_tables: () => S.rate_tables, billable_rates: () => S.billable_rates, employees: () => S.employees, prefix_classes: () => S.prefix_classes,
      pay_type_policy: () => S.pay_type_policy, members: () => S.members, uploads: () => S.uploads, audit_log: () => S.audit, purchase_decisions: () => S.purchase_decisions, v_uploads_live: live,
      v_labor_priced: () => priced().map((r) => Object.assign({ workspace_id: WS, hours: r.hours_x100 / 100 }, r)),
      v_labor_job_month: () => { const m = {}; for (const r of priced()) { const k = r.job_number + "|" + C.monthOf(r.work_date); const g = m[k] || (m[k] = { workspace_id: WS, job_number: r.job_number, month: C.monthOf(r.work_date) + "-01", rows_n: 0, hours: 0, priced_hours: 0, cost_cents: 0, held_hours: 0, held_rows: 0, through: null }); g.rows_n++; g.hours += r.hours_x100 / 100; if (r.status === "priced") { g.priced_hours += r.hours_x100 / 100; g.cost_cents += r.cost_cents; } if (r.status.startsWith("held:")) { g.held_hours += r.hours_x100 / 100; g.held_rows++; } if (!g.through || r.work_date > g.through) g.through = r.work_date; } return Object.values(m); },
      v_labor_class_month: () => { const m = {}; for (const r of priced()) { const k = [r.job_number, C.monthOf(r.work_date), r.certified_class, r.pay_type, r.status].join("|"); const g = m[k] || (m[k] = { workspace_id: WS, job_number: r.job_number, month: C.monthOf(r.work_date) + "-01", certified_class: r.certified_class, pay_id: r.pay_type, pay_type_name: r.pay_type_name, status: r.status, rows_n: 0, hours: 0, cost_cents: 0, rate_cents: r.rate_cents }); g.rows_n++; g.hours += r.hours_x100 / 100; g.cost_cents += r.cost_cents || 0; } return Object.values(m); },
      v_labor_held: () => { const m = {}; for (const r of priced()) if (r.status.startsWith("held:")) { const k = [r.job_number, r.status, r.certified_class, r.pay_type, r.employee_number].join("|"); const g = m[k] || (m[k] = { workspace_id: WS, job_number: r.job_number, job_name: r.job_name, rate_table_code: r.rate_table_code, status: r.status, certified_class: r.certified_class, pay_id: r.pay_type, pay_type_name: r.pay_type_name, employee_number: r.employee_number, rows_n: 0, hours: 0, first_day: r.work_date, last_day: r.work_date }); g.rows_n++; g.hours += r.hours_x100 / 100; if (r.work_date < g.first_day) g.first_day = r.work_date; if (r.work_date > g.last_day) g.last_day = r.work_date; } return Object.values(m); },
      v_rental_month: rentalMonth,
      v_rental_items: () => { const jm = jobMap(), items = {}; const snaps = liveSnaps().slice().sort((a, b) => (a.as_of < b.as_of ? -1 : 1)); for (const s of snaps) for (const l of s.lines) { const k = R.identity(s.vendor_key, l); const it = items[k] || (items[k] = { workspace_id: WS, vendor_key: s.vendor_key, equipment_no: l.equipment_no, contract_no: l.contract_no, vendor_job_ref: l.vendor_job_ref, seq: l.seq || 1, first_seen: s.as_of, last_seen: s.as_of, snapshots: 0, job_number: (jm[s.vendor_key] || {})[l.vendor_job_ref] || null, off_rent_date: null }); it.snapshots++; it.last_seen = s.as_of; Object.assign(it, { description: l.description, qty: l.qty, on_rent_date: l.on_rent_date, rate_period: l.rate_period, rate_cents: l.rate_cents, monthly_rent_cents: l.monthly_rent_cents, liberty_owned: l.liberty_owned, po: l.po, line_ref: l.line_ref, raw: l.raw }); } for (const it of Object.values(items)) { const later = snaps.filter((s) => s.vendor_key === it.vendor_key && s.as_of > it.last_seen); if (later.length) it.off_rent_date = later[0].as_of; } return Object.values(items); },
      v_purchase_docs: purchaseDocs,
      v_purchase_month: () => { const m = {}; for (const d of purchaseDocs()) { const k = [d.job_number, C.monthOf(d.doc_date), d.bucket, d.status, d.order_type].join("|"); const g = m[k] || (m[k] = { workspace_id: WS, job_number: d.job_number, month: C.monthOf(d.doc_date) + "-01", bucket: d.bucket, status: d.status, direction: "cost", order_type: d.order_type, lines: 0, amount_cents: 0 }); g.lines++; g.amount_cents += d.total_cents || 0; } return Object.values(m); },
      v_job_month: () => { const m = {}; const g = (job, month) => m[job + "|" + month] || (m[job + "|" + month] = { workspace_id: WS, job_number: job, month, labor_cents: 0, labor_hours: 0, labor_held_hours: 0, labor_held_rows: 0, labor_through: null, rental_cents: 0, rental_lo_cents: 0, rental_lines: 0, rental_no_monthly: 0, rental_as_of: null, offfeed_cents: 0, offfeed_lines: 0, purchase_cents: 0, purchase_rental_cents: 0, purchase_nb_cents: 0, pending_cents: 0, pending_lines: 0, total_cents: 0 });
        for (const o of recurringMonth()) { const x = g(o.job_number, o.month); x.offfeed_cents += o.total_cents; x.offfeed_lines++; }
        for (const l of VIEWS.v_labor_job_month()) { const x = g(l.job_number, l.month); Object.assign(x, { labor_cents: l.cost_cents, labor_hours: l.hours, labor_held_hours: l.held_hours, labor_held_rows: l.held_rows, labor_through: l.through }); }
        for (const r of rentalMonth()) if (r.job_number !== "unmapped") { const x = g(r.job_number, r.month); x.rental_cents += r.total_cents; x.rental_lo_cents += r.liberty_owned_cents; x.rental_lines += r.lines; x.rental_no_monthly += r.no_monthly; if (!x.rental_as_of || r.as_of > x.rental_as_of) x.rental_as_of = r.as_of; }
        for (const p of VIEWS.v_purchase_month()) { const x = g(p.job_number, p.month); if (p.status === "auto" || p.status === "confirmed") { if (p.order_type === "Rental") x.purchase_rental_cents += p.amount_cents; else { x.purchase_cents += p.amount_cents; if (p.bucket === "NON_BILLABLE") x.purchase_nb_cents += p.amount_cents; } } else if (p.status === "needs_decision") { x.pending_cents += p.amount_cents; x.pending_lines += p.lines; } }
        for (const x of Object.values(m)) x.total_cents = x.labor_cents + x.rental_cents + x.rental_lo_cents + x.offfeed_cents + x.purchase_cents; return Object.values(m); },
      v_month_buckets: () => VIEWS.v_job_month().flatMap((x) => [{ workspace_id: WS, job_number: x.job_number, month: x.month, bucket: "LABOR", cents: x.labor_cents }, { workspace_id: WS, job_number: x.job_number, month: x.month, bucket: "EQUIPMENT", cents: x.rental_cents + x.offfeed_cents }, { workspace_id: WS, job_number: x.job_number, month: x.month, bucket: "MATERIALS", cents: x.purchase_cents - x.purchase_nb_cents }, { workspace_id: WS, job_number: x.job_number, month: x.month, bucket: "NON_BILLABLE", cents: x.purchase_nb_cents }]),
      v_freshness: () => { const hh2 = live().filter((u) => u.kind === "hh2_labor"), jc = live().filter((u) => u.kind === "jctd"); const on = {}; for (const s of liveSnaps()) if (!on[s.vendor_key] || s.as_of > on[s.vendor_key]) on[s.vendor_key] = s.as_of; const po = latestPo(); return [{ workspace_id: WS, hh2_through: hh2.length ? hh2.map((u) => u.period_end).sort().pop() : null, hh2_recorded_at: hh2.length ? hh2.map((u) => u.recorded_at).sort().pop() : null, onrent_as_of: on, po_as_of: po ? po.as_of : null, last_inbox_at: null, inbox_pending: 0, uploads_live: live().length, jctd_through: jc.length ? jc.map((u) => u.period_end).sort().pop() : null, jctd_jobs: new Set(jc.map((u) => u.summary.job_number)).size }]; },
    };
    self.view = async (name, filters = {}, opts = {}) => { if (!VIEWS[name]) throw new Error("no view " + name); let rows = filt(VIEWS[name](), filters); if (opts.range) rows = rows.filter((r) => (opts.range.from == null || r[opts.range.col] >= opts.range.from) && (opts.range.to == null || r[opts.range.col] <= opts.range.to)); if (opts.order) rows = rows.slice().sort((a, b) => (a[opts.order] < b[opts.order] ? -1 : a[opts.order] > b[opts.order] ? 1 : 0) * (opts.ascending === false ? -1 : 1)); if (opts.limit) rows = rows.slice(0, opts.limit); return rows; };
    const log = (table, op, row) => S.audit.push({ id: S.audit.length + 1, workspace_id: WS, table_name: table, op, after: row, actor_email: "you@demo", at: new Date().toISOString() });
    self.insert = async (table, row) => { const r = Object.assign({ id: uuid(), workspace_id: WS }, row); if (table === "billable_rates" && !r.effective_from) r.effective_from = null;
      if (table === "purchase_decisions") { const parts = String(r.doc_id).split(":"); Object.assign(r, { id: S.purchase_decisions.length + 1, doc_number: parts[1], order_id: parts[2] || null, line_id: null, decided_by: "demo", decided_at: new Date().toISOString() }); }
      if (table === "recurring_charges") { if (r.monthly_cents < 0 || !r.start_month || (r.end_month && r.end_month < r.start_month)) throw new Error("a recurring charge needs an amount and a first month before its last"); Object.assign(r, { units: r.units || 1, liberty_owned: !!r.liberty_owned, amount_includes_tax: r.amount_includes_tax !== false, source: r.source || "jctd", confirmed_by: "demo", confirmed_at: new Date().toISOString() }); }
      if (table === "recurring_dismissals") { if (!r.reason) throw new Error("say why it is not a rental"); Object.assign(r, { decided_by: "demo", decided_at: new Date().toISOString() }); }
      if (table === "dumpster_pulls") { if (!r.job_number || !r.pull_date || !r.vendor_name || !(+r.pulls > 0)) throw new Error("a pull needs a job, a date, a hauler and a count"); Object.assign(r, { pulls: +r.pulls, entered_by: "demo", entered_at: new Date().toISOString() }); }
      if (table === "prefix_classes") { r.prefix = String(r.prefix || "").trim().toUpperCase(); if (!r.prefix) throw new Error("say the prefix: the first letters of the employee number"); if (!r.certified_class) throw new Error("pick the class"); if (S.prefix_classes.some((p) => p.prefix === r.prefix)) throw new Error(`${r.prefix} is already listed; change it there`); }
      if (table === "waste_vendors") { if (!r.pattern) throw new Error("say what to match in the hauler's name"); if (S.waste_vendors.some((w) => w.pattern.toLowerCase() === String(r.pattern).toLowerCase())) throw new Error("that hauler is already listed"); r.pattern = String(r.pattern).toLowerCase(); }
      S[table].push(r); log(table, "INSERT", r); return [r]; };
    self.upsert = async (table, rows, onConflict) => { const keys = onConflict.split(",").map((k) => k.trim()).filter((k) => k !== "workspace_id"); const out = []; for (const row of rows) { const ex = S[table].find((x) => keys.every((k) => x[k] === row[k])); if (ex) Object.assign(ex, row); else S[table].push(Object.assign({ id: uuid(), workspace_id: WS }, row)); out.push(ex || row); log(table, ex ? "UPDATE" : "INSERT", row); } return out; };
    self.update = async (table, match, patch) => { const rows = filt(S[table], match); rows.forEach((r) => { Object.assign(r, patch); log(table, "UPDATE", r); }); return rows; };
    self.remove = async (table, match) => { const rows = filt(S[table], match); S[table] = S[table].filter((r) => !rows.includes(r)); rows.forEach((r) => log(table, "DELETE", r)); return rows; };
    self.mapVendorJob = async (vendor_key, ref, job) => { S.vendor_job_map = S.vendor_job_map.filter((x) => !(x.vendor_key === vendor_key && x.vendor_job_ref === ref)); if (job) S.vendor_job_map.push({ workspace_id: WS, vendor_key, vendor_job_ref: ref, job_number: job }); log("vendor_job_map", "UPSERT", { vendor_key, ref, job }); };
    self.retireRate = async (id) => { const r = S.billable_rates.find((x) => x.id === id); if (r) { r.retired_at = new Date().toISOString(); log("billable_rates", "RETIRE", r); } };
    self.rpc = async () => { throw new Error("no RPCs in demo mode"); };
    self.existing = async (sha) => { const u = S.uploads.find((x) => x.sha256 === sha && x.status !== "pending"); return u ? { upload_id: u.id, file_name: u.file_name, status: u.status, recorded_at: u.recorded_at, recorded_by_name: "Demo editor" } : null; };
    self.record = async (card, opts = {}) => {
      const doc = card.doc;
      const was = await self.existing(card.sha256);
      if (was) return { status: "existing", existing: was };
      const u = { id: uuid(), workspace_id: WS, kind: doc.kind, sha256: card.sha256, file_name: card.name, byte_size: card.size, status: "recorded", recorded_at: new Date().toISOString(), recorded_by_name: "Demo editor", summary: {}, superseded_by: null };
      const extra = {};
      if (doc.kind === "hh2_labor") {
        u.period_start = doc.range.start; u.period_end = doc.range.end; u.summary = { rows: doc.totals.rows, hours_x100: doc.totals.hoursX100 };
        const mine = new Set(Object.keys(doc.employees));
        const overlaps = live().filter((x) => x.kind === "hh2_labor" && !(x.period_end < doc.range.start || x.period_start > doc.range.end) && S.labor.some((r) => r.upload_id === x.id && mine.has(r.employee_number)));
        if (overlaps.length && !(opts.supersede && opts.supersede.reason)) return { status: "needs-supersede", overlaps: overlaps.map((x) => ({ upload_id: x.id, file_name: x.file_name, period_start: x.period_start, period_end: x.period_end, rows: x.summary.rows })) };
        for (const o of overlaps) { o.status = "superseded"; o.superseded_by = u.id; o.supersede_reason = opts.supersede.reason; }
        for (const r of doc.rows) S.labor.push(Object.assign({ upload_id: u.id }, r));
        // jobs seen on the time sheets are catalogued with their names
        for (const j of Object.values(doc.byJob || {})) if (/^\d{2}-\d{2}-\d{6}$/.test(j.job_number) && !S.jobs.some((x) => x.job_number === j.job_number)) {
          S.jobs.push({ workspace_id: WS, job_number: j.job_number, short_name: j.job_name || j.job_number, name: j.job_name || null, campus: null, region: null, rate_table_code: null, tax_bp: 700, markup_bp: 1000, markup_base: "rent_plus_tax", active: true });
          extra.jobs_added = (extra.jobs_added || 0) + 1;
        }
        for (const [employee_number, name] of Object.entries(doc.employees)) if (!S.employees.some((e) => e.employee_number === employee_number)) S.employees.push({ workspace_id: WS, employee_number, name, certified_class: null });
      } else if (doc.kind === "onrent") {
        u.vendor_key = doc.vendor_key; u.as_of = doc.as_of; u.summary = { lines: doc.totals.lines, rent_cents: doc.totals.rent_cents };
        S.snapshots.push({ id: uuid(), upload_id: u.id, vendor_key: doc.vendor_key, layout: doc.layout, as_of: doc.as_of, lines: doc.lines, line_count: doc.totals.lines, rent_cents: doc.totals.rent_cents });
        if (!S.vendors.some((v) => v.vendor_key === doc.vendor_key)) S.vendors.push({ id: uuid(), workspace_id: WS, vendor_key: doc.vendor_key, name: doc.vendor_name, feed: "onrent", taxable: true, liberty_owned: false });
      } else if (doc.kind === "sage_rates") {
        u.summary = { tables: doc.totals.tables, rates: doc.totals.rates };
        let inserted = 0, skipped = 0, retired = 0; const assigned = [];
        for (const t of doc.tables) {
          const ex = S.rate_tables.find((x) => x.code === t.code); if (ex) Object.assign(ex, { description: t.description || ex.description, source_file: card.name }); else S.rate_tables.push({ workspace_id: WS, code: t.code, description: t.description, source_file: card.name });
          for (const r of t.rates) {
            const same = S.billable_rates.find((x) => !x.retired_at && x.rate_table_code === t.code && x.certified_class === r.certified_class && x.pay_id === r.pay_id && x.effective_from === r.effective_from && x.effective_to === r.effective_to && x.rate_cents === r.rate_cents);
            if (same) { skipped++; continue; }
            for (const x of S.billable_rates) if (!x.retired_at && x.rate_table_code === t.code && x.certified_class === r.certified_class && x.pay_id === r.pay_id && (x.effective_to == null || x.effective_to > r.effective_from) && (r.effective_to == null || r.effective_to > (x.effective_from || ""))) { x.retired_at = new Date().toISOString(); retired++; }
            S.billable_rates.push({ id: uuid(), workspace_id: WS, rate_table_code: t.code, certified_class: r.certified_class, pay_id: r.pay_id, rate_cents: r.rate_cents, effective_from: r.effective_from, effective_to: r.effective_to, retired_at: null, note: "from " + card.name }); inserted++;
          }
        }
        const codes = doc.tables.map((t) => t.code);
        for (const j of S.jobs) if (!j.rate_table_code) { const c = L.tableForJob(j.job_number, codes); if (c) { j.rate_table_code = c; assigned.push({ job_number: j.job_number, rate_table_code: c }); } }
        Object.assign(extra, { inserted, skipped, retired, assigned });
      } else if (doc.kind === "purchase_orders") {
        u.as_of = doc.as_of; u.summary = { pos: doc.totals.pos, committed_cents: doc.totals.committed_cents };
        S.poExports.push({ upload_id: u.id, as_of: doc.as_of, pos: doc.pos });
      } else if (doc.kind === "jctd") {
        u.period_start = doc.range.start; u.period_end = doc.range.end; u.as_of = doc.as_of; u.summary = { job_number: doc.job_number, rows: doc.totals.rows, amount_cents: doc.totals.amount_cents };
        for (const r of doc.rows) S.jctd.push(Object.assign({ upload_id: u.id }, r));
        for (const [employee_number, name] of Object.entries(doc.employees)) if (!S.employees.some((e) => e.employee_number === employee_number)) S.employees.push({ workspace_id: WS, employee_number, name, certified_class: null });
        extra.candidates = (card.candidates || []).length;
      } else if (doc.kind === "projects") {
        u.summary = { jobs: doc.totals.jobs }; let added = 0;
        for (const j of doc.jobs) { const h = S.jobs.find((x) => x.job_number === j.job_number); if (!h) { const tax = P.taxFor(j.campus); S.jobs.push({ id: uuid(), workspace_id: WS, job_number: j.job_number, short_name: j.short_name, name: j.name, campus: j.campus, region: j.region, rate_table_code: null, tax_bp: tax == null ? 700 : tax, markup_bp: 1000, markup_base: "rent_plus_tax", active: true }); added++; } else { if (!h.campus && j.campus) h.campus = j.campus; if (!h.region && j.region) h.region = j.region; } }
        extra.added = added;
      } else throw new Error(`nothing records a ${doc.kind} yet`);
      S.uploads.push(u);
      if (opts.onProgress) opts.onProgress(1);
      return Object.assign({ status: "recorded", upload: { upload_id: u.id, file_name: u.file_name, status: "recorded" } }, extra);
    };
    self._state = S;
    return self;
  }
  root.DbLocal = { open };
})(typeof self !== "undefined" ? self : this);
