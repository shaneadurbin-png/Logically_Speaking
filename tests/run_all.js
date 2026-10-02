/* run_all.js - runs every tests/test_*.js in its own process and exits 1 if
   any of them does. `node tests/run_all.js` */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");
const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => /^test_.*\.js$/.test(f)).sort();
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) { bad++; console.error(`  ^ ${f} exited ${r.status}`); }
}
console.log(bad ? `\n${bad} of ${files.length} test files FAILED` : `\nall ${files.length} test files passed`);
process.exit(bad ? 1 : 0);
