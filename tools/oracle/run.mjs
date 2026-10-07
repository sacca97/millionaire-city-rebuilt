#!/usr/bin/env node
// usage: node tools/oracle/run.mjs <scenario>   (scenarios/<scenario>.mjs)
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createOracle } from "./lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const dir = path.join(here, "scenarios");
if (!name || !fs.existsSync(path.join(dir, name + ".mjs"))) {
  console.error("usage: run.mjs <scenario>\navailable: " + fs.readdirSync(dir).map((f) => f.replace(/\.mjs$/, "")).join(", "));
  process.exit(2);
}
const sc = (await import(path.join(dir, name + ".mjs"))).default;
const o = await createOracle(name, { seed: sc.seed, width: sc.width, height: sc.height });
let code = 0;
const onSig = () => o.stop().finally(() => process.exit(130));
process.on("SIGINT", onSig); process.on("SIGTERM", onSig);
try { o.launch({ query: sc.query }); await o.waitCtl(); await sc.run(o); console.log("outputs in", o.outDir); }
catch (e) { console.error(e); code = 1; try { await o.shot("failure"); } catch {} }
finally { await o.stop(); }
process.exit(code);
