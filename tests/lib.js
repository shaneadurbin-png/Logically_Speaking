/* lib.js - the little test harness every tests/test_*.js uses.
   check(name, fn) records a pass or a fail; done() prints the tally and
   exits 1 on any failure, so run_all.js and CI see it. */
"use strict";
const C = require("../app/common.js");
let passes = 0, fails = 0;
function check(name, fn) {
  try { fn(); passes++; }
  catch (e) { fails++; console.error(`  FAIL ${name}\n       ${e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); passes++; }
  catch (e) { fails++; console.error(`  FAIL ${name}\n       ${e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e}`); }
}
function eq(got, want, msg) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg || "mismatch"}: expected ${w}, got ${g}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "expected truthy"); }
/** fn must throw a Refusal (optionally matching re); returns the error. */
function refuses(fn, re, msg) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (!err) throw new Error(`${msg || "call"}: did not refuse`);
  if (!(err instanceof C.Refusal)) throw new Error(`${msg || "call"}: threw ${err.name}, not a Refusal: ${err.message}`);
  if (re && !re.test(err.message)) throw new Error(`${msg || "call"}: refusal says "${err.message}", expected ${re}`);
  return err;
}
function done(label) {
  console.log(`${label || process.argv[1].split(/[\\/]/).pop()}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}
module.exports = { check, checkAsync, eq, ok, refuses, done, C };
