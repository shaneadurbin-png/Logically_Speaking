/* sage_rates.js - Sage's rate table export, the source of billable rates.

   Sage (Timberline) exports a rate table as one sheet, header on row 1,
   one row per certified class and pay ID with the billable Unit Price and
   the date it took effect:

     Rate Table, Rate Table Description, Cost Type, Rate Table, Effective
     Date, Unit Cost, Unit Price, Job, Extra, Cost Code, Category, Employee,
     Certified Class, Department, Union, Union Local, Union Class, PR Slip #,
     Pay ID, Pay Type, Pass Through Cost, Non-Billable

   Confirmed against the five "2026 Rate Table" exports of 2026-10-01 (SBN,
   BWI, AUS, PHL, DFW). A file may carry several tables. Rows whose class or
   pay ID is "*" are Sage's catch-alls (marked Non-Billable); they are
   counted and left out. Each key's rates are put in order of effective
   date, and each one runs until the next. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.SageRates = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";
  const REQUIRED = ["Rate Table", "Rate Table Description", "Effective Date", "Unit Price", "Certified Class", "Pay ID"];
  const pad2 = (n) => String(n).padStart(2, "0");

  function headerIndex(rows) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = (rows[i] || []).map((v) => C.norm(v));
      if (REQUIRED.every((h) => cells.includes(C.norm(h)))) return i;
    }
    return -1;
  }
  const looksLike = (wb) => headerIndex(C.rowsOf(wb.Sheets[wb.SheetNames[0]], 10)) >= 0;

  // "6-01-2025", "2025-06-01", a Date, a serial
  function effectiveDate(v) {
    const s = C.str(v);
    const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (m) return C.parseDate(`${m[3]}-${pad2(+m[1])}-${pad2(+m[2])}`);
    return C.parseDate(v);
  }

  function readWorkbook(wb, fileName = "this file") {
    const rows = C.rowsOf(wb.Sheets[wb.SheetNames[0]]);
    const hi = headerIndex(rows);
    if (hi < 0) throw new C.UnknownFormat(`${fileName} is not a Sage rate table export (no row with ${REQUIRED.join(", ")}).`);
    const col = {};
    (rows[hi] || []).forEach((v, j) => { const k = C.norm(v); if (k && !(k in col)) col[k] = j; });
    const at = (r, name) => r[col[C.norm(name)]];
    const tables = {}, keys = {};
    let skipped = 0, blank = 0;
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (C.isBlankRow(r)) { blank++; continue; }
      const excelRow = i + 1;
      const code = C.str(at(r, "Rate Table")), cclass = C.str(at(r, "Certified Class")), payId = C.str(at(r, "Pay ID"));
      if (!code) throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no Rate Table.`);
      if (cclass === "*" || payId === "*" || C.str(at(r, "Non-Billable")).toUpperCase() === "X") { skipped++; continue; }
      if (!cclass || !payId) throw new C.UnknownFormat(`${fileName}: row ${excelRow} has no Certified Class or Pay ID.`);
      const eff = effectiveDate(at(r, "Effective Date"));
      if (!eff || Number.isNaN(eff)) throw new C.UnknownFormat(`${fileName}: row ${excelRow}: Effective Date "${C.str(at(r, "Effective Date"))}" is not a date.`);
      const cents = C.cents(at(r, "Unit Price"));
      if (cents == null || Number.isNaN(cents) || cents < 0) throw new C.UnknownFormat(`${fileName}: row ${excelRow}: Unit Price "${C.str(at(r, "Unit Price"))}" is not money.`);
      const t = tables[code] || (tables[code] = { code, description: C.oneLine(at(r, "Rate Table Description")), rates: [], effectiveDates: new Set() });
      const key = [code, cclass, payId].join("|");
      const dupKey = key + "|" + eff;
      if (keys[dupKey]) throw new C.UnknownFormat(`${fileName}: rows ${keys[dupKey]} and ${excelRow} both set ${cclass} ${payId} in ${code} from ${C.fmtDay(eff)}.`);
      keys[dupKey] = excelRow;
      t.rates.push({ rate_table_code: code, certified_class: cclass.toUpperCase(), pay_id: payId.toUpperCase(), rate_cents: cents, effective_from: eff, effective_to: null, row_index: excelRow });
      t.effectiveDates.add(eff);
    }
    const list = Object.values(tables);
    if (!list.length) throw new C.UnknownFormat(`${fileName} has the header of a Sage rate table export and no rate rows.`);
    let count = 0;
    for (const t of list) {
      const byKey = {};
      for (const r of t.rates) (byKey[r.certified_class + "|" + r.pay_id] = byKey[r.certified_class + "|" + r.pay_id] || []).push(r);
      for (const arr of Object.values(byKey)) {
        arr.sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
        arr.forEach((r, i) => { r.effective_to = arr[i + 1] ? arr[i + 1].effective_from : null; });
      }
      t.rates.sort((a, b) => (a.certified_class + a.pay_id + a.effective_from < b.certified_class + b.pay_id + b.effective_from ? -1 : 1));
      t.effectiveDates = [...t.effectiveDates].sort();
      t.classes = [...new Set(t.rates.map((r) => r.certified_class))].sort();
      t.latest = t.effectiveDates[t.effectiveDates.length - 1];
      count += t.rates.length;
    }
    return { kind: "sage_rates", fileName, tables: list, totals: { tables: list.length, rates: count, skipped, blank } };
  }
  const read = (data, fileName) => readWorkbook(C.readBook(data), fileName);
  return { REQUIRED, looksLike, readWorkbook, read, effectiveDate };
}));
