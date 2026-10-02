/* buckets.js - the cost buckets, named and coloured exactly as GRforecast's
   forecast_model.js names and colours them, so a month exported from here
   drops into a forecast there without translation.

   Billable: Labor, Materials, Equipment, Subcontractors, Other.
   Control:  Non-Billables (shown, never in a billable total). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Buckets = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const LABOR = "LABOR", MATERIALS = "MATERIALS", EQUIPMENT = "EQUIPMENT",
    SUBCONTRACTORS = "SUBCONTRACTORS", OTHER = "OTHER", NON_BILLABLE = "NON_BILLABLE";
  const BILLABLE = [LABOR, MATERIALS, EQUIPMENT, SUBCONTRACTORS, OTHER];
  const ALL = [LABOR, MATERIALS, EQUIPMENT, SUBCONTRACTORS, OTHER, NON_BILLABLE];
  const META = {
    LABOR:          { name: "Labor",          hex: "#e0703a", print: "#eb6834" },
    MATERIALS:      { name: "Materials",      hex: "#3987e5", print: "#2a78d6" },
    EQUIPMENT:      { name: "Equipment",      hex: "#2f7d52", print: "#157245" },
    SUBCONTRACTORS: { name: "Subcontractors", hex: "#8b7fe6", print: "#4a3aa7" },
    OTHER:          { name: "Other",          hex: "#96923a", print: "#8c8a32" },
    NON_BILLABLE:   { name: "Non-Billables",  hex: "#e0558c", print: "#c2447a", control: true },
  };
  // Which feed fills which bucket. Purchases take the cost code's own bucket.
  const FEED_BUCKET = { labor: LABOR, rentals: EQUIPMENT };
  const zero = () => Object.fromEntries(ALL.map((b) => [b, 0]));
  return { LABOR, MATERIALS, EQUIPMENT, SUBCONTRACTORS, OTHER, NON_BILLABLE, BILLABLE, ALL, META, FEED_BUCKET, zero };
}));
