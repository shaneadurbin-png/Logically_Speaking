/* common.js - what every reader shares: the refusals, the money, the dates.

   Runs in the browser (window.Common) and in Node (require), like every
   reader here, so the page and the tests exercise one copy. No network. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./vendor/xlsx.full.min.js"));
  } else {
    root.Common = factory(root.XLSX);
  }
}(typeof self !== "undefined" ? self : this, function (XLSX) {
  "use strict";

  // ---- refusals -------------------------------------------------------------
  // A file this page does not read is turned away with a reason a person can
  // act on. Nothing is skipped in silence and nothing is guessed around.
  class Refusal extends Error {
    constructor(message, extra) {
      super(message);
      this.name = new.target.name;
      if (extra) Object.assign(this, extra);
    }
  }
  class UnknownFormat extends Refusal {}    // looks like one of ours, but is not, exactly
  class NotForThisPage extends Refusal {}   // not a kind this page reads at all
  class NeedsDecision extends Refusal {}    // a person has to say something first

  // ---- text -----------------------------------------------------------------
  const str = (v) => (v == null ? "" : String(v).trim());
  const clean = (v) => (v == null ? "" : String(v).replace(/\r\n?/g, "\n").replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, ""));
  const oneLine = (v) => clean(v).replace(/\s+/g, " ").trim();
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  /** Number from a number or a string like "$1,234.50", "(12.00)", "-3".
      null = empty; NaN = not a number. */
  function toNumber(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
    if (typeof v !== "string") return NaN;
    let s = v.trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
    s = s.replace(/[$,\s]/g, "");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    const n = Number(s);
    return neg ? -n : n;
  }

  // ---- money: integer cents everywhere, dollars only at the edges ----------
  // Math.round(-2.5) is -2 in JavaScript; money rounds half away from zero,
  // the way Postgres round(numeric) does, so the page and the views agree.
  const roundHalfUp = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
  /** Cents from dollars (number or text). null = empty; NaN = not money. */
  function cents(v) {
    const n = toNumber(v);
    if (n == null || Number.isNaN(n)) return n;
    return roundHalfUp(n * 100 + (n < 0 ? -1e-7 : 1e-7));
  }
  /** Hundredths of an hour from a number of hours (8.5 -> 850). */
  function hoursX100(v) {
    const n = toNumber(v);
    if (n == null || Number.isNaN(n)) return n;
    return roundHalfUp(n * 100 + (n < 0 ? -1e-7 : 1e-7));
  }
  /** Apply basis points to cents: bp(10000, 700) = 700. */
  const bp = (c, basisPoints) => roundHalfUp(c * basisPoints / 10000);
  const fromCents = (c) => c / 100;

  function groupDigits(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  /** "$1,234.56"; negative as "-$1,234.56"; null as em dash. */
  function fmtMoney(c, opts) {
    if (c == null || Number.isNaN(c)) return "—";
    const whole = (opts && opts.whole) || false;
    const a = Math.abs(c);
    const d = whole ? String(Math.round(a / 100)) : String(Math.floor(a / 100));
    const text = "$" + groupDigits(d) + (whole ? "" : "." + String(a % 100).padStart(2, "0"));
    return (c < 0 ? "-" : "") + text;
  }
  /** "3,214.5" from hundredths of an hour; trailing zeros trimmed. */
  function fmtHours(x100) {
    if (x100 == null || Number.isNaN(x100)) return "—";
    const a = Math.abs(x100);
    let frac = String(a % 100).padStart(2, "0").replace(/0$/, "");
    if (frac === "0") frac = "";
    return (x100 < 0 ? "-" : "") + groupDigits(String(Math.floor(a / 100))) + (frac ? "." + frac : "");
  }
  const fmtInt = (n) => groupDigits(String(Math.round(n)));

  // ---- dates: ISO day strings, local, never UTC ------------------------------
  const pad2 = (n) => String(n).padStart(2, "0");
  const isDate = (v) => Object.prototype.toString.call(v) === "[object Date]";
  const isoDay = (d) => (isDate(d) && !isNaN(d.getTime())
    ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : "");
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  function fromSerial(s) {
    if (!(s >= 1 && s < 2958466)) return null;
    let n = Math.floor(s);
    if (n < 61) n += 1;                       // Excel's 29 Feb 1900 that never was
    const d = new Date(EXCEL_EPOCH + n * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  function validDay(y, m, d) {
    const t = new Date(y, m - 1, d);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
  }
  /** ISO day from a Date, an Excel serial, "2026-09-15", "9/15/2026", "9/15/26",
      "2026-09-15T..."; null = empty; NaN = not a date. */
  function parseDate(v) {
    if (v == null || v === "") return null;
    if (isDate(v)) return isNaN(v.getTime()) ? NaN : isoDay(v);
    if (typeof v === "number") { const r = fromSerial(v); return r == null ? NaN : r; }
    const s = String(v).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
    if (m) return validDay(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}` : NaN;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?:\s.*)?$/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return validDay(y, +m[1], +m[2]) ? `${y}-${pad2(+m[1])}-${pad2(+m[2])}` : NaN;
    }
    return NaN;
  }
  const dateOf = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoDay(d); };
  const monthOf = (iso) => iso.slice(0, 7);
  const monthStart = (ym) => ym + "-01";
  function monthEnd(ym) { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0); return isoDay(d); }
  /** The Sunday on or after a day (a Sunday stays). */
  function sundayOnOrAfter(iso) { const d = dateOf(iso); return addDays(iso, (7 - d.getDay()) % 7); }
  /** "Sep 15, 2026" */
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDay = (iso) => (iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}` : "—");
  const fmtMonth = (ym) => (ym ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : "—");
  const todayIso = () => isoDay(new Date());

  // ---- bytes ------------------------------------------------------------------
  const toU8 = (data) => (data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data)
    : typeof Buffer !== "undefined" && Buffer.isBuffer(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : null);
  /** Hex SHA-256 of a file's bytes (WebCrypto in the browser, node:crypto in Node). */
  async function sha256Hex(data) {
    const u8 = toU8(data);
    if (!u8) throw new Error("sha256Hex: not bytes");
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const h = await crypto.subtle.digest("SHA-256", u8);
      return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return require("crypto").createHash("sha256").update(u8).digest("hex");
  }

  // ---- sheets ----------------------------------------------------------------
  /** A workbook from bytes (xlsx, xlsm, xls, csv). */
  function readBook(data) {
    const u8 = toU8(data);
    if (!u8) throw new NotForThisPage("not a file this page can open (no bytes).");
    return XLSX.read(u8, { type: "array", cellDates: true, raw: true });
  }
  /** Every row from A1 as arrays, so index = Excel row - 1 wherever the
      sheet's recorded range starts. */
  function rowsOf(ws, maxRows) {
    if (!ws || !ws["!ref"]) return [];
    const r = XLSX.utils.decode_range(ws["!ref"]);
    r.s.r = 0; r.s.c = 0;
    if (maxRows != null) r.e.r = Math.min(r.e.r, maxRows - 1);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true, range: r });
  }
  const isBlankRow = (r) => !r || r.every((v) => v == null || (typeof v === "string" && !v.trim()));
  /** Header cells as trimmed strings, trailing empties dropped. */
  function headerOf(row) {
    const h = (row || []).map((v) => (v == null ? "" : String(v).trim()));
    while (h.length && !h[h.length - 1]) h.pop();
    return h;
  }
  const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

  return {
    Refusal, UnknownFormat, NotForThisPage, NeedsDecision,
    str, clean, oneLine, num, toNumber,
    roundHalfUp, cents, hoursX100, bp, fromCents, fmtMoney, fmtHours, fmtInt,
    isDate, isoDay, parseDate, fromSerial, addDays, monthOf, monthStart, monthEnd, sundayOnOrAfter,
    fmtDay, fmtMonth, todayIso, MONTHS,
    toU8, sha256Hex, readBook, rowsOf, isBlankRow, headerOf, norm,
  };
}));
