#!/usr/bin/env node
// node tools/bench/table.mjs <outdir> <label>...: min-over-repeats table (cpu us/req, p50 ms) per command and the global numbers.
import fs from "node:fs";
import path from "node:path";
const [dir, ...labels] = process.argv.slice(2);
const runs = Object.fromEntries(labels.map((l) => [l, fs.readdirSync(dir).filter((d) => d.startsWith(l + "-")).map((d) => JSON.parse(fs.readFileSync(path.join(dir, d, "summary.json"), "utf8")))]));
const min = (xs) => Math.min(...xs), med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const cmds = Object.keys(runs[labels[0]][0].latencyMs).sort((a, b) => runs[labels[0]][0].latencyMs[b].n - runs[labels[0]][0].latencyMs[a].n);
const show = ["update_item", "update_missions", "update_pollmanager", "get_world", ...cmds.filter((c) => !["update_item", "update_missions", "update_pollmanager", "get_world"].includes(c))];
console.log(["command", ...labels.flatMap((l) => [`${l} p50 ms`, `${l} p99 ms`, `${l} cpu us`])].join(" | "));
for (const c of show) console.log([c, ...labels.flatMap((l) => { const r = runs[l].map((s) => s.latencyMs[c]); return [min(r.map((x) => x.p50)).toFixed(3), min(r.map((x) => x.p99)).toFixed(3), min(r.map((x) => x.cpuUs)).toFixed(0)]; })].join(" | "));
for (const l of labels) { const r = runs[l]; console.log(`${l}: binary ${(r[0].binSizeBytes / 1e6).toFixed(2)} MB | startup health ${min(r.map((s) => s.startupMsHealth)).toFixed(0)} ms (min) / ${med(r.map((s) => s.startupMsHealth)).toFixed(0)} (median) | peak RSS ${min(r.map((s) => s.peakRssKbMax / 1024)).toFixed(1)} MB | throughput ${r.map((s) => s.throughputRps).filter(Boolean).length ? Math.max(...r.map((s) => s.throughputRps)).toFixed(0) : "-"} req/s (best of ${r.length})`); }
