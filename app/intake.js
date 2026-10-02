/* intake.js - a drop, file by file: what each one is, what it says, and the
   card the Update page shows for it. Nothing in a drop is skipped in
   silence: every file gets a card, and a refusal says why.

   The readers are the page's own (hh2.js, onrent.js); the context the page
   passes in (rates, settings, the job map, what is already on file) is what
   lets a card say "60 rows, 410 hours, 9 held" or "already on file, recorded
   by Shane on Sep 30" before anything is written. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./common.js"), require("./sniff.js"), require("./hh2.js"), require("./onrent.js"),
      require("./labor_model.js"), require("./rentals_model.js"), require("./sage_rates.js"), require("./billable_sheets.js"), require("./purchase_pro.js"), require("./projects.js"),
      require("./jctd.js"), require("./recurring_model.js"), require("./onrent_vendors.js"), require("./site_services.js"));
  } else root.Intake = factory(root.Common, root.Sniff, root.HH2, root.OnRent, root.LaborModel, root.RentalsModel, root.SageRates, root.BillableSheets, root.PurchasePro, root.Projects, root.JCTD, root.RecurringModel, root.OnRentVendors, root.SiteServices);
}(typeof self !== "undefined" ? self : this, function (C, Sniff, HH2, OnRent, L, R, Sage, Billable, PO, Projects, JCTD, Rec, V, SS) {
  "use strict";

  // ---- the zip: read from its directory, inflate only what is asked for -----
  async function inflateRaw(u8) {
    if (typeof DecompressionStream !== "undefined") {
      const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    if (typeof require === "function") return new Uint8Array(require("zlib").inflateRawSync(u8));
    throw new C.UnknownFormat("this browser cannot open zip files; use Chrome or Edge.");
  }
  function unzip(data) {
    const u8 = C.toU8(data);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new C.UnknownFormat("not a zip file (no zip directory found).");
    let n = dv.getUint16(eocd + 10, true), off = dv.getUint32(eocd + 16, true);
    if (n === 0xffff || off === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || dv.getUint32(loc, true) !== 0x07064b50) throw new C.UnknownFormat("the zip directory is damaged.");
      const z = Number(dv.getBigUint64(loc + 8, true));
      if (dv.getUint32(z, true) !== 0x06064b50) throw new C.UnknownFormat("the zip directory is damaged.");
      n = Number(dv.getBigUint64(z + 32, true)); off = Number(dv.getBigUint64(z + 48, true));
    }
    const out = [];
    let p = off;
    for (let k = 0; k < n; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new C.UnknownFormat("the zip directory is damaged.");
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      let csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      let lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder(flags & 0x800 ? "utf-8" : "latin1").decode(u8.subarray(p + 46, p + 46 + nl));
      for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + xl;) {
        const id = dv.getUint16(x, true), len = dv.getUint16(x + 2, true);
        if (id === 1) {
          let q = x + 4;
          if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
          if (lho === 0xffffffff) lho = Number(dv.getBigUint64(q, true));
        }
        x += 4 + len;
      }
      p += 46 + nl + xl + cl;
      if (name.endsWith("/")) continue;
      const entry = { path: name, name: name.split("/").pop(), size: usize };
      entry.read = async () => {
        if (flags & 1) throw new C.UnknownFormat(`${entry.name} is password-protected inside the zip.`);
        if (dv.getUint32(lho, true) !== 0x04034b50) throw new C.UnknownFormat(`${entry.name}: the zip entry is damaged.`);
        const s = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        const raw = u8.subarray(s, s + csize);
        if (method === 0) return raw.slice();
        if (method === 8) return inflateRaw(raw);
        throw new C.UnknownFormat(`${entry.name} is compressed with a method this page cannot open (${method}).`);
      };
      out.push(entry);
    }
    return out;
  }

  // ---- one file -> one card ------------------------------------------------------
  function hh2Card(card, doc, ctx) {
    const lab = ctx.labor || {};
    const priced = L.price(doc.rows, { rates: lab.rates || [], employees: lab.employees || {}, policy: lab.policy || {}, jobs: lab.jobs || [], prefixes: lab.prefixes });
    const summary = L.summarize(priced);
    const weekly = doc.layout === "weeklycostdata", t = doc.totals;
    const known = new Set((lab.jobs || []).map((j) => j.job_number));
    const newJobs = Object.values(doc.byJob || {}).filter((j) => !known.has(j.job_number));
    Object.assign(card, {
      status: "ready", doc, priced, summary, stamp: L.stamp(summary),
      period: doc.range, title: weekly ? `Labor history from the weekly cost workbook, ${C.fmtDay(doc.range.start)} to ${C.fmtDay(doc.range.end)}` : `HH2 labor, ${C.fmtDay(doc.range.start)} to ${C.fmtDay(doc.range.end)}`,
      notes: [].concat(
        weekly ? [`${C.fmtInt(t.rowsGiven)} rows carry the workbook's own labor cost (${C.fmtMoney(t.costGivenCents)}) and are taken as priced; the weekly HH2 files add to this baseline`] : [],
        weekly && t.auditRows ? [`${C.fmtInt(t.auditRows)} rows from the Labor Audit sheet (PTO and unmatched) are held by the page's own rules`] : [],
        weekly && Object.keys(t.classes || {}).length ? [`classes as the workbook carried them stay on these rows: ${Object.entries(t.classes).map(([c, n]) => `${L.classLabel(c)} ${C.fmtInt(n)}`).join(", ")}${t.noClass ? `; ${t.noClass} rows with a trade or class the page does not know take the person's class` : ""}`] : [],
        newJobs.length ? [`${newJobs.length} job${newJobs.length > 1 ? "s" : ""} not in Settings (${newJobs.slice(0, 5).map((j) => `${j.job_number}${j.job_name ? " " + j.job_name : ""}`).join(", ")}${newJobs.length > 5 ? ", ..." : ""}); added with their names on Record, campus and rate table to be set`] : [],
        doc.totals.duplicates ? [`${doc.totals.duplicates} exact duplicate row${doc.totals.duplicates > 1 ? "s" : ""} kept (${weekly ? "the workbook's own split entries" : "HH2 writes real split entries"})`] : [],
        doc.rangeSource === "data" && !weekly ? ["the name carries no range; the rows' own dates are used"] : [],
        doc.nameConflicts.length ? [`${doc.nameConflicts.length} employee number${doc.nameConflicts.length > 1 ? "s" : ""} carr${doc.nameConflicts.length > 1 ? "y" : "ies"} two names`] : []),
      conservation: { rows: doc.totals.rows, hours_x100: doc.totals.hoursX100 },
    });
  }
  function sageCard(card, doc, ctx) {
    const jobs = (ctx.labor && ctx.labor.jobs) || [];
    const codes = doc.tables.map((t) => t.code);
    const matched = {};
    for (const j of jobs) { const c = L.tableForJob(j.job_number, codes); if (c) (matched[c] = matched[c] || []).push(j.job_number); }
    Object.assign(card, {
      status: "ready", doc, stamp: `${doc.totals.tables} rate table${doc.totals.tables > 1 ? "s" : ""}, ${doc.totals.rates} rates`,
      title: `Sage rate tables: ${doc.tables.map((t) => t.code).join(", ")}`, matched,
      notes: doc.tables.map((t) => `${t.code} ${t.description}: ${t.rates.length} rates, ${t.classes.length} classes, in force from ${t.effectiveDates.map(C.fmtDay).join(", ")}` +
        (matched[t.code] ? `; job ${matched[t.code].join(", ")}` : "; no job in Settings carries this number, assign it there"))
        .concat(doc.totals.skipped ? [`${doc.totals.skipped} catch-all row${doc.totals.skipped > 1 ? "s" : ""} (class or pay ID "*", non-billable) left out`] : [])
        .concat(doc.notes || []),
      conservation: { rates: doc.totals.rates },
    });
  }
  function poCard(card, doc, ctx) {
    const known = new Set(((ctx.labor && ctx.labor.jobs) || []).map((j) => j.job_number));
    const unknown = doc.totals.jobs.filter((j) => !known.has(j));
    const t = doc.totals;
    Object.assign(card, {
      status: "ready", doc, title: `Purchase Pro POs, as of ${C.fmtDay(doc.as_of)}`,
      stamp: `${C.fmtInt(t.pos)} POs, ${C.fmtMoney(t.committed_cents)} committed`,
      notes: [
        `${t.counted} counted (${Object.entries(t.byType).map(([k, v]) => `${k.toLowerCase()} ${C.fmtMoney(v)}`).join(", ")})` +
          (t.cancelled ? `; ${t.cancelled} cancelled` : "") + (t.quotes ? `; ${t.quotes} quote${t.quotes > 1 ? "s" : ""}` : "") + (t.noAmount ? `; ${t.noAmount} with no committed amount yet (pending)` : ""),
        doc.asOfSource === "latest order" ? `as-of taken as the latest order date, ${C.fmtDay(doc.as_of)}; put the export date in the file name to say otherwise` : `as-of ${C.fmtDay(doc.as_of)} (${doc.asOfSource})`,
        `the whole export stands for every PO: recording it replaces the last PO export on file`,
      ].concat(unknown.length ? [`${unknown.length} job${unknown.length > 1 ? "s" : ""} in the POs ${unknown.length > 1 ? "are" : "is"} not in Settings (${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? ", ..." : ""}); their POs wait for a decision`] : [],
        t.noJob ? [`${t.noJob} PO${t.noJob > 1 ? "s carry" : " carries"} no job${t.noJobCounted ? `; ${t.noJobCounted} of them ${t.noJobCounted > 1 ? "are" : "is"} a live order and waits for a decision` : " (quotes and cancelled orders, left out anyway)"}`] : [],
        t.sharedNumbers && t.sharedNumbers.length ? [`${t.sharedNumbers.length} PO number${t.sharedNumbers.length > 1 ? "s are" : " is"} on more than one order (${t.sharedNumbers.slice(0, 3).map((s) => `${s.po_number} on ${s.orders}`).join(", ")}${t.sharedNumbers.length > 3 ? ", ..." : ""}); those ${t.sharedNumberPos} orders wait for a decision until each has its own number in Purchase Pro`] : [],
        t.repeatedRows && t.repeatedRows.length ? [`${t.repeatedRows.length} order${t.repeatedRows.length > 1 ? "s appear" : " appears"} twice in the export with different details (${t.repeatedRows.slice(0, 2).map((x) => `${x.order_id ? `OrderID ${x.order_id}, ` : ""}PO ${x.po_number}`).join("; ")}); both rows are kept and wait for a decision`] : []),
      conservation: { pos: t.pos, committed_cents: t.committed_cents },
    });
  }
  function projectsCard(card, doc, ctx) {
    const known = new Set(((ctx.labor && ctx.labor.jobs) || []).map((j) => j.job_number));
    const fresh = doc.jobs.filter((j) => !known.has(j.job_number));
    Object.assign(card, {
      status: "ready", doc, title: "Projects register", stamp: `${doc.totals.jobs} jobs, ${fresh.length} new`,
      notes: [`campuses: ${Object.entries(doc.totals.campuses).map(([k, n]) => `${k} ${n}`).join(", ")}`].concat(
        doc.totals.repeated ? [`${doc.totals.repeated} repeated row${doc.totals.repeated > 1 ? "s" : ""} in the register; the first of each wins`] : [],
        fresh.length ? [`new: ${fresh.slice(0, 8).map((j) => `${j.job_number} ${j.name || ""}`.trim()).join("; ")}${fresh.length > 8 ? "; ..." : ""}`] : ["every job is already in Settings; blank campuses and regions are filled in"]),
      conservation: { jobs: doc.totals.jobs },
    });
  }
  function jctdCard(card, doc, ctx) {
    const jobs = (ctx.labor && ctx.labor.jobs) || [];
    const job = jobs.find((j) => j.job_number === doc.job_number);
    const cands = Rec.candidates(doc.rows, { onFeed: (name) => !!V.vendorFromText(name), exclude: (name) => !!SS.wasteVendorFor(ctx.wasteVendors || [], name) });
    const sm = Rec.summary(cands);
    const t = doc.totals;
    Object.assign(card, {
      status: "ready", doc, candidates: cands, period: doc.range,
      title: `Job Cost To Date, ${job ? job.short_name : doc.job_number} through ${C.fmtDay(doc.range.end)}`,
      stamp: `${C.fmtInt(t.rows)} rows, ${C.fmtMoney(t.amount_cents)}; ${sm.total} recurring charge${sm.total === 1 ? "" : "s"} (${sm.off_feed} off feed)`,
      notes: [
        Object.entries(t.byType).map(([k, v]) => `${k.replace(" cost", "").toLowerCase()} ${C.fmtInt(v.rows)} rows ${C.fmtMoney(v.amount_cents)}`).join(", "),
        sm.off_feed ? `off feed, this month: ${C.fmtMoney(sm.off_feed_monthly_cents)} a month in ${sm.off_feed} recurring charge${sm.off_feed === 1 ? "" : "s"}${sm.liberty_owned ? ` (${sm.liberty_owned} Liberty-owned)` : ""}; confirm them as monthly rentals on the job page` : "no recurring charge off the on-rent feeds",
        sm.on_feed ? `${sm.on_feed} recurring charge${sm.on_feed === 1 ? "" : "s"} from vendors on a feed, ${C.fmtMoney(sm.on_feed_monthly_cents)} a month: shown against the reports, never counted twice` : "",
        `as-of ${C.fmtDay(doc.as_of)} (${doc.asOfSource === "name" ? "from the name" : doc.asOfSource === "stamp" ? "the latest Date Stamp" : doc.asOfSource}); the latest export per job stands for all of its history`,
      ].filter(Boolean).concat(
        doc.jobs.length > 1 ? [`${doc.jobs.length} jobs in one file (${doc.jobs.join(", ")}); the first is taken as the file's job`] : [],
        !job ? [`job ${doc.job_number} is not in Settings: its lines record, its recurring charges show once the job is added`] : [],
        t.negatives ? [`${t.negatives} credit or reversal row${t.negatives > 1 ? "s" : ""} kept and netted`] : []),
      conservation: { rows: t.rows, amount_cents: t.amount_cents },
    });
  }
  function onrentCard(card, doc, ctx) {
    const jm = (ctx.jobMap && ctx.jobMap[doc.vendor_key]) || {};
    const byJob = R.monthCost(doc, ctx.vendorSettings || {}, jm);
    const unmapped = byJob.unmapped ? byJob.unmapped.refs : [];
    const billed = Object.values(byJob).filter((j) => j.job_number !== "unmapped").reduce((t, j) => t + j.total, 0);
    let stamp = `${doc.vendor_name}, as of ${C.fmtDay(doc.as_of)}: ${doc.totals.lines} on rent, ${C.fmtMoney(doc.totals.rent_cents)} rent a month`;
    if (doc.totals.noMonthly) stamp += ` (${doc.totals.noMonthly} with no monthly figure)`;
    const mapped = Object.keys(byJob).filter((j) => j !== "unmapped");
    const dayWeek = doc.totals.noMonthly - (doc.totals.qtyUnknown || 0), qu = doc.totals.qtyUnknown || 0;
    Object.assign(card, {
      status: "ready", doc, byJob, stamp,
      title: `${doc.vendor_name} on-rent report, as of ${C.fmtDay(doc.as_of)}`,
      unmapped,
      notes: [].concat(
        doc.vendorKnown ? [] : [`"${doc.vendor_name}" is a new vendor; tax 7% and markup 10% apply until Settings says otherwise`],
        doc.asOfSource === "name" ? [`as-of taken from the file name`] : doc.asOfSource === "derived" ? [`as-of worked out from Date Rented + Number of Days on Rent; every line agrees`] : [],
        doc.totals.accounts > 1 ? [`${doc.totals.accounts} accounts in one file`] : [],
        doc.totals.repeats ? [`${doc.totals.repeats} identit${doc.totals.repeats > 1 ? "ies" : "y"} repeat${doc.totals.repeats > 1 ? "" : "s"} (non-serialised items, one line per unit); each line is numbered`] : [],
        dayWeek ? [`${dayWeek} line${dayWeek > 1 ? "s" : ""} carr${dayWeek > 1 ? "y" : "ies"} only a day or week rate; shown, not counted in the month`] : [],
        qu ? [`${qu} line${qu > 1 ? "s" : ""} carr${qu > 1 ? "y" : "ies"} no quantity: this export has no Quantity column and the line has no serial number, so it may be many units; shown at the unit rate, not counted in the month (Sunbelt's account export carries quantities)`] : [],
        doc.totals.noUnit ? [`${doc.totals.noUnit} bulk line${doc.totals.noUnit > 1 ? "s" : ""} (no unit number) identified by category-class code`] : [],
        Object.keys(doc.totals.notCounted || {}).length ? [Object.entries(doc.totals.notCounted).map(([k, n]) => `${n} row${n > 1 ? "s" : ""} with status "${k}"`).join(", ") + " not on rent, listed and not counted"] : [],
        mapped.length ? [`${C.fmtMoney(billed)} a month to the client across ${mapped.length} job${mapped.length > 1 ? "s" : ""} (${mapped.join(", ")})`] : [],
        unmapped.length ? [`${unmapped.length} of the vendor's job name${unmapped.length > 1 ? "s are" : " is"} not matched to a job yet (${unmapped.slice(0, 4).map((r) => `"${r}"`).join(", ")}${unmapped.length > 4 ? ", ..." : ""}); ` +
          `they record under "other jobs" and move to a job the moment Settings says which`] : []),
      conservation: { lines: doc.totals.lines, rent_cents: doc.totals.rent_cents },
    });
  }

  /** bytes + name + ctx -> card. ctx: { labor:{rates,employees,policy,jobs}, vendorSettings, jobMap:{vendor_key:{ref:job}},
      asOf:{fileName: iso}, existing: async (sha256) => {recorded_by, recorded_at, ...} | null } */
  async function inspect(data, fileName, ctx = {}) {
    const bytes = C.toU8(data);
    const card = { fileName, name: String(fileName).split("/").pop(), bytes, size: bytes.length, sha256: null,
      kind: null, status: "refused", stamp: "", title: fileName, reason: "", notes: [], need: null };
    try {
      card.sha256 = await C.sha256Hex(bytes);
      const s = Sniff.sniff(bytes, fileName);
      card.kind = s.kind;
      if (s.kind === "system") { card.status = "skipped"; card.reason = "a system file, not data"; return card; }
      if (s.kind === "zip") { card.status = "zip"; return card; }
      if (ctx.existing) {
        const was = await ctx.existing(card.sha256);
        if (was) {
          card.status = "already-on-file"; card.existing = was;
          card.reason = `already on file${was.recorded_by_name ? `, recorded by ${was.recorded_by_name}` : ""}${was.recorded_at ? ` on ${C.fmtDay(String(was.recorded_at).slice(0, 10))}` : ""}`;
          card.title = was.file_name || fileName;
          return card;
        }
      }
      if (s.kind === "hh2_labor") hh2Card(card, HH2.readWorkbook(s.wb, card.name), ctx);
      else if (s.kind === "sage_rates") sageCard(card, Sage.readWorkbook(s.wb, card.name), ctx);
      else if (s.kind === "billable_rates") sageCard(card, Billable.readWorkbook(s.wb, card.name), ctx);
      else if (s.kind === "pdf") sageCard(card, await Billable.readPdf(bytes, card.name), ctx);
      else if (s.kind === "purchase_orders") poCard(card, PO.readWorkbook(s.wb, card.name, { as_of: ctx.asOf && ctx.asOf[fileName] }), ctx);
      else if (s.kind === "projects") projectsCard(card, Projects.readWorkbook(s.wb, card.name), ctx);
      else if (s.kind === "jctd") jctdCard(card, JCTD.readWorkbook(s.wb, card.name, { as_of: ctx.asOf && ctx.asOf[fileName] }), ctx);
      else if (s.kind === "onrent") onrentCard(card, OnRent.readWorkbook(s.wb, card.name, { as_of: ctx.asOf && ctx.asOf[fileName] }), ctx);
      else throw new C.NotForThisPage(`${fileName}: a kind this page does not record (${s.kind}).`);
    } catch (e) {
      if (!(e instanceof C.Refusal)) throw e;
      card.status = e instanceof C.NeedsDecision ? "needs-decision" : "refused";
      card.reason = e.message; card.need = e.need || null;
    }
    return card;
  }

  /** files: [{name, bytes}] (zips expand, recursively) -> cards, one per file. */
  async function inspectAll(files, ctx = {}) {
    const cards = [];
    for (const f of files) {
      const card = await inspect(f.bytes, f.name, ctx);
      if (card.status !== "zip") { cards.push(card); continue; }
      let entries;
      try { entries = unzip(card.bytes); }
      catch (e) { if (!(e instanceof C.Refusal)) throw e; card.status = "refused"; card.reason = e.message; cards.push(card); continue; }
      card.status = "zip"; card.reason = `${entries.length} file${entries.length === 1 ? "" : "s"} inside`; cards.push(card);
      for (const en of entries) {
        if (Sniff.familyOf(en.path) === "system") continue;
        let bytes;
        try { bytes = await en.read(); }
        catch (e) { if (!(e instanceof C.Refusal)) throw e; cards.push({ fileName: `${f.name}/${en.path}`, name: en.name, status: "refused", reason: e.message, kind: null, notes: [] }); continue; }
        const inner = await inspectAll([{ name: `${f.name}/${en.path}`, bytes }], ctx);
        cards.push(...inner);
      }
    }
    return cards;
  }

  const recordable = (card) => card.status === "ready";
  const ORDER = { ready: 0, "needs-decision": 1, refused: 2, "already-on-file": 3, zip: 4, skipped: 5 };
  const sortCards = (cards) => cards.slice().sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (a.fileName < b.fileName ? -1 : 1));

  return { unzip, inspect, inspectAll, recordable, sortCards };
}));
