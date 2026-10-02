/* onrent_vendors.js - the on-rent report layouts this page reads, one entry
   per layout, matched by what is IN the file, never by its name.

   An entry is `confirmed` only once it has been checked against a real
   export from that vendor; `confirmed_from` says which. The three vendor
   layouts below were confirmed on 2026-10-01 against Shane's own exports
   (docs/LEDGER.md L-02). An unconfirmed entry is listed so Settings can say
   "awaiting a real export", and the reader refuses it.

   What a layout says:
     header.required   column names that must all be on one row (the header
                       row is found by scanning the first 25 rows, so a title
                       block above it is fine)
     header.absent     column names that must NOT be on that row (one vendor's
                       cut of another of its reports)
     columns           field -> column name; an array means "first that has
                       a value"; every field but equipment_no, contract_no,
                       job_ref and qty is optional. equipment_fallback names
                       columns joined with "-" when no unit number is given
                       (a bulk item's category-class code)
     identify          a column whose values must match a pattern, so a file
                       with the right columns and the wrong vendor refuses
     skip              rows to skip by their first cell (a vendor's Totals row)
     only              rows that count: a column and the value it must carry
                       (EquipmentShare's Status = On-rent); the rest are
                       counted and listed, never lost in silence
     as_of             where the report's date comes from: a column, the file
                       name, derived (Date Rented + Number of Days on Rent, the
                       same on every line), or none of these (the person is asked)
     unit_by_serial    no quantity column: a line with a serial number is one
                       unit; a line without is a bulk line whose quantity the
                       export does not say (shown at its rate, not counted)
     monthly           how a month's rent is read: "monthly" (a monthly figure
                       column), "month_rate", or "fourweek_rate" (x qty) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./common.js"));
  else root.OnRentVendors = factory(root.Common);
}(typeof self !== "undefined" ? self : this, function (C) {
  "use strict";

  const GENERIC_COLUMNS = {
    vendor: "Vendor", equipment_no: "Equipment #", contract_no: "Contract #", job_ref: "Job",
    description: "Description", qty: "Qty", on_rent_date: "On Rent Date", rate_period: "Rate Period",
    rate: "Rate", monthly_rent: "Monthly Rent", as_of: "As Of", liberty_owned: "Liberty Owned", cost_code: "Cost Code",
  };

  const LAYOUTS = [
    {
      layout: "generic", name: "GR Cost on-rent CSV", confirmed: true, confirmed_from: "the page's own layout",
      header: { required: ["Vendor", "Equipment #", "Contract #", "Job", "Description", "Qty", "Rate Period", "Rate", "Monthly Rent"] },
      columns: GENERIC_COLUMNS, as_of: { column: "As Of", name: true }, monthly: "generic",
      note: "The page's own layout. Save any report with these columns and it reads today.",
    },
    {
      layout: "sunbelt", vendor_key: "sunbelt", name: "Sunbelt Rentals - Equipment on Rent (account export, .csv)", confirmed: true,
      confirmed_from: "Equipment on Rent - LIBERTY BUILDS-SNB Acct 1011435.csv, 2026-10-01",
      header: { required: ["Account #", "Contract #", "Job #", "Equipment #", "Equipment Type", "Quantity", "Day Rate", "Week Rate", "4 Week Rate", "Billed Through", "Date Rented", "Customer Name"] },
      columns: { equipment_no: "Equipment #", contract_no: "Contract #", line_ref: "Contract Line", job_ref: ["Job Name", "Job #"], job_ref_alt: "Job #",
        description: ["Equipment Type", "Class Name"], qty: "Quantity", on_rent_date: "Date Rented",
        day_rate: "Day Rate", week_rate: "Week Rate", fourweek_rate: "4 Week Rate",
        po: "PO_Number", est_return: "Est Return Date", billed_through: "Billed Through", pickup_date: "Pickup Date",
        ordered_by: "Ordered By", account: "Account #", cat_class: "Cat-Class", make: "Make", model: "Model", serial: "Serial #" },
      identify: { column: "Customer Name", pattern: /SNB|SUNBELT/i, says: "Sunbelt's account export carries the customer as LIBERTY BUILDS-SNB" },
      as_of: { column: null, name: false }, monthly: "fourweek_rate",
      note: "Sunbelt quotes day, week and 4-week rates; the 4-week rate x quantity is the month's rent. The export does not say its date, so the page asks.",
    },
    {
      layout: "sunbelt_all_jobs", vendor_key: "sunbelt", name: "Sunbelt Rentals - Equipment on Rent - All Jobs (every account, .csv)", confirmed: true,
      confirmed_from: "Equipment on Rent - All Jobs.csv of 2026-10-02 (773 lines, 10 accounts), checked line by line against the account export of the same day",
      header: { required: ["Account #", "Contract #", "Job #", "Job_Location", "Job Name", "PO_Number", "Equipment Type", "Cat-Class", "Equipment #", "Serial #", "Day Rate", "Week Rate", "4 Week Rate", "Date Rented", "Number of Days on Rent"],
        absent: ["Quantity", "Customer Name"] },
      columns: { equipment_no: "Equipment #", contract_no: "Contract #", job_ref: ["Job Name", "Job #"], job_ref_alt: "Job #",
        description: "Equipment Type", on_rent_date: "Date Rented", day_rate: "Day Rate", week_rate: "Week Rate", fourweek_rate: "4 Week Rate",
        po: "PO_Number", est_return: "Est Return Date", account: "Account #", cat_class: "Cat-Class", make: "Make", model: "Model", serial: "Serial #",
        days_on_rent: "Number of Days on Rent", job_location: "Job_Location" },
      identify: { column: "Cat-Class", pattern: /^\d{3}-\d{4}$/, says: "Sunbelt's category-class codes read like 012-0317" },
      unit_by_serial: true, as_of: { column: null, derive: "rented_plus_days", name: true }, monthly: "fourweek_rate",
      note: "Every Sunbelt account and job in one file, a line per contract line, no Quantity column. A line with a serial number is one unit; a line without (cable, deck panels, mats) may be many, so it shows its 4-week rate and is not counted; the account export carries quantities. The day it ran is Date Rented + Number of Days on Rent, which every line must agree on.",
    },
    {
      layout: "herc", vendor_key: "herc", name: "Herc Rentals - Equipment On Rent Summary (.xlsx)", confirmed: true,
      confirmed_from: "Equipment On Rent Summary-06-24-2026_175716.xlsx, report date 10/01/2026",
      header: { required: ["Account Name", "Contract Number", "Cat Class", "Cat Class Description", "Date Out", "Day Rate $", "Week Rate $", "Month Rate $", "Equipment Quantity", "Report Date", "Vendor", "Job Name"] },
      columns: { equipment_no: ["Serial Number", "IC Number", "Cat Class"], contract_no: "Contract Number", line_ref: "Invoice Number",
        job_ref: ["Job Name", "Job Number", "Job Location"], job_ref_alt: "Job Number", description: ["Cat Class Description", "IC Description"],
        qty: "Equipment Quantity", on_rent_date: ["Date Out", "Start Date"], day_rate: "Day Rate $", week_rate: "Week Rate $", month_rate: "Month Rate $",
        po: "Purchase Order", est_return: "Estimated Return Date", billed_through: "Last Bill Date", next_bill: "Next Bill Date",
        ordered_by: "Ordered By", account: "Account Number", cat_class: "Cat Class", make: "Make", model: "Model", serial: "Serial Number", as_of: "Report Date" },
      identify: { column: "Vendor", pattern: /HERC/i, says: "Herc's report names Herc Rentals in its Vendor column" },
      skip: ["Totals"], as_of: { column: "Report Date", name: false }, monthly: "month_rate",
      note: "Header on row 4 under a title block, a Totals row beneath it. A saved report's file name carries the day it was set up, not the day it ran, so the date comes from the Report Date column only.",
    },
    {
      layout: "united_rentals", vendor_key: "united_rentals", name: "United Rentals - Total Control, Equipment On Rent - All Jobs (.xls)", confirmed: true,
      confirmed_from: "Equipment_On_Rent_-_All_Jobs_2026-10-01-04.21.10.XLS",
      header: { required: ["ContractNumber", "EquipmentNumber", "EqpDescription", "DateOut", "Quantity", "JobName", "DailyRate", "WeeklyRate", "MonthlyRate", "AccountName", "Equipment Source"] },
      columns: { equipment_no: ["EquipmentNumber", "EquipmentSerialNum"], equipment_fallback: ["EquipmentCategory", "EquipmentClass"],
        contract_no: "ContractNumber", job_ref: ["JobName", "Jobsite ID"], job_ref_alt: "Jobsite ID",
        description: "EqpDescription", qty: "Quantity", on_rent_date: "DateOut", day_rate: "DailyRate", week_rate: "WeeklyRate", month_rate: "MonthlyRate",
        po: "PurchaseOrderNumber", est_return: "EstimatedReturnDate", billed_through: "LastBilledDate", pickup_date: "PickupDate",
        ordered_by: "OrderedBy", account: "AccountName", serial: "EquipmentSerialNum", make: "EquipmentMake", model: "EquipmentModel",
        code1: "AcctCode1", code1_label: "AcctDesc1", code2: "AcctCode2", code2_label: "AcctDesc2", days_on_rent: "Days on Rent", billed_to_date: "TotalAmountBilled" },
      identify: { column: "Equipment Source", pattern: /UNITED|^\s*$/i, says: "Total Control's Equipment Source column reads UNITED RENTALS" },
      as_of: { column: null, name: true }, monthly: "month_rate",
      note: "One export for every Liberty account and job; the file name carries the export time, which is the report's date. Non-serialised items repeat a line per unit; each is numbered. Bulk items (hoses, cages, tanks) carry no unit number and are identified by their category-class code.",
    },
    {
      layout: "equipmentshare", vendor_key: "equipmentshare", name: "EquipmentShare - rentals export (.csv)", confirmed: true,
      confirmed_from: "rentals-export.csv of 2026-08-07 (Drive); the September export adds columns and reads the same",
      header: { required: ["Product", "Status", "Class", "Qty", "Rental ID", "Order ID", "Location Name", "Price Per Day ($)", "Price Per Week ($)", "Price Per Month ($)", "Start Date", "Vendor"] },
      columns: { equipment_no: ["Product", "Rental ID"], contract_no: "Order ID", line_ref: "Rental ID", job_ref: ["Location Name", "Job"], job_ref_alt: "Job",
        description: "Class", make: "Make", model: "Model", qty: "Qty", on_rent_date: "Start Date", day_rate: "Price Per Day ($)", week_rate: "Price Per Week ($)", month_rate: "Price Per Month ($)",
        po: "PO #", est_return: "End Date", next_bill: "Next Billing", ordered_by: "Ordered By", status: "Status", shift: "Shift Type", days_on_rent: "Duration (days)" },
      identify: { column: "Vendor", pattern: /EQUIPMENT ?SHARE/i, says: "EquipmentShare's export names itself in its Vendor column" },
      only: { column: "Status", value: "On-rent", means: "not on rent" },
      as_of: { column: null, name: true }, monthly: "month_rate",
      note: "The portal's rentals export. Only On-rent rows are rentals; other statuses are counted and listed. The export does not date itself, so a date in the file name is used (EquipShare_rentals-export_9.4.26.csv) or the page asks.",
    },
    {
      layout: "equipmentshare_onrent", vendor_key: "equipmentshare", name: "EquipmentShare - On Rent Report (.csv)", confirmed: true,
      confirmed_from: "On Rent Report_ES.csv of 2026-10-02 (79 assets across every job)",
      header: { required: ["Asset", "Rental Id", "Make & Model", "Class", "Serial/VIN", "Jobsite", "Purchase Order", "Vendor", "Rental Start Date", "Scheduled Off Rent Date", "Price per Day", "Price per Week", "Price per Month", "Total Days on Rent"] },
      columns: { equipment_no: ["Asset", "Serial/VIN"], contract_no: "Rental Id", line_ref: "Rental Id", job_ref: "Jobsite",
        description: "Class", make: "Make & Model", serial: "Serial/VIN", on_rent_date: "Rental Start Date", est_return: "Scheduled Off Rent Date",
        day_rate: "Price per Day", week_rate: "Price per Week", month_rate: "Price per Month", po: "Purchase Order",
        ordered_by: "Ordered By", next_bill: "Next Cycle Date", days_on_rent: "Total Days on Rent", billed_to_date: "Total Invoiced Amount" },
      identify: { column: "Vendor", pattern: /EQUIPMENT ?SHARE/i, says: "EquipmentShare's report names itself in its Vendor column" },
      as_of: { column: null, derive: "rented_plus_days", name: true }, monthly: "month_rate",
      note: "The portal's On Rent Report: every asset on rent across every job, one line each (no quantity column: a line is one asset). The report does not date itself; Rental Start Date + Total Days on Rent is the day it ran, on every line.",
    },
    { layout: "mcw", name: "Mission Critical Warehouse (1-SL rental invoices, Liberty-owned)", confirmed: false, vendor_key: "mcw",
      note: "PDF invoices; read in the release that opens PDFs." },
  ];

  // Rental companies, with the names their reports call themselves.
  const VENDORS = [
    { vendor_key: "united_rentals", name: "United Rentals", aliases: ["united rentals", "united", "ur", "total control"], taxable: true },
    { vendor_key: "sunbelt", name: "Sunbelt Rentals", aliases: ["sunbelt", "sunbelt rentals", "snb"], taxable: true },
    { vendor_key: "herc", name: "Herc Rentals", aliases: ["herc", "herc rentals"], taxable: true },
    { vendor_key: "equipmentshare", name: "EquipmentShare", aliases: ["equipmentshare", "equipment share", "t3"], taxable: true },
    { vendor_key: "mcw", name: "Mission Critical Warehouse", aliases: ["mcw", "mission critical warehouse", "mission critical"], taxable: false, liberty_owned: true },
  ];
  const slug = (s) => C.norm(s).replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
  /** {vendor_key, name, known, ...} from a name a report uses; an unknown name gets a slug key. */
  function vendorFromName(name) {
    const n = C.norm(name);
    if (!n) return null;
    for (const v of VENDORS) if (v.aliases.includes(n) || slug(n) === v.vendor_key) return { vendor_key: v.vendor_key, name: v.name, known: true, liberty_owned: !!v.liberty_owned, taxable: v.taxable };
    return { vendor_key: slug(name), name: C.oneLine(name), known: false, liberty_owned: false, taxable: true };
  }  /** a vendor name as another system spells it ("United Rentals (North America)") -> the feed vendor, or null */
  function vendorFromText(text) {
    const n = String(text || "").toLowerCase();
    if (!n) return null;
    const exact = vendorFromName(text); if (exact && exact.known) return exact;
    // the same rule app.recurring_candidates applies in SQL: the text contains the vendor's name as Settings spells it
    for (const v of VENDORS) if (n.includes(v.name.toLowerCase())) return { vendor_key: v.vendor_key, name: v.name, known: true, liberty_owned: !!v.liberty_owned, taxable: v.taxable };
    return null;
  }

  const vendorName = (key) => { const v = VENDORS.find((x) => x.vendor_key === key); return v ? v.name : key; };
  const layoutOf = (key) => LAYOUTS.find((l) => l.layout === key) || null;

  /** Where a layout's header row is: {rowIndex, col: {header name: index}} or null. */
  function locate(rows, layout) {
    if (!layout.confirmed || !layout.header) return null;
    const required = layout.header.required.map((h) => C.norm(h));
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const cells = (rows[i] || []).map((v) => C.norm(v));
      if (!required.every((h) => cells.includes(h))) continue;
      if (layout.header.absent && layout.header.absent.some((h) => cells.includes(C.norm(h)))) continue;
      const col = {};
      (rows[i] || []).forEach((v, j) => { const k = C.norm(v); if (k && !(k in col)) col[k] = j; });
      return { rowIndex: i, col };
    }
    return null;
  }

  /** The first confirmed layout whose header is in the sheet, or null. */
  function match(rows) {
    for (const layout of LAYOUTS) {
      const at = locate(rows, layout);
      if (at) return { layout, rowIndex: at.rowIndex, col: at.col };
    }
    return null;
  }

  const confirmed = () => LAYOUTS.filter((l) => l.confirmed);
  const awaiting = () => LAYOUTS.filter((l) => !l.confirmed);

  return { LAYOUTS, VENDORS, GENERIC_COLUMNS, vendorFromName, vendorFromText, vendorName, layoutOf, locate, match, confirmed, awaiting };
}));
