/* sniff.js - what a dropped file IS, from what is inside it.

   Every file in a drop gets a kind, and the Update page says what it did
   with each one. A workbook is opened once here and handed on, so a reader
   never opens it twice. A name is used only to tell a workbook from a PDF
   from a zip; which layout it is comes from its contents. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./common.js"), require("./hh2.js"), require("./onrent_vendors.js"), require("./sage_rates.js"), require("./billable_sheets.js"), require("./purchase_pro.js"), require("./projects.js"), require("./jctd.js"));
  } else root.Sniff = factory(root.Common, root.HH2, root.OnRentVendors, root.SageRates, root.BillableSheets, root.PurchasePro, root.Projects, root.JCTD);
}(typeof self !== "undefined" ? self : this, function (C, HH2, V, Sage, Billable, PO, Projects, JCTD) {
  "use strict";

  /** From the name alone: what family of file. */
  function familyOf(path) {
    const p = String(path || "").replace(/\\/g, "/"), base = p.split("/").pop().toLowerCase();
    if (/^(desktop\.ini|thumbs\.db|\.ds_store)$/.test(base) || base.startsWith("~$") || base.startsWith("._") || /(^|\/)__macosx\//i.test(p)) return "system";
    if (base.endsWith(".zip")) return "zip";
    if (/\.(xlsx|xlsm|xls|csv|tsv)$/.test(base)) return "workbook";
    if (base.endsWith(".pdf")) return "pdf";
    if (/\.(eml|msg)$/.test(base)) return "email";
    return "other";
  }

  /** bytes + name -> {kind, wb?, layout?} or a refusal that says what was looked for. */
  function sniff(data, fileName) {
    const why = Billable.refusedFile(fileName);
    if (why) throw new C.NotForThisPage(why);
    const family = familyOf(fileName);
    if (family === "system") return { kind: "system" };
    if (family === "zip") return { kind: "zip" };
    if (family === "pdf") return { kind: "pdf" };
    if (family === "email") throw new C.NotForThisPage(`${fileName}: emails arrive through the inbox in the next release.`);
    if (family === "other") throw new C.NotForThisPage(`${fileName}: not a workbook (.xlsx, .xlsm, .csv), so nothing here reads it.`);
    let wb;
    try { wb = C.readBook(data); }
    catch (e) { throw new C.NotForThisPage(`${fileName} could not be opened as a workbook (${e.message}).`); }
    if (!wb.SheetNames.length) throw new C.NotForThisPage(`${fileName} has no sheets.`);
    if (HH2.looksLike(wb)) return { kind: "hh2_labor", wb };
    if (Sage.looksLike(wb)) return { kind: "sage_rates", wb };
    if (Billable.looksLike(wb)) return { kind: "billable_rates", wb };
    if (PO.looksLike(wb)) return { kind: "purchase_orders", wb };
    if (JCTD.looksLike(wb)) return { kind: "jctd", wb };
    if (Projects.looksLike(wb)) return { kind: "projects", wb };
    const first = C.rowsOf(wb.Sheets[wb.SheetNames[0]], 25);
    const m = V.match(first);
    if (m) return { kind: "onrent", wb, layout: m.layout.layout };
    throw new C.NotForThisPage(`${fileName} is not a layout this page reads: not HH2's Labor Detail export (sheet "${HH2.SHEET}", or the weekly cost workbook's "${HH2.WCD_SHEET}" sheet), ` +
      `not a Sage rate table export, not a Liberty billable rate sheet, not a Purchase Pro PO export, not a Job Cost To Date export, not a Projects register, and not an on-rent report (${V.LAYOUTS.filter((l) => l.confirmed).map((l) => l.name).join(", ")}). ` +
      `Its sheets: ${wb.SheetNames.slice(0, 6).join(", ")}.`);
  }

  return { familyOf, sniff };
}));
