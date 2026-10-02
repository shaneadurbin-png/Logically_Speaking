/* smoke_real.js - run the readers over a folder of REAL files and print each
   card's stamp. Nothing is saved and the files are never committed:
   `node tests/smoke_real.js <folder>`. Exits 1 if any card is refused. */
"use strict";
const fs = require("fs"), path = require("path");
const Intake = require("../app/intake.js");
const C = require("../app/common.js");
const dir = process.argv[2];
if (!dir) { console.error("usage: node tests/smoke_real.js <folder>"); process.exit(2); }
(async () => {
  const files = fs.readdirSync(dir).filter((f) => /\.(xlsx|xlsm|xls|csv|zip)$/i.test(f)).sort()
    .map((f) => ({ name: f.replace(/^[0-9a-f]{8}-/, ""), bytes: fs.readFileSync(path.join(dir, f)) }));
  const ctx = { labor: { rates: [], employees: {}, policy: {}, jobs: null }, vendorSettings: {}, jobMap: {} };
  const cards = await Intake.inspectAll(files, ctx);
  let bad = 0;
  for (const c of Intake.sortCards(cards)) {
    console.log(`${c.status.padEnd(16)} ${c.name}`);
    if (c.stamp) console.log(`                 ${c.stamp}`);
    if (c.reason) console.log(`                 ${c.reason}`);
    for (const n of c.notes || []) console.log(`                 - ${n}`);
    if (c.doc && c.doc.kind === "onrent") {
      const refs = Object.entries(c.doc.totals.jobRefCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
      console.log(`                 layout ${c.doc.layout}; as-of ${c.doc.as_of} (${c.doc.asOfSource}); job labels: ${refs.map(([k, v]) => `${k} x${v}`).join(", ")}`);
      const rent = c.doc.lines.reduce((t, l) => t + (l.monthly_rent_cents || 0), 0);
      console.log(`                 month rent ${C.fmtMoney(rent)}; periods: ${JSON.stringify(c.doc.lines.reduce((m, l) => (m[l.rate_period] = (m[l.rate_period] || 0) + 1, m), {}))}`);
    }
    if (c.doc && c.doc.kind === "hh2_labor") console.log(`                 ${c.doc.columns} columns; ${c.doc.totals.employees} employees; jobs ${Object.keys(c.doc.byJob).length}; held reasons ${JSON.stringify(Object.fromEntries(Object.entries(c.summary.held.byReason).map(([k, v]) => [k, v.rows])))}`);
    if (c.status === "refused") bad++;
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
