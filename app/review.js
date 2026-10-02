/* review.js - the weekly cost review: labor burn, rental burn, committed POs.

   The page matches the Liberty weekly cost review (campus and project
   slicers, one week ending, three tabs). Numbers come from the workspace:
   priced HH2 rows, equipment still on rent, and Purchase Pro POs. A held
   labor row is not in the burn. A viewer never receives employee names;
   the caller passes employee: null and this file prints a dash. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"), require("./labor_model.js"), require("./rentals_model.js"));
  else root.ReviewModel = factory(root.Common, root.LaborModel, root.RentalsModel);
}(typeof self !== "undefined" ? self : this, function (C, L, R) {
  "use strict";

  const NAVY = "#081E3E", RED = "#C71F3F";
  const VENDOR_COLOR = [[/united/i, NAVY], [/sunbelt/i, RED], [/equipment\s*share|equipshare/i, "#9A9A9A"], [/herc/i, "#C9C9C9"]];
  const EXTRA = ["#6F7C8E", "#4C6A92", "#8C5A6B", "#5E7A6A"];

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtMDY = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
  const fmtMD = (iso) => (iso ? `${C.MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(8, 10)}` : "");
  function fmt2c(cents) {
    if (cents == null || Number.isNaN(cents)) return "";
    const neg = cents < 0, a = Math.abs(Math.round(cents));
    return (neg ? "-" : "") + C.fmtInt(Math.floor(a / 100)) + "." + String(a % 100).padStart(2, "0");
  }
  function fmtCur(cents) {
    const v = (cents || 0) / 100, a = Math.abs(v), s = v < 0 ? "-" : "";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return s + "$" + (a / 1e3).toFixed(2) + "K";
    return s + "$" + a.toFixed(2);
  }
  function fmtHrs(hours) {
    const a = Math.abs(hours || 0), s = hours < 0 ? "-" : "";
    if (a >= 1e3) return s + (a / 1e3).toFixed(2) + "K";
    return s + a.toFixed(2);
  }
  function fmtHrsTable(hours) {
    const neg = hours < 0, a = Math.abs(hours || 0);
    const whole = Math.floor(a + 1e-9), frac = Math.round((a - whole) * 100);
    const carry = frac === 100 ? 1 : 0, f = frac === 100 ? 0 : frac;
    return (neg ? "-" : "") + C.fmtInt(whole + carry) + "." + String(f).padStart(2, "0");
  }
  function fmtTick(n) {
    const a = Math.abs(n);
    const trim = (x) => String(+x.toFixed(2));
    if (a >= 1e6) return trim(n / 1e6) + "M";
    if (a >= 1e3) return trim(n / 1e3) + "K";
    return trim(n);
  }
  const weeklyOf = (monthlyCents) => C.roundHalfUp((monthlyCents || 0) * 10 / 43);

  /** REG stays REG, including UNION REG. Double time before overtime so DOUBLETIME is not read as OT. */
  function payBucket(payType, payTypeName) {
    const s = `${payType || ""} ${payTypeName || ""}`.toUpperCase();
    if (/DOUBLE|\bD\/T\b|\bDT\b/.test(s)) return "dt";
    if (/OVER|\bO\/T\b|\bOT\b/.test(s)) return "ot";
    return "reg";
  }
  function tradeOf(code) {
    const t = L.classParts(code).trade;
    return t === "Carpenter" || t === "Laborer" ? t : (t || "Other");
  }
  function vendorColor(name, i) {
    for (const [re, color] of VENDOR_COLOR) if (re.test(name || "")) return color;
    return EXTRA[i % EXTRA.length];
  }
  function burdenedMonthly(line, settings) {
    const rent = line.monthly_rent_cents;
    if (rent == null) return 0;
    if (line.liberty_owned) return rent;
    return R.cost(rent, R.settingsFor(settings, line.vendor_key, line.job_number)).total;
  }
  function niceStep(max, n) {
    if (!(max > 0)) return 1;
    const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return m * p;
  }
  function sortRows(rows, spec, fallback) {
    const key = (spec && spec.key) || fallback.key;
    const dir = (spec && spec.dir) || fallback.dir;
    const mul = dir === "desc" ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul || String(a.employee || a.description || a.po || "").localeCompare(String(b.employee || b.description || b.po || ""));
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * mul;
    });
  }
  function pick(list, chosen) {
    if (chosen == null) return list.slice();
    const set = new Set(chosen);
    return list.filter((x) => set.has(x));
  }
  function weeksBack(week, n) {
    const out = [];
    for (let k = n - 1; k >= 0; k--) out.push(C.addDays(week, -7 * k));
    return out;
  }

  /**
   * input: { jobs, labor, rentals, purchases, rentalSettings, week, campuses, projects, tab, sort, showNames, today, updated }
   * campuses/projects null = all; an array is the selection, including an empty one.
   */
  function build(input) {
    const src = input || {};
    const jobs = (src.jobs || []).map((j) => Object.assign({}, j, { campus: j.campus || "Unassigned", short_name: j.short_name || j.job_number }));
    const laborWeeks = [...new Set((src.labor || []).map((r) => r.week_ending).filter(Boolean))].sort();
    const poWeeks = [...new Set((src.purchases || []).filter((p) => p.doc_date && !p.cancelled && !p.quote && p.status !== "excluded" && p.order_type !== "Rental").map((p) => L.weekEnding(p.doc_date)))];
    const week = src.week && /^\d{4}-\d{2}-\d{2}$/.test(src.week) ? L.weekEnding(src.week) : (laborWeeks[laborWeeks.length - 1] || poWeeks.sort().pop() || L.weekEnding(src.today || C.todayIso()));
    const weeks = [...new Set(laborWeeks.concat(poWeeks, [week]))].sort();
    const campuses = [...new Set(jobs.map((j) => j.campus))].sort();
    const campusOn = src.campuses == null ? campuses : campuses.filter((c) => src.campuses.includes(c));
    const inCampus = jobs.filter((j) => campusOn.includes(j.campus));
    const projectOn = src.projects == null ? inCampus : inCampus.filter((j) => src.projects.includes(j.job_number));
    const mask = new Set(projectOn.map((j) => j.job_number));
    const showNames = src.showNames !== false;

    const labor = laborBlock(src.labor || [], mask, week, showNames, src.sort && src.sort.labor);
    const rental = rentalBlock(src.rentals || [], mask, src.rentalSettings, src.sort && src.sort.rental);
    const po = poBlock(src.purchases || [], mask, week, src.sort && src.sort.po);
    const campusLabel = campusOn.length === campuses.length ? "All" : (campusOn.join(", ") || "None");
    const projectLabel = projectOn.length === inCampus.length ? "All" : (projectOn.map((j) => `${j.short_name} (${j.campus})`).join(", ") || "None");
    return {
      tab: src.tab === "rental" || src.tab === "po" ? src.tab : "labor",
      week, weeks, today: src.today || C.todayIso(), updated: src.updated || null, showNames,
      campuses: campuses.map((name) => ({ name, on: campusOn.includes(name) })),
      projects: inCampus.map((j) => ({ job_number: j.job_number, name: j.short_name, campus: j.campus, on: mask.has(j.job_number) })),
      campusLabel, projectLabel, campusAll: campusOn.length === campuses.length, projectAll: projectOn.length === inCampus.length,
      labor, rental, po,
    };
  }

  function laborBlock(rows, mask, week, showNames, sort) {
    let cost = 0, reg = 0, ot = 0, dt = 0;
    const emps = new Map(), codes = new Map();
    const back = weeksBack(week, 4);
    const stack = back.map(() => ({ carpenter: 0, laborer: 0 }));
    const seen = new Set();
    for (const r of rows) {
      if (!mask.has(r.job_number) || !r.week_ending) continue;
      const bi = back.indexOf(r.week_ending);
      if (bi >= 0) {
        const trade = tradeOf(r.certified_class);
        if (trade === "Carpenter") stack[bi].carpenter += +r.hours || 0;
        else if (trade === "Laborer") stack[bi].laborer += +r.hours || 0;
      }
      if (r.week_ending !== week) continue;
      const hours = +r.hours || 0, cents = r.cost_cents || 0;
      const bucket = payBucket(r.pay_type, r.pay_type_name);
      if (bucket === "ot") ot += hours; else if (bucket === "dt") dt += hours; else reg += hours;
      cost += cents;
      const key = r.employee_key || r.employee || "";
      seen.add(key);
      const e = emps.get(key) || { employee: showNames ? (r.employee || r.employee_key || "—") : "—", trade: tradeOf(r.certified_class), hours: 0, cost: 0 };
      if (e.trade !== tradeOf(r.certified_class) && e.trade !== "Mixed") e.trade = "Mixed";
      e.hours += hours; e.cost += cents; emps.set(key, e);
      const ck = r.cost_code_name || r.cost_code || "(no cost code)";
      codes.set(ck, (codes.get(ck) || 0) + cents);
    }
    const hours = reg + ot + dt;
    const employees = sortRows([...emps.values()], sort, { key: "employee", dir: "asc" });
    const byCode = [...codes.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents).slice(0, 12);
    return {
      cost, reg, ot, dt, hours, headcount: seen.size, employees, byCode,
      weeks4: back.map((w, i) => ({ week: w, label: fmtMD(w), carpenter: stack[i].carpenter, laborer: stack[i].laborer })),
      sort: { key: (sort && sort.key) || "employee", dir: (sort && sort.dir) || "asc" },
      note: `Week ending ${fmtMDY(week)} · ${C.fmtInt(seen.size)} employees · ${fmtHrsTable(hours)} hours`,
    };
  }

  function rentalBlock(rows, mask, settings, sort) {
    let monthly = 0, weekly = 0, qty = 0, lines = 0;
    const byDesc = new Map(), byVend = new Map(), byCat = new Map();
    for (const r of rows) {
      if (!mask.has(r.job_number)) continue;
      if (r.off_rent_date) continue;
      const m = burdenedMonthly(r, settings);
      const w = weeklyOf(m);
      const q = +r.qty || 0;
      lines++; monthly += m; weekly += w; qty += q;
      const dkey = r.description || "(no description)";
      const d = byDesc.get(dkey) || { description: dkey, qty: 0, monthly: 0, weekly: 0 };
      d.qty += q; d.monthly += m; d.weekly += w; byDesc.set(dkey, d);
      const vkey = r.vendor_name || r.vendor_key || "Vendor";
      byVend.set(vkey, (byVend.get(vkey) || 0) + m);
      const cat = r.category || "Equipment";
      byCat.set(cat, (byCat.get(cat) || 0) + m);
    }
    const descriptions = sortRows([...byDesc.values()], sort, { key: "monthly", dir: "desc" });
    const vendors = [...byVend.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents)
      .map((v, i) => Object.assign(v, { color: vendorColor(v.label, i) }));
    const categories = [...byCat.entries()].map(([label, cents]) => ({ label, cents })).sort((a, b) => b.cents - a.cents).slice(0, 8);
    return { monthly, weekly, qty, lines, descriptions, vendors, categories, sort: { key: (sort && sort.key) || "monthly", dir: (sort && sort.dir) || "desc" } };
  }

  function poBlock(rows, mask, week, sort) {
    const prev = C.addDays(week, -7), prev2 = C.addDays(week, -14);
    const year = week.slice(0, 4), month = week.slice(0, 7);
    const win = { tw: blank(), lw: blank(), mtd: blank(), ytd: blank() };
    const back = weeksBack(week, 4);
    const stack = back.map(() => ({ cents: 0, count: 0, pending: 0 }));
    const list = [];
    let valued = 0, nValued = 0;
    for (const p of rows) {
      if (!mask.has(p.job_number) || !p.doc_date) continue;
      if (p.cancelled || p.quote || p.status === "excluded" || p.order_type === "Rental") continue;
      const has = p.committed_cents != null;
      const amt = has ? p.committed_cents : 0;
      list.push({ date: p.doc_date, po: p.doc_number || "", job: p.job_number, supplier: p.supplier || "", committed: has ? p.committed_cents : null });
      if (has) { valued += amt; nValued++; }
      const add = (k) => { win[k].cents += amt; win[k].count++; if (!has) win[k].pending++; };
      if (p.doc_date > prev && p.doc_date <= week) add("tw");
      if (p.doc_date > prev2 && p.doc_date <= prev) add("lw");
      if (p.doc_date <= week && p.doc_date.slice(0, 4) === year) {
        add("ytd");
        if (p.doc_date.slice(0, 7) === month) add("mtd");
      }
      const we = L.weekEnding(p.doc_date), bi = back.indexOf(we);
      if (bi >= 0) { stack[bi].cents += amt; stack[bi].count++; if (!has) stack[bi].pending++; }
    }
    return {
      tw: win.tw, lw: win.lw, mtd: win.mtd, ytd: win.ytd, valued, nValued, nAll: list.length,
      rows: sortRows(list, sort, { key: "date", dir: "desc" }),
      weeks4: back.map((w, i) => ({ week: w, label: fmtMD(w), cents: stack[i].cents, count: stack[i].count, pending: stack[i].pending })),
      sort: { key: (sort && sort.key) || "date", dir: (sort && sort.dir) || "desc" },
      note: `Windows anchored at week ending ${fmtMDY(week)} (This Week ${fmtMDY(C.addDays(week, -6))} – ${fmtMDY(week)})`,
    };
  }
  function blank() { return { cents: 0, count: 0, pending: 0 }; }

  function href(model, tab) { return `#/review?tab=${tab}${model.week ? `&w=${model.week}` : ""}`; }
  function dd(kind, label, items, allOn) {
    const rows = items.map((it) => kind === "campus"
      ? `<div class="wcr-dd-item"><label><input type="checkbox" data-campus value="${esc(it.name)}" ${it.on ? "checked" : ""}> <span class="lbl">${esc(it.name)}</span></label><button type="button" class="only" data-only-campus="${esc(it.name)}">only</button></div>`
      : `<div class="wcr-dd-item"><label><input type="checkbox" data-project value="${esc(it.job_number)}" ${it.on ? "checked" : ""}> <span class="lbl">${esc(it.name)}</span><span class="tag">${esc(it.campus)}</span></label><button type="button" class="only" data-only-project="${esc(it.job_number)}">only</button></div>`).join("");
    const allAttr = kind === "campus" ? "data-campus-all" : "data-project-all";
    return `<div class="wcr-dd" data-dd="${kind}"><button type="button" class="wcr-dd-btn" aria-haspopup="listbox"><span class="val">${esc(label)}</span><span class="caret"></span></button><div class="wcr-dd-pop" role="listbox"><label class="wcr-dd-item all"><input type="checkbox" ${allAttr} ${allOn ? "checked" : ""}> Select all</label>${rows || `<div class="wcr-empty">None</div>`}</div></div>`;
  }
  function si(sort, key) { return sort.key === key ? `<i class="si ${sort.dir}"></i>` : `<i class="si"></i>`; }
  function th(tab, key, label, num, width, sort, firstDir) {
    return `<th class="${num ? "num" : ""}" style="width:${width}" data-sort="${tab}:${key}" data-sortdir="${firstDir || (num ? "desc" : "asc")}">${esc(label)}${si(sort, key)}</th>`;
  }
  function table(tab, cols, rows, total, sort, cls, height) {
    const body = rows.length ? rows.map((r) => `<tr>${cols.map((c) => `<td class="${c.num ? "num" : ""}">${c.cell(r)}</td>`).join("")}</tr>`).join("") : `<tr><td class="wcr-empty" colspan="${cols.length}">Nothing for this selection</td></tr>`;
    const foot = `<tr>${cols.map((c) => `<td class="${c.num ? "num" : ""}">${c.total(total)}</td>`).join("")}</tr>`;
    return `<div class="wcr-tbl-wrap" style="max-height:${height}px"><table class="wcr-tbl ${cls || ""}"><thead><tr>${cols.map((c) => th(tab, c.key, c.label, c.num, c.width, sort, c.firstDir)).join("")}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
  }

  function hbar(items, fmt) {
    if (!items.length) return `<div class="wcr-empty">Nothing for this selection</div>`;
    const labelW = 168, rowH = 26, gap = 4, valW = 78, w = 520, h = items.length * rowH + 8;
    const max = Math.max(...items.map((i) => i.value), 1);
    const bars = items.map((it, i) => {
      const y = 4 + i * rowH, bw = Math.max(0, (w - labelW - valW - 16) * (it.value / max));
      return `<text x="${labelW - 8}" y="${y + 16}" text-anchor="end" font-size="11" fill="#1B1B1B">${esc(truncate(it.label, 24))}</text><rect x="${labelW}" y="${y + 4}" width="${bw.toFixed(1)}" height="${rowH - gap - 6}" fill="${NAVY}"></rect><text x="${labelW + bw + 6}" y="${y + 16}" font-size="11" fill="#5A5A5A">${esc(fmt(it.value))}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${w} ${h}" role="img">${bars}</svg>`;
  }
  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function stacked(cats, series, opts) {
    const vals = cats.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    if (!vals.some((v) => v)) return `<div class="wcr-empty">${esc(opts.empty || "Nothing for this selection")}</div>`;
    const W = 560, H = opts.height || 280, padL = 52, padB = opts.sub ? 52 : 36, padT = 18, padR = 8;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const max = Math.max(...vals, 1), step = niceStep(max, 4), top = Math.max(step, Math.ceil(max / step) * step);
    const yOf = (v) => padT + plotH - (v / top) * plotH;
    let grid = "";
    for (let v = 0; v <= top + step / 100; v += step) {
      const y = yOf(v);
      grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#DDDDDD"/>`;
      grid += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="#5A5A5A">${esc(opts.tick(v))}</text>`;
    }
    const slot = plotW / cats.length, bw = slot * 0.52;
    let cols = "";
    cats.forEach((c, i) => {
      let y = yOf(0);
      const x = padL + i * slot + (slot - bw) / 2;
      series.forEach((s) => {
        const v = s.values[i] || 0;
        if (!v) return;
        const h = (v / top) * plotH;
        y -= h;
        cols += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" fill="${s.color}"><title>${esc(s.name)} ${esc(opts.seg(v))}</title></rect>`;
      });
      const tot = vals[i];
      if (tot) cols += `<text x="${(x + bw / 2).toFixed(1)}" y="${(yOf(tot) - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="#1B1B1B">${esc(opts.tot(tot))}</text>`;
      cols += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - (opts.sub ? 22 : 8)}" text-anchor="middle" font-size="11" fill="#1B1B1B">${esc(c.label)}</text>`;
      if (c.sub) cols += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#5A5A5A">${esc(c.sub)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${cols}</svg>`;
  }
  function donut(slices, center) {
    const total = slices.reduce((a, s) => a + s.cents, 0);
    if (!total) return `<svg viewBox="0 0 180 180" role="img"><circle cx="90" cy="90" r="54" fill="none" stroke="#E4E4E4" stroke-width="28"/><text x="90" y="94" text-anchor="middle" font-size="13" fill="#081E3E">$0.00</text></svg>`;
    const r = 54, c = 90, sw = 28;
    let a0 = -Math.PI / 2;
    const paths = slices.map((s) => {
      const frac = s.cents / total;
      if (frac >= 0.999) return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}"/>`;
      const a1 = a0 + frac * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1 - 1e-4);
      const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
      a0 = a1;
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${sw}"/>`;
    }).join("");
    return `<svg viewBox="0 0 180 180" role="img">${paths}<text x="90" y="86" text-anchor="middle" font-size="11" fill="#5A5A5A">Monthly</text><text x="90" y="104" text-anchor="middle" font-size="13" font-weight="600" fill="#081E3E">${esc(center)}</text></svg>`;
  }

  function laborHtml(m) {
    const Lr = m.labor;
    const names = m.showNames ? "" : `<p class="wcr-note-line">Employee names are hidden on this sign-in.</p>`;
    const emp = table("labor", [
      { key: "employee", label: "Employee", width: "40%", cell: (r) => esc(r.employee), total: () => "Total" },
      { key: "trade", label: "Trade", width: "22%", cell: (r) => esc(r.trade), total: () => "" },
      { key: "hours", label: "Hours", num: true, width: "17%", cell: (r) => fmtHrsTable(r.hours), total: () => fmtHrsTable(Lr.hours) },
      { key: "cost", label: "Total Labor Cost", num: true, width: "21%", cell: (r) => fmt2c(r.cost), total: () => fmt2c(Lr.cost) },
    ], Lr.employees, {}, Lr.sort, "tot-red", 392);
    const hours = stacked(Lr.weeks4, [
      { name: "Carpenter", color: RED, values: Lr.weeks4.map((w) => w.carpenter) },
      { name: "Laborer", color: NAVY, values: Lr.weeks4.map((w) => w.laborer) },
    ], { height: 300, tick: (v) => fmtTick(v), seg: (v) => fmtHrs(v), tot: (v) => fmtHrs(v), empty: "No carpenter or laborer hours in these four weeks" });
    return `<section class="wcr-page active" data-page="labor"><div class="wcr-ph"><h2>Weekly Labor Burn</h2><span class="note">${esc(Lr.note)}</span></div>${names}
      <div class="wcr-grid wcr-g-labor"><div class="wcr-stack">
        <div class="wcr-kpi big"><div class="v" id="wcr-labor-cost">${fmtCur(Lr.cost)}</div><div class="l">Total Labor Cost</div></div>
        <div class="wcr-kpis wcr-k4">
          <div class="wcr-kpi small"><div class="v">${fmtHrs(Lr.reg)}</div><div class="l">REG Hours</div></div>
          <div class="wcr-kpi small"><div class="v">${fmtHrs(Lr.ot)}</div><div class="l">OT Hours</div></div>
          <div class="wcr-kpi small"><div class="v">${fmtHrs(Lr.dt)}</div><div class="l">DT Hours</div></div>
          <div class="wcr-kpi small"><div class="v">${C.fmtInt(Lr.headcount)}</div><div class="l">Headcount</div></div>
        </div></div>
        <div class="wcr-card"><h3>Total Labor Cost by Cost Code Name<span class="cap">top 12, selected week</span></h3><div class="wcr-chart">${hbar(Lr.byCode.map((c) => ({ label: c.label, value: c.cents })), fmtCur)}</div></div>
        <div class="wcr-card"><h3>Labor by Employee<span class="cap">week ending ${esc(fmtMDY(m.week))}</span></h3>${emp}</div>
        <div class="wcr-card"><h3>Hours Total - Last Four Weeks</h3><div class="wcr-legend"><span class="lt">Trade</span><span><span class="sw" style="background:${RED}"></span>Carpenter</span><span><span class="sw" style="background:${NAVY}"></span>Laborer</span></div><div class="wcr-chart">${hours}</div></div>
      </div></section>`;
  }
  function rentalHtml(m) {
    const Rr = m.rental;
    const tbl = table("rental", [
      { key: "description", label: "Description", width: "52%", cell: (r) => esc(r.description), total: () => "Total" },
      { key: "qty", label: "Quantity", num: true, width: "13%", cell: (r) => C.fmtInt(r.qty), total: () => C.fmtInt(Rr.qty) },
      { key: "monthly", label: "Monthly", num: true, width: "18%", cell: (r) => fmt2c(r.monthly), total: () => fmt2c(Rr.monthly) },
      { key: "weekly", label: "Weekly", num: true, width: "17%", cell: (r) => fmt2c(r.weekly), total: () => fmt2c(Rr.weekly) },
    ], Rr.descriptions, {}, Rr.sort, "", 560);
    const leg = Rr.vendors.length ? `<div class="lt">Vendor</div><table><tbody>${Rr.vendors.map((v) => `<tr><td><span class="sw" style="background:${v.color}"></span>${esc(v.label)}</td><td class="num">${fmtCur(v.cents)}</td><td class="pct">${Rr.monthly ? (v.cents / Rr.monthly * 100).toFixed(1) : "0.0"}%</td></tr>`).join("")}<tr class="tot"><td>Total</td><td class="num">${fmtCur(Rr.monthly)}</td><td class="pct">100%</td></tr></tbody></table>` : `<div class="wcr-empty">No equipment on rent for the current selection</div>`;
    return `<section class="wcr-page active" data-page="rental"><div class="wcr-ph"><h2>Weekly Rental Burn</h2><span class="note">Equipment still on rent. Week Ending does not apply to this page.</span></div>
      <div class="wcr-grid wcr-g-rent">
        <div class="wcr-kpis wcr-k3 c1">
          <div class="wcr-kpi band"><div class="bh">Monthly Cost</div><div class="bv"><div class="v" id="wcr-rent-monthly">${fmtCur(Rr.monthly)}</div></div><div class="s">burdened monthly rate, all lines</div></div>
          <div class="wcr-kpi band"><div class="bh">Weekly Cost</div><div class="bv"><div class="v">${fmtCur(Rr.weekly)}</div></div><div class="s">monthly ÷ 4.3</div></div>
          <div class="wcr-kpi band"><div class="bh">Items On Rent</div><div class="bv"><div class="v">${C.fmtInt(Rr.qty)}</div></div><div class="s"><b>${C.fmtInt(Rr.qty)}</b> units on <b>${C.fmtInt(Rr.lines)}</b> rental lines</div></div>
        </div>
        <div class="wcr-card c2"><h3>Equipment On Rent<span class="cap">by description, monthly burdened cost</span></h3>${tbl}</div>
        <div class="wcr-card c1"><h3>Costs by Vendor<span class="cap">monthly burdened cost</span></h3><div class="wcr-donut"><div class="wcr-chart">${donut(Rr.vendors, fmtCur(Rr.monthly))}</div><div class="wcr-dleg">${leg}</div></div></div>
        <div class="wcr-card c1"><h3>Monthly Cost by Category<span class="cap">top 8</span></h3><div class="wcr-chart">${hbar(Rr.categories.map((c) => ({ label: c.label, value: c.cents })), fmtCur)}</div></div>
      </div></section>`;
  }
  function band(title, w) {
    return `<div class="wcr-kpi band"><div class="bh">${title}</div><div class="bv"><div class="v">${fmtCur(w.cents)}</div></div><div class="s"><b>${C.fmtInt(w.count)}</b> PO${w.count === 1 ? "" : "s"} · <b>${C.fmtInt(w.pending)}</b> not yet valued in Sage</div></div>`;
  }
  function poHtml(m) {
    const P = m.po;
    const tbl = table("po", [
      { key: "date", label: "Order Date", width: "16%", cell: (r) => esc(fmtMDY(r.date)), total: () => "Total (valued)" },
      { key: "po", label: "PO #", width: "15%", cell: (r) => esc(r.po), total: () => "" },
      { key: "job", label: "Job #", width: "19%", cell: (r) => esc(r.job), total: () => "" },
      { key: "supplier", label: "Supplier", width: "30%", cell: (r) => esc(r.supplier), total: () => `${C.fmtInt(P.nValued)} of ${C.fmtInt(P.nAll)} POs` },
      { key: "committed", label: "Committed Value", num: true, width: "20%", cell: (r) => r.committed == null ? `<span class="pending">pending</span>` : fmt2c(r.committed), total: () => fmt2c(P.valued) },
    ], P.rows, {}, P.sort, "", 470);
    const chart = stacked(P.weeks4.map((w) => ({ label: w.label, sub: `${C.fmtInt(w.count)} PO${w.count === 1 ? "" : "s"}${w.pending ? ` · ${C.fmtInt(w.pending)} pending` : ""}` })),
      [{ name: "Committed", color: NAVY, values: P.weeks4.map((w) => w.cents / 100) }],
      { height: 320, sub: true, tick: (v) => "$" + fmtTick(v), seg: () => "", tot: (v) => fmtCur(Math.round(v * 100)), empty: "No valued POs in these four weeks" });
    return `<section class="wcr-page active" data-page="po"><div class="wcr-ph"><h2>Weekly Committed POs</h2><span class="note">${esc(P.note)}</span></div>
      <div class="wcr-kpis wcr-k4" style="margin-bottom:6px">${band("This Week", P.tw)}${band("Last Week", P.lw)}${band("MTD", P.mtd)}${band("YTD", P.ytd)}</div>
      <p class="wcr-note-line">Quotes, cancelled orders, rental POs, and POs left out of the count are omitted. A blank committed amount is still pending in Sage.</p>
      <div class="wcr-grid wcr-g-comm"><div class="wcr-card"><h3>Purchase Orders<span class="cap">${C.fmtInt(P.nAll)} POs · ${C.fmtInt(P.nValued)} valued</span></h3>${tbl}</div>
        <div class="wcr-card"><h3>Committed Total - Last Four Weeks<span class="cap">week ending = Sunday on or after order date</span></h3><div class="wcr-chart">${chart}</div></div></div></section>`;
  }

  function html(model) {
    const m = model;
    const updated = m.updated ? `Data through ${fmtMDY(m.updated)} · ` : "";
    const page = m.tab === "rental" ? rentalHtml(m) : m.tab === "po" ? poHtml(m) : laborHtml(m);
    const projLabel = m.projectAll ? "All" : (m.projects.filter((p) => p.on).length === 1 ? m.projects.find((p) => p.on).name : `${m.projects.filter((p) => p.on).length} projects`);
    const campLabel = m.campusAll ? "All" : (m.campuses.filter((c) => c.on).length === 1 ? m.campuses.find((c) => c.on).name : `${m.campuses.filter((c) => c.on).length} campuses`);
    return `<div class="wcr"><header class="wcr-hdr"><div class="wcr-logo">LIBERTY</div><div class="wcr-titles"><h1>GR Weekly Cost Review</h1><div class="sub">Liberty Builds · General Requirements · ${esc(updated)}Week ending ${esc(fmtMDY(m.week))}</div></div>
      <nav class="wcr-tabs" aria-label="Report pages"><a class="wcr-tab ${m.tab === "labor" ? "active" : ""}" href="${href(m, "labor")}">Weekly Labor Burn</a><a class="wcr-tab ${m.tab === "rental" ? "active" : ""}" href="${href(m, "rental")}">Weekly Rental Burn</a><a class="wcr-tab ${m.tab === "po" ? "active" : ""}" href="${href(m, "po")}">Weekly Committed POs</a></nav></header>
      <div class="wcr-slicers"><div class="wcr-sl"><label>Campus, Project Name</label><div class="wcr-sl-row">${dd("campus", campLabel, m.campuses, m.campusAll)}${dd("project", projLabel, m.projects, m.projectAll)}</div></div>
        <div class="wcr-sl"><label for="wcr-week">Week Ending</label><div class="wcr-sl-row"><select class="wk" id="wcr-week">${m.weeks.map((w) => `<option value="${w}" ${w === m.week ? "selected" : ""}>${esc(fmtMDY(w))}</option>`).join("")}</select></div></div>
        <div class="wcr-sl"><label>&nbsp;</label><div class="wcr-sl-row"><button class="wcr-btn" id="wcr-clear" type="button">Clear</button></div></div>
        <div class="wcr-fsum">Campus: <b>${esc(m.campusLabel)}</b> · Project Name: <b>${esc(m.projectLabel)}</b> · Week Ending: <b>${esc(fmtMDY(m.week))}</b></div></div>
      <div class="wcr-main">${page}</div>
      <footer class="wcr-foot"><div class="src">Source: GR Cost · HH2 labor, on-rent reports, Purchase Pro · Prepared ${esc(fmtMDY(m.today))}</div><button class="wcr-btn" id="wcr-print" type="button">Print</button></footer></div>`;
  }

  return { build, html, payBucket, weeklyOf, tradeOf, vendorColor, fmtCur, fmtMDY };
}));
