/* site_services.js - what the site services on a job add up to: how many
   porta-potties, how many trailers (a modular building arrives as sleeves,
   FAST FRONT / FAST MIDDLE / FAST REAR under one contract, and front plus
   middles plus rear is one x-plex), how many storage containers, and what
   the dumpsters did (pulls from the ledger where the hauler invoices one
   haul at a time, from Liberty's own log where it does not).

   classify() reads a rental line's description the way the vendors write
   them (measured on United Rentals' All Jobs export and five Job Cost To
   Dates). The same rules, in SQL, are app.classify_rental; tests/db holds
   the two to each other. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.SiteServices = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const CATEGORIES = ["restroom", "trailer", "storage", "dumpster", "service", "accessory", "other"];
  const up = (s) => C.str(s).toUpperCase().replace(/\s+/g, " ");
  const num = (m) => (m ? +m[1] : null);

  /** description (+ cat-class, unused today but kept for the Settings override to come) -> {category, kind, ...} */
  function classify(description) {
    const d = up(description);
    if (!d) return { category: "other", kind: "blank" };
    // services: SERVICE - RESTROOM 5X WEEKLY, SERVICE ADA RSTRM 2X WEEKLY, 3X SERVICE OF WASTE TANK, SERVICE 20' CONTAINER WASTE 2X
    if (/^SERVICE\b|^\d+X SERVICE\b|\bSERVICE OF\b/.test(d)) {
      const kind = /RESTROOM|RSTRM|\bRR\b|TOILET|HIGH RISE/.test(d) ? "restroom" : /SINK/.test(d) ? "sink" : /WASTE/.test(d) ? "waste_tank" : /FRESH WATER|WATER/.test(d) ? "fresh_water" : /TRAILER|TRLR/.test(d) ? "trailer" : "other";
      return { category: "service", kind, per_week: num(d.match(/(\d+)\s*X\b/)) };
    }
    // accessories that ride with a unit, never a unit themselves
    if (/CONTAINMENT TRAY|TRAILER STEPS|TRAILER STAIRS|TRAILER KIT|TRAILER AIR CONDITIONED|TRAILER HVAC|TEAR DOWN|^SETUP TRAILER|TRAILER MOUNTED|TOILET PAPER/.test(d)) return { category: "accessory", kind: /STEPS|STAIRS/.test(d) ? "steps" : /TRAY/.test(d) ? "tray" : /HVAC|AIR COND/.test(d) ? "hvac" : "other" };
    // restrooms with stations: trailers, static units, containers
    if (/RESTROOM TRAILER|RESTROOM TRLR|(?<!NO )\bRR TRAILER\b|STATIC RESTROOM|RESTROOM CONTAINER/.test(d)) {
      return { category: "restroom", kind: /CONTAINER/.test(d) ? "container" : /STATIC/.test(d) ? "static" : "trailer", stations: num(d.match(/(\d+)\s*STATION/)) };
    }
    if (/PORTABLE RESTROOM|PORTABLE TOILET|PORTABLE RR\b|\bTOILETS?\b|\bRESTROOM\b|\bRSTRM\b|PORTA.?JOHN|PORTA.?POTT/.test(d)) {
      const kind = /HIGH RISE/.test(d) ? "high_rise" : /ELEVATOR/.test(d) ? "elevator_fit" : /HANDICAP|\bADA\b/.test(d) ? "handicap" : /ENHANCED|\bENH\b|DLX|DELUXE/.test(d) ? "enhanced" : /WOMEN/.test(d) ? "womens" : "standard";
      return { category: "restroom", kind };
    }
    if (/\bSINK\b|HAND ?WASH/.test(d)) return { category: "restroom", kind: "sink" };
    if (/HOLDING TANK|TANK HOLDING/.test(d)) return { category: "restroom", kind: "holding_tank" };
    if (/CONTAINER.*WASTE|WASTE & WATER/.test(d)) return { category: "restroom", kind: "waste_water_system" };
    // dumpsters: never a roll-off tank
    if (/TANK/.test(d) && /ROLL/.test(d)) return { category: "other", kind: "tank" };
    if (/DUMPSTER|ROLL[- ]?OFF|\bROS\b/.test(d)) return { category: "dumpster", kind: "roll_off", yards: num(d.match(/(\d+)\s*(?:YD|YARD)/)) };
    // modular buildings: the sleeves, then whole plexes, then double-wides
    const sec = d.match(/\b(?:FAST |MODULAR (?:BLDG )?)?(FRONT|FRNT|MIDDLE|MID|REAR|END)\b/);
    if (/MODULAR|FAST (FRONT|MIDDLE|REAR|END)/.test(d) && sec && !/SHIELD|FENCE/.test(d)) {
      const s = sec[1];
      return { category: "trailer", kind: "modular_section", section: /FRONT|FRNT/.test(s) ? "front" : /MID/.test(s) ? "middle" : "rear", rr: num(d.match(/W\/?\s*(\d)\s*-?\s*RR/)) || 0 };
    }
    const plex = d.match(/(\d+)\s*-?\s*PLEX/);
    if (plex) return { category: "trailer", kind: "modular_plex", sections: +plex[1] };
    if (/MODULAR BLDG|MODULAR BUILDING/.test(d) && !/SHIELD|FENCE/.test(d)) return { category: "trailer", kind: "modular", size: (d.match(/(\d+X\d*)/) || [])[1] || null, rr: num(d.match(/W\/?\s*(\d)\s*-?\s*RR/)) || 0 };
    // office trailers and containers
    if (/OFFICE TRAILER|NO RR TRAILER|TRAILER CUSTOM/.test(d)) return { category: "trailer", kind: "office", size: (d.match(/(\d+X\d+)/) || [])[1] || null, rr: /NO RR/.test(d) ? 0 : num(d.match(/W\/?\s*(\d)\s*-?\s*RR/)) || (/RR/.test(d) ? 1 : 0) };
    if (/OFFICE CONTAINER/.test(d)) return { category: "trailer", kind: "office_container", size: (d.match(/(\d+X\d+)/) || [])[1] || null };
    if (/STORAGE TRAILER/.test(d)) return { category: "storage", kind: "trailer", size: (d.match(/(\d+)'/) || [])[1] || null };
    if (/^CONTAINER\b|STORAGE CONTAINER|CONEX/.test(d) && /\d+\s*X\s*\d+|\d+'/.test(d)) return { category: "storage", kind: "container", size: (d.match(/(\d+X\d+)/) || [])[1] || null };
    if (/\bTRAILERS?\b/.test(d)) {
      if (/EQUIP|TILT|TANK|WATER|FLATBED|DUMP|UTILITY|CARGO|ON TRAILER|LIGHT TOWER|WASHER|TRAILER MOUNT/.test(d)) return { category: "other", kind: "equipment_trailer" };
      if (/\d+X\d+/.test(d)) return { category: "trailer", kind: "office", size: (d.match(/(\d+X\d+)/) || [])[1], rr: /NO RR/.test(d) ? 0 : /RR/.test(d) ? 1 : 0 };
      return { category: "trailer", kind: "unspecified" };
    }
    return { category: "other", kind: "other" };
  }

  /** modular sections grouped by vendor and contract -> complexes. lines: [{vendor_key, contract_no, description, qty}] */
  function plexes(lines) {
    const groups = {};
    for (const l of lines || []) {
      const c = classify(l.description);
      if (c.category !== "trailer" || (c.kind !== "modular_section" && c.kind !== "modular_plex")) continue;
      const k = `${l.vendor_key || ""}|${l.contract_no || ""}`;
      const g = groups[k] || (groups[k] = { vendor_key: l.vendor_key || null, contract_no: l.contract_no || null, fronts: 0, middles: 0, rears: 0, whole: [] });
      const q = l.qty == null ? 1 : +l.qty || 1;
      if (c.kind === "modular_plex") g.whole.push({ sections: c.sections, n: q });
      else g[c.section === "front" ? "fronts" : c.section === "middle" ? "middles" : "rears"] += q;
    }
    const out = [];
    for (const g of Object.values(groups)) {
      const total = g.fronts + g.middles + g.rears;
      const complexes = Math.min(g.fronts, g.rears);
      const notes = [];
      if (total && g.fronts !== g.rears) notes.push(`${g.fronts} front${g.fronts === 1 ? "" : "s"}, ${g.rears} rear${g.rears === 1 ? "" : "s"}: the sections do not close`);
      if (complexes && total % complexes) notes.push("uneven sections across the complexes");
      const sections = complexes ? Math.round(total / complexes) : null;
      if (total) out.push({ vendor_key: g.vendor_key, contract_no: g.contract_no, fronts: g.fronts, middles: g.middles, rears: g.rears, complexes, sections, label: complexes ? `${sections}-plex` : "sections, no complex", notes });
      for (const w of g.whole) out.push({ vendor_key: g.vendor_key, contract_no: g.contract_no, fronts: w.n, middles: w.n * (w.sections - 2), rears: w.n, complexes: w.n, sections: w.sections, label: `${w.sections}-plex`, notes: [] });
    }
    return out.sort((a, b) => (b.sections || 0) - (a.sections || 0) || (a.contract_no || "") < (b.contract_no || "") ? -1 : 1);
  }

  /** every line on a job's month -> the counts the tiles show */
  function counts(lines) {
    const r = { units: 0, byKind: {}, trailers: 0, static: 0, containers: 0, stations: 0, sinks: 0, holding_tanks: 0, waste_water_systems: 0, service_per_week: null };
    const t = { complexes: [], modular: {}, offices: {}, office_containers: 0, unspecified: 0, buildings: 0, notes: [] };
    const s = { containers: {}, container_units: 0, trailers: 0 };
    const dm = { units: 0, byYards: {} };
    const acc = {};
    let classified = 0;
    for (const l of lines || []) {
      const c = classify(l.description), q = l.qty == null ? 1 : +l.qty || 1;
      if (c.category === "other") continue;
      classified++;
      if (c.category === "restroom") {
        if (["standard", "high_rise", "elevator_fit", "handicap", "enhanced", "womens"].includes(c.kind)) { r.units += q; r.byKind[c.kind] = (r.byKind[c.kind] || 0) + q; }
        else if (c.kind === "trailer") { r.trailers += q; r.stations += (c.stations || 0) * q; }
        else if (c.kind === "static") { r.static += q; r.stations += (c.stations || 0) * q; }
        else if (c.kind === "container") { r.containers += q; r.stations += (c.stations || 0) * q; }
        else if (c.kind === "sink") r.sinks += q;
        else if (c.kind === "holding_tank") r.holding_tanks += q;
        else if (c.kind === "waste_water_system") r.waste_water_systems += q;
      } else if (c.category === "service") {
        if (c.kind === "restroom" && c.per_week && (!r.service_per_week || c.per_week > r.service_per_week)) r.service_per_week = c.per_week;
      } else if (c.category === "trailer") {
        if (c.kind === "modular") { const k = `${c.size || "modular"}${c.rr ? ` w/${c.rr} RR` : ""}`; t.modular[k] = (t.modular[k] || 0) + q; t.buildings += q; }
        else if (c.kind === "office") { const k = `${c.size || "office"}${c.rr ? ` w/${c.rr} RR` : ""}`; t.offices[k] = (t.offices[k] || 0) + q; t.buildings += q; }
        else if (c.kind === "office_container") { t.office_containers += q; t.buildings += q; }
        else if (c.kind === "unspecified") { t.unspecified += q; t.buildings += q; }
      } else if (c.category === "storage") {
        if (c.kind === "container") { const k = c.size || "container"; s.containers[k] = (s.containers[k] || 0) + q; s.container_units += q; }
        else s.trailers += q;
      } else if (c.category === "dumpster") { dm.units += q; const k = c.yards ? `${c.yards} yd` : "size unknown"; dm.byYards[k] = (dm.byYards[k] || 0) + q; }
      else if (c.category === "accessory") acc[c.kind] = (acc[c.kind] || 0) + q;
    }
    for (const p of plexes(lines)) {
      if (p.complexes) { const e = t.complexes.find((x) => x.label === p.label); if (e) e.n += p.complexes; else t.complexes.push({ label: p.label, n: p.complexes, sections: p.sections }); t.buildings += p.complexes; }
      for (const n of p.notes) t.notes.push(`contract ${p.contract_no || "?"}: ${n}`);
    }
    t.complexes.sort((a, b) => b.sections - a.sections);
    return { restrooms: r, trailers: t, storage: s, dumpsters: dm, accessories: acc, classified };
  }

  /** "1 x 6-plex, 1 x 4-plex, 2 x 24X60 w/2 RR, 3 x 12X60 office" */
  function trailerLabel(t) {
    const parts = t.complexes.map((c) => `${c.n} × ${c.label}`)
      .concat(Object.entries(t.modular).map(([k, n]) => `${n} × ${k}`), Object.entries(t.offices).map(([k, n]) => `${n} × ${k} office`));
    if (t.office_containers) parts.push(`${t.office_containers} office container${t.office_containers === 1 ? "" : "s"}`);
    if (t.unspecified) parts.push(`${t.unspecified} trailer${t.unspecified === 1 ? "" : "s"} (unspecified)`);
    return parts.join(", ") || "none";
  }

  // ---- dumpsters ---------------------------------------------------------------------------------
  const wasteVendorFor = (vendors, name) => { const n = C.str(name).toLowerCase(); return (vendors || []).find((v) => v.pattern && n.includes(String(v.pattern).toLowerCase())) || null; };
  /** ledger lines (JCTD AP cost) + the log + the waste vendors -> pulls per job, month and vendor, with where the count came from.
      The log wins for a vendor-month it has entries for; a vendor that bills a lump shows spend and no count. */
  function dumpsterMonth(ledgerLines, log, vendors) {
    const rows = {};
    const row = (job, month, key, name) => rows[`${job}|${month}|${key}`] || (rows[`${job}|${month}|${key}`] = { job_number: job, month, vendor_key: key, vendor_name: name, bills_per_haul: null, haul_lines: 0, ledger_lines: 0, ledger_cents: 0, entries: 0, log_pulls: 0, log_cost_cents: 0, container_yd: null, tonnage: 0 });
    for (const l of ledgerLines || []) {
      if (l.trans_type !== "AP cost") continue;
      const v = wasteVendorFor(vendors, l.vendor_name); if (!v) continue;
      const x = row(l.job_number, l.trans_date.slice(0, 7), `wv:${v.id || v.pattern}`, l.vendor_name);
      x.bills_per_haul = !!v.bills_per_haul; x.ledger_lines++; x.ledger_cents += l.amount_cents;
      x.haul_lines += l.amount_cents > 0 ? 1 : l.amount_cents < 0 ? -1 : 0;
      if (x.container_yd == null && v.container_yd) x.container_yd = v.container_yd;
    }
    for (const p of log || []) {
      const v = wasteVendorFor(vendors, p.vendor_name);
      const x = row(p.job_number, String(p.pull_date).slice(0, 7), v ? `wv:${v.id || v.pattern}` : `name:${C.str(p.vendor_name).toLowerCase()}`, p.vendor_name);
      if (v && x.bills_per_haul == null) x.bills_per_haul = !!v.bills_per_haul;
      x.entries++; x.log_pulls += p.pulls == null ? 1 : +p.pulls; x.log_cost_cents += p.cost_cents || 0; x.tonnage += +p.tonnage || 0;
      if (p.container_yd) x.container_yd = p.container_yd;
    }
    return Object.values(rows).map((x) => Object.assign(x, {
      source: x.entries ? "log" : x.bills_per_haul ? "ledger" : "spend",
      pulls: x.entries ? x.log_pulls : x.bills_per_haul ? x.haul_lines : null,
    })).sort((a, b) => (a.job_number + a.month + a.vendor_key < b.job_number + b.month + b.vendor_key ? -1 : 1));
  }

  /** lines of one job and month -> rows shaped like v_site_services_month (one per category, kind, section, size, rr, yards) */
  function viewRows(lines) {
    const g = {};
    for (const l of lines || []) {
      const c = classify(l.description); if (c.category === "other") continue;
      const q = l.qty == null ? 1 : +l.qty || 1;
      const k = [c.category, c.kind, c.section || "", c.size || "", c.rr || 0, c.yards || ""].join("|");
      const r = g[k] || (g[k] = { category: c.category, kind: c.kind, section: c.section || null, size: c.size || null, rr: c.rr || 0, yards: c.yards || null, units: 0, lines: 0, rent_cents: 0, stations: 0, per_week: null });
      r.units += q; r.lines++; r.rent_cents += l.monthly_rent_cents || 0; r.stations += (c.stations || 0) * q;
      if (c.per_week && (!r.per_week || c.per_week > r.per_week)) r.per_week = c.per_week;
    }
    return Object.values(g);
  }
  /** lines of one job and month -> rows shaped like v_trailer_plex_month */
  const plexRows = (lines) => plexes(lines).map((p) => ({ vendor_key: p.vendor_key, contract_no: p.contract_no, fronts: p.fronts, middles: p.middles, rears: p.rears, complexes: p.complexes, sections: p.sections, mismatch: p.fronts !== p.rears, whole: false }));
  /** the counts the tiles show, from the views (what a viewer can read) rather than the lines */
  function fromViews(rows, plex) {
    const r = { units: 0, byKind: {}, trailers: 0, static: 0, containers: 0, stations: 0, sinks: 0, holding_tanks: 0, waste_water_systems: 0, service_per_week: null };
    const t = { complexes: [], modular: {}, offices: {}, office_containers: 0, unspecified: 0, buildings: 0, notes: [] };
    const s = { containers: {}, container_units: 0, trailers: 0 };
    const dm = { units: 0, byYards: {} };
    const acc = {};
    let classified = 0;
    for (const x of rows || []) {
      const q = +x.units || 0; classified += +x.lines || 0;
      if (x.category === "restroom") {
        if (["standard", "high_rise", "elevator_fit", "handicap", "enhanced", "womens"].includes(x.kind)) { r.units += q; r.byKind[x.kind] = (r.byKind[x.kind] || 0) + q; }
        else if (x.kind === "trailer") r.trailers += q; else if (x.kind === "static") r.static += q; else if (x.kind === "container") r.containers += q;
        else if (x.kind === "sink") r.sinks += q; else if (x.kind === "holding_tank") r.holding_tanks += q; else if (x.kind === "waste_water_system") r.waste_water_systems += q;
        r.stations += +x.stations || 0;
      } else if (x.category === "service") { if (x.kind === "restroom" && x.per_week && (!r.service_per_week || x.per_week > r.service_per_week)) r.service_per_week = x.per_week; }
      else if (x.category === "trailer") {
        if (x.kind === "modular") { const k = `${x.size || "modular"}${x.rr ? ` w/${x.rr} RR` : ""}`; t.modular[k] = (t.modular[k] || 0) + q; t.buildings += q; }
        else if (x.kind === "office") { const k = `${x.size || "office"}${x.rr ? ` w/${x.rr} RR` : ""}`; t.offices[k] = (t.offices[k] || 0) + q; t.buildings += q; }
        else if (x.kind === "office_container") { t.office_containers += q; t.buildings += q; }
        else if (x.kind === "unspecified") { t.unspecified += q; t.buildings += q; }
      } else if (x.category === "storage") { if (x.kind === "container") { const k = x.size || "container"; s.containers[k] = (s.containers[k] || 0) + q; s.container_units += q; } else s.trailers += q; }
      else if (x.category === "dumpster") { dm.units += q; const k = x.yards ? `${x.yards} yd` : "size unknown"; dm.byYards[k] = (dm.byYards[k] || 0) + q; }
      else if (x.category === "accessory") acc[x.kind] = (acc[x.kind] || 0) + q;
    }
    for (const p of plex || []) {
      if (p.complexes > 0) { const label = `${p.sections}-plex`; const e = t.complexes.find((x) => x.label === label); if (e) e.n += +p.complexes; else t.complexes.push({ label, n: +p.complexes, sections: +p.sections }); t.buildings += +p.complexes; }
      if (p.mismatch) t.notes.push(`contract ${p.contract_no || "?"}: ${p.fronts} front${p.fronts === 1 ? "" : "s"}, ${p.rears} rear${p.rears === 1 ? "" : "s"}: the sections do not close`);
    }
    t.complexes.sort((a, b) => b.sections - a.sections);
    return { restrooms: r, trailers: t, storage: s, dumpsters: dm, accessories: acc, classified };
  }
  /** "17 restrooms · 2 buildings · 8 pulls", for a job card */
  function shortLabel(c, pulls) {
    const parts = [];
    if (c && c.restrooms.units) parts.push(`${c.restrooms.units} restroom${c.restrooms.units === 1 ? "" : "s"}`);
    if (c && c.trailers.buildings) parts.push(`${c.trailers.buildings} building${c.trailers.buildings === 1 ? "" : "s"}`);
    if (pulls != null) parts.push(`${pulls} pull${pulls === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }

  return { CATEGORIES, classify, plexes, counts, trailerLabel, wasteVendorFor, dumpsterMonth, viewRows, plexRows, fromViews, shortLabel };
}));
