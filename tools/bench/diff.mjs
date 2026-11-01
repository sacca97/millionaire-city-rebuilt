#!/usr/bin/env node
// node tools/bench/diff.mjs <outA> <outB>: compares the replay responses and DB dumps of two replay.mjs runs.
import fs from "node:fs";
import path from "node:path";
const [a, b] = process.argv.slice(2);
let bad = 0, files = 0;
for (const f of fs.readdirSync(a).filter((f) => /\.(responses\.jsonl|db\.json)$/.test(f))) {
  files++;
  const x = fs.readFileSync(path.join(a, f), "utf8"), y = fs.readFileSync(path.join(b, f), "utf8");
  if (x === y) { console.log("same     ", f); continue; }
  bad++;
  const xl = x.split("\n"), yl = y.split("\n");
  const i = xl.findIndex((l, i) => l !== yl[i]);
  console.log("DIFFERENT", f, "first differing line", i + 1);
  console.log("  A:", xl[i]?.slice(0, 300)); console.log("  B:", yl[i]?.slice(0, 300));
}
console.log(bad ? `${bad} of ${files} files differ` : `all ${files} files identical`);
process.exit(bad ? 1 : 0);
