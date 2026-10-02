/* db.js - the page's one door to its workspace on Supabase.

   Everything the page reads comes through views (v_*), everything it
   records goes through the RPCs (begin_upload -> append -> finalize), and
   settings are plain rows under Row Level Security. Nothing here knows
   what a file looks like; that is the readers' job.

   The same interface is implemented by app/db_local.js for demo mode, so
   the page runs with nothing configured and nothing saved. */
(function (root) {
  "use strict";
  const C = root.Common, cfg = root.CostConfig;

  function Live() {
    const sb = root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    const self = { mode: "live", ws: null, role: null, user: null, workspaces: [] };
    const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };

    self.session = async () => { const { data } = await sb.auth.getSession(); self.user = data.session ? data.session.user : null; return self.user; };
    self.sendCode = async (email) => must(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
    self.verify = async (email, token) => { const d = must(await sb.auth.verifyOtp({ email, token, type: "email" })); self.user = d.user; return d.user; };
    self.signOut = async () => { await sb.auth.signOut(); self.user = null; self.ws = null; };
    self.loadWorkspaces = async () => {
      await sb.rpc("claim_membership");
      const rows = must(await sb.from("members").select("workspace_id, role, workspaces(name)").eq("user_id", self.user.id));
      self.workspaces = rows.map((r) => ({ id: r.workspace_id, role: r.role, name: r.workspaces ? r.workspaces.name : r.workspace_id }));
      return self.workspaces;
    };
    self.use = (id) => { const w = self.workspaces.find((x) => x.id === id); self.ws = w ? w.id : null; self.role = w ? w.role : null; return w; };
    self.createWorkspace = async (name) => must(await sb.rpc("create_workspace", { p_name: name }));
    self.canEdit = () => self.role === "owner" || self.role === "editor";

    /** rows of a view or table, scoped to the workspace; filters: {col: value} */
    self.view = async (name, filters = {}, opts = {}) => {
      let q = sb.from(name).select(opts.select || "*").eq("workspace_id", self.ws);
      for (const [k, v] of Object.entries(filters)) q = v == null ? q.is(k, null) : Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
      if (opts.range) { if (opts.range.from != null) q = q.gte(opts.range.col, opts.range.from); if (opts.range.to != null) q = q.lte(opts.range.col, opts.range.to); }
      if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false });
      if (opts.limit) q = q.limit(opts.limit);
      return must(await q);
    };
    self.insert = async (table, row) => must(await sb.from(table).insert(Object.assign({ workspace_id: self.ws }, row)).select());
    self.upsert = async (table, rows, onConflict) => must(await sb.from(table).upsert(rows.map((r) => Object.assign({ workspace_id: self.ws }, r)), { onConflict, ignoreDuplicates: false }).select());
    self.update = async (table, match, patch) => must(await sb.from(table).update(patch).match(Object.assign({ workspace_id: self.ws }, match)).select());
    self.remove = async (table, match) => must(await sb.from(table).delete().match(Object.assign({ workspace_id: self.ws }, match)));
    self.rpc = async (fn, args) => must(await sb.rpc(fn, args));
    self.mapVendorJob = (vendor_key, ref, job) => self.rpc("map_vendor_job", { p_workspace: self.ws, p_vendor_key: vendor_key, p_vendor_job_ref: ref, p_job_number: job || null });
    self.retireRate = (id) => self.rpc("retire_rate", { p_rate: id });

    self.existing = async (sha256) => {
      const rows = must(await sb.from("uploads").select("id, file_name, status, recorded_at, recorded_by").eq("workspace_id", self.ws).eq("sha256", "\\x" + sha256).in("status", ["recorded", "superseded"]));
      if (!rows.length) return null;
      const u = rows[0];
      return { upload_id: u.id, file_name: u.file_name, status: u.status, recorded_at: u.recorded_at, recorded_by_name: await self.memberName(u.recorded_by) };
    };
    self.memberName = async (uid) => { if (!uid) return null; const rows = must(await sb.from("members").select("display_name, email").eq("workspace_id", self.ws).eq("user_id", uid)); return rows[0] ? (rows[0].display_name || rows[0].email) : null; };

    const BATCH = 1000;
    /** A ready card -> recorded. opts: {supersede: {reason}, onProgress(fraction)} */
    self.record = async (card, opts = {}) => {
      const doc = card.doc, progress = opts.onProgress || (() => {});
      const storage_path = `ws/${self.ws}/${card.sha256}/${card.name}`;
      try { await sb.storage.from("uploads").upload(storage_path, card.bytes, { upsert: false, contentType: "application/octet-stream" }); } catch (e) { /* the bytes are optional; the lines are the record */ }
      if (doc.kind === "hh2_labor") {
        const b = await self.rpc("begin_upload", { p_workspace: self.ws, p_kind: "hh2_labor", p_sha256: card.sha256, p_file_name: card.name, p_byte_size: card.size,
          p_meta: { period: doc.range, employees: Object.keys(doc.employees), summary: { rows: doc.totals.rows, hours_x100: doc.totals.hoursX100, duplicates: doc.totals.duplicates, layout: doc.layout || "hh2", cost_given_cents: doc.totals.costGivenCents || 0 }, storage_path } });
        if (b.existing) return { status: "existing", existing: b };
        if (b.overlaps && b.overlaps.length && !(opts.supersede && opts.supersede.reason)) return { status: "needs-supersede", overlaps: b.overlaps, upload_id: b.upload_id };
        const rows = doc.rows;
        for (let i = 0; i < rows.length; i += BATCH) {
          await self.rpc("append_labor_lines", { p_upload: b.upload_id, p_rows: rows.slice(i, i + BATCH) });
          progress(Math.min(1, (i + BATCH) / rows.length) * 0.9);
        }
        const fin = await self.rpc("finalize_upload", { p_upload: b.upload_id, p_expect: { rows: doc.totals.rows, hours_x100: doc.totals.hoursX100 }, p_supersede: opts.supersede || null });
        // names go to the employees table, where only editors read them; trade and class stay for Settings
        const emp = Object.entries(doc.employees).map(([employee_number, name]) => ({ employee_number, name }));
        for (let i = 0; i < emp.length; i += BATCH) {
          await sb.from("employees").upsert(emp.slice(i, i + BATCH).map((r) => Object.assign({ workspace_id: self.ws }, r)), { onConflict: "workspace_id,employee_number", ignoreDuplicates: true });
        }
        // jobs seen on the time sheets are catalogued with their names; campus and rate table are set in Settings or by the Projects register
        const jobsSeen = Object.values(doc.byJob || {}).filter((j) => /^\d{2}-\d{2}-\d{6}$/.test(j.job_number)).map((j) => ({ job_number: j.job_number, short_name: j.job_name || j.job_number, name: j.job_name || null }));
        for (let i = 0; i < jobsSeen.length; i += BATCH) {
          try { await sb.from("jobs").upsert(jobsSeen.slice(i, i + BATCH).map((r) => Object.assign({ workspace_id: self.ws }, r)), { onConflict: "workspace_id,job_number", ignoreDuplicates: true }); } catch (e) { /* a job the table refuses waits in Settings */ }
        }
        progress(1);
        return { status: "recorded", upload: fin };
      }
      if (doc.kind === "onrent") {
        const b = await self.rpc("begin_upload", { p_workspace: self.ws, p_kind: "onrent", p_sha256: card.sha256, p_file_name: card.name, p_byte_size: card.size,
          p_meta: { vendor_key: doc.vendor_key, as_of: doc.as_of, summary: { lines: doc.totals.lines, rent_cents: doc.totals.rent_cents, layout: doc.layout }, storage_path } });
        if (b.existing) return { status: "existing", existing: b };
        const snap = { vendor_key: doc.vendor_key, layout: doc.layout, as_of: doc.as_of };
        for (let i = 0; i < doc.lines.length; i += BATCH) {
          await self.rpc("append_onrent_lines", { p_upload: b.upload_id, p_snapshot: snap, p_rows: doc.lines.slice(i, i + BATCH) });
          progress(Math.min(1, (i + BATCH) / doc.lines.length) * 0.9);
        }
        const fin = await self.rpc("finalize_upload", { p_upload: b.upload_id, p_expect: { lines: doc.totals.lines, rent_cents: doc.totals.rent_cents } });
        if (!doc.vendorKnown) await sb.from("vendors").upsert([{ workspace_id: self.ws, vendor_key: doc.vendor_key, name: doc.vendor_name }], { onConflict: "workspace_id,vendor_key", ignoreDuplicates: true });
        progress(1);
        return { status: "recorded", upload: fin };
      }
      if (doc.kind === "sage_rates") {
        const b = await self.rpc("begin_upload", { p_workspace: self.ws, p_kind: "sage_rates", p_sha256: card.sha256, p_file_name: card.name, p_byte_size: card.size,
          p_meta: { summary: { tables: doc.totals.tables, rates: doc.totals.rates }, storage_path } });
        if (b.existing) return { status: "existing", existing: b };
        const tables = doc.tables.map((t) => ({ code: t.code, description: t.description, rates: t.rates.map((r) => ({ certified_class: r.certified_class, pay_id: r.pay_id, rate_cents: r.rate_cents, effective_from: r.effective_from, effective_to: r.effective_to })) }));
        const r = await self.rpc("import_rate_tables", { p_upload: b.upload_id, p_tables: tables });
        progress(1);
        return { status: "recorded", upload: r, assigned: r.assigned || [] };
      }
      if (doc.kind === "purchase_orders") {
        const b = await self.rpc("begin_upload", { p_workspace: self.ws, p_kind: "purchase_orders", p_sha256: card.sha256, p_file_name: card.name, p_byte_size: card.size,
          p_meta: { as_of: doc.as_of, summary: { pos: doc.totals.pos, committed_cents: doc.totals.committed_cents }, storage_path } });
        if (b.existing) return { status: "existing", existing: b };
        const rows = doc.pos.map((p) => ({ row_index: p.row_index, po_number: p.po_number, order_date: p.order_date, order_type: p.order_type, supplier_code: p.supplier_code, supplier_name: p.supplier_name,
          job_number: p.job_number, description: p.description, bucket: p.bucket, cancelled: p.cancelled, quote: p.quote, committed_cents: p.committed_cents, raw: p.raw }));
        for (let i = 0; i < rows.length; i += BATCH) { await self.rpc("append_purchase_orders", { p_upload: b.upload_id, p_rows: rows.slice(i, i + BATCH) }); progress(Math.min(1, (i + BATCH) / rows.length) * 0.9); }
        const fin = await self.rpc("finalize_upload", { p_upload: b.upload_id, p_expect: { pos: doc.totals.pos, committed_cents: doc.totals.committed_cents } });
        progress(1);
        return { status: "recorded", upload: fin };
      }
      if (doc.kind === "jctd") {
        const b = await self.rpc("begin_upload", { p_workspace: self.ws, p_kind: "jctd", p_sha256: card.sha256, p_file_name: card.name, p_byte_size: card.size,
          p_meta: { period: doc.range, as_of: doc.as_of, summary: { job_number: doc.job_number, rows: doc.totals.rows, amount_cents: doc.totals.amount_cents }, storage_path } });
        if (b.existing) return { status: "existing", existing: b };
        const rows = doc.rows;
        for (let i = 0; i < rows.length; i += BATCH) { await self.rpc("append_jctd_lines", { p_upload: b.upload_id, p_rows: rows.slice(i, i + BATCH) }); progress(Math.min(1, (i + BATCH) / rows.length) * 0.9); }
        const fin = await self.rpc("finalize_upload", { p_upload: b.upload_id, p_expect: { rows: doc.totals.rows, amount_cents: doc.totals.amount_cents } });
        // payroll names go where HH2's go: the employees table, editors only
        const emp = Object.entries(doc.employees).map(([employee_number, name]) => ({ employee_number, name }));
        for (let i = 0; i < emp.length; i += BATCH) await sb.from("employees").upsert(emp.slice(i, i + BATCH).map((r) => Object.assign({ workspace_id: self.ws }, r)), { onConflict: "workspace_id,employee_number", ignoreDuplicates: true });
        progress(1);
        return { status: "recorded", upload: fin, candidates: (card.candidates || []).length };
      }
      if (doc.kind === "projects") {
        const b = await self.rpc("begin_upload", { p_workspace: self.ws, p_kind: "projects", p_sha256: card.sha256, p_file_name: card.name, p_byte_size: card.size, p_meta: { summary: { jobs: doc.totals.jobs }, storage_path } });
        if (b.existing) return { status: "existing", existing: b };
        const have = must(await sb.from("jobs").select("job_number, campus, region, name").eq("workspace_id", self.ws));
        const byNo = Object.fromEntries(have.map((j) => [j.job_number, j]));
        const fresh = doc.jobs.filter((j) => !byNo[j.job_number]).map((j) => Object.assign({ workspace_id: self.ws, job_number: j.job_number, short_name: j.short_name, name: j.name, campus: j.campus, region: j.region },
          root.Projects.taxFor(j.campus) != null ? { tax_bp: root.Projects.taxFor(j.campus) } : {}));
        if (fresh.length) must(await sb.from("jobs").insert(fresh));
        for (const j of doc.jobs) { const h = byNo[j.job_number]; if (h && ((!h.campus && j.campus) || (!h.region && j.region))) must(await sb.from("jobs").update({ campus: h.campus || j.campus, region: h.region || j.region }).match({ workspace_id: self.ws, job_number: j.job_number })); }
        const fin = await self.rpc("finalize_upload", { p_upload: b.upload_id, p_expect: {} });
        progress(1);
        return { status: "recorded", upload: fin, added: fresh.length };
      }
      throw new Error(`nothing records a ${doc.kind} yet`);
    };
    return self;
  }

  root.Db = { open: () => (cfg.mode === "live" && root.supabase ? Live() : root.DbLocal.open()) };
})(typeof self !== "undefined" ? self : this);
