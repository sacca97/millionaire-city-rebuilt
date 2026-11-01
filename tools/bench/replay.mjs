#!/usr/bin/env node
// Replay/benchmark tool for the Rust server (docs/rust-server-performance.md).
//
//   node tools/bench/replay.mjs --bin <mcity-server> --port 33000 --out <dir> [--files a/cmds.jsonl,b/cmds.jsonl]
//        [--rounds 20] [--dbdir <disk dir>] [--clients 4] [--seconds 5] [--no-throughput] [--only cmd,cmd] [--replay-only]
//
// For every cmds.jsonl (oracle harness log of the cmdList payloads) it starts the binary on a fresh temp DB and:
//   1. "replay":  posts each logged /Game request verbatim, writes the normalised responses + a dump of the SQLite file
//                 (<out>/<name>.responses.jsonl, <name>.db.json) -> diff two runs (before/after) with tools/bench/diff.mjs.
//   2. "latency": splits every request into one request per command (same _dat) and posts them `rounds` times on the
//                 resulting state; reports p50/p99 per command type.
//   3. "throughput": `clients` parallel loops over those single-command requests for `seconds` seconds.
// Also reports startup time (spawn -> /health ok), peak RSS (VmHWM) and binary size. Results: <out>/summary.json.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "tools/conformance/package.json"));
const Database = require("better-sqlite3");

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "1" : all[i + 1]]] : a), []));
const BIN = path.resolve(args.bin ?? "apps/server-rs/target/release/mcity-server");
const PORT = Number(args.port ?? 33000);
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), "mcity-bench"));
const ROUNDS = Number(args.rounds ?? 20), CLIENTS = Number(args.clients ?? 4), SECONDS = Number(args.seconds ?? 5);
const defaultFiles = ["tutorial-full", "build-flow", "flow-build-flow"].map((d) => path.join(root, "tools/oracle/out", d, "cmds.jsonl"));
const FILES = args.files ? args.files.split(",") : defaultFiles;
const DBDIR = path.resolve(args.dbdir ?? os.tmpdir()); // use a disk-backed dir (not tmpfs) to include fsync cost
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DBDIR, { recursive: true });

const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadRequests(file) {
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const { body } = JSON.parse(line);
    // the logger stored the percent-decoded body "version=..&data={json}&uid=..&cmd=cmdList&flash_version=..&sig=.."
    const m = /^version=(.*?)&data=(.*)&uid=(.*?)&cmd=cmdList&flash_version=(.*?)&sig=(.*)$/s.exec(body);
    if (!m) continue;
    out.push({ version: m[1], data: m[2], uid: m[3], flash_version: m[4], sig: m[5] });
  }
  return out;
}
const form = (r, data) => new URLSearchParams({ version: r.version, data, uid: r.uid, cmd: "cmdList", flash_version: r.flash_version, sig: r.sig }).toString();
const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
// node:http with a keep-alive agent (fetch() adds ~1.5 ms of client overhead and would swamp the server's own time)
const post = (port, bodyStr) => new Promise((resolve, reject) => {
  const t0 = performance.now();
  const req = http.request({ host: "127.0.0.1", port, path: "/Game", method: "POST", agent, headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(bodyStr) } }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve({ ms: performance.now() - t0, status: res.statusCode, text: Buffer.concat(chunks).toString() }));
  });
  req.on("error", reject);
  req.setNoDelay(true);
  req.end(bodyStr);
});

async function startServer(name, port) {
  const tmp = fs.mkdtempSync(path.join(DBDIR, `mcity-bench-${name}-`));
  const db = path.join(tmp, "bench.sqlite");
  const env = { ...process.env, MCITY_DB_PATH: db, MCITY_HTTP_PORT: String(port), MCITY_HTTPS_PORT: String(port + 1), MCITY_FACEBOOK_PORT: String(port + 2) };
  const t0 = performance.now();
  const logFd = fs.openSync(path.join(OUT, `${name}.server.log`), "w");
  const child = spawn(BIN, [], { env, stdio: ["ignore", logFd, logFd] });
  let up = 0, tls = 0;
  for (let i = 0; i < 4000; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) { up = performance.now() - t0; break; } } catch {}
    await sleep(10);
  }
  if (!up) throw new Error("server did not start; see " + path.join(OUT, `${name}.server.log`));
  // HTTPS listener: wait for a completed TLS handshake (the certificate is generated before the listener starts)
  const tlsMod = await import("node:tls");
  for (let i = 0; i < 4000; i++) {
    const ok = await new Promise((res) => { const s = tlsMod.connect({ port: port + 1, host: "127.0.0.1", rejectUnauthorized: false }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
    if (ok) { tls = performance.now() - t0; break; }
    await sleep(10);
  }
  return { child, db, tmp, startupMs: up, tlsMs: tls };
}
// On-CPU time of all server threads (ns, /proc/<pid>/task/*/schedstat): robust against a busy machine, unlike wall-clock latency.
const cpuNs = (pid) => { let t = 0; try { for (const d of fs.readdirSync(`/proc/${pid}/task`)) t += Number(fs.readFileSync(`/proc/${pid}/task/${d}/schedstat`, "utf8").split(" ")[0]); } catch {} return t; };
const rssKb = (pid) => { try { return Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))[1]); } catch { return 0; } };
async function stop(srv) {
  const hwm = rssKb(srv.child.pid);
  srv.child.kill("SIGTERM");
  await new Promise((r) => { srv.child.once("exit", r); setTimeout(() => { srv.child.kill("SIGKILL"); }, 3000); });
  return hwm;
}

// Mask only values that genuinely vary between two runs of the same binary: wall-clock stamps and the server's random
// choices. Everything else must be identical before/after a change. `chk` is dropped because it is a checksum of the
// masked content. Add a key here only after seeing it vary between two runs of the same binary.
const MASK_KEYS = new Set(["savedAt", "dailyRewardsNextRewardId", "dailyRewardsLastGiven", "npcRonaldTimeLeft", "npcCindyTimeLeft"]);
// Wall-clock stamps (ms epoch, as number or string) in [start - 1 min, start + 14 days] are server-derived (now, timers).
let REPLAY_START = Date.now();
const isClockMs = (v) => { const n = typeof v === "number" ? v : typeof v === "string" && /^\d{13}$/.test(v) ? Number(v) : NaN; return n >= REPLAY_START - 60000 && n <= REPLAY_START + 14 * 86400000; };
function maskDeep(x) {
  if (isClockMs(x)) return "<ms>";
  if (Array.isArray(x)) return x.map(maskDeep);
  // `time` next to `savedAt` is the remaining countdown of a timed item (derived from now: 180000 vs 179999 between runs)
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, MASK_KEYS.has(k) || (k === "time" && "savedAt" in x) ? "<masked>" : maskDeep(v)]));
  return x;
}
function maskEnvelope(t) {
  const m = /^([\s\S]*?)<chk>-?\d+<\/chk>([\s\S]*?<!\[CDATA\[)([\s\S]*)(\]\]>[\s\S]*)$/.exec(t);
  if (!m) return t;
  try { return m[1] + m[2] + JSON.stringify(maskDeep(JSON.parse(m[3]))) + m[4]; } catch { return t; }
}
const maskDoc = (j) => { try { return JSON.stringify(maskDeep(JSON.parse(j))); } catch { return j; } };

function dumpDb(file) {
  const d = new Database(file, { readonly: true });
  const dump = {
    schema: d.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").all(),
    users: d.prepare("SELECT id,ext_id,name FROM users ORDER BY id").all(), // created_at varies
    sessions: d.prepare("SELECT user_id,sync FROM sessions ORDER BY user_id").all(),
    save_documents: d.prepare("SELECT user_id,tag,json FROM save_documents ORDER BY user_id,tag").all().map((r) => ({ ...r, json: maskDoc(r.json) })),
    meta: d.prepare("SELECT key,value FROM meta ORDER BY key").all().map((r) => ({ ...r, value: isClockMs(r.value) ? "<ms>" : r.value })),
  };
  d.close();
  return dump;
}

const summary = { bin: BIN, binSizeBytes: fs.statSync(BIN).size, files: {} };
const agg = {}, aggCpu = {};
const startups = [], tlsStarts = [], rss = [];
for (const file of FILES) {
  const name = path.basename(path.dirname(file));
  const reqs = loadRequests(file);
  REPLAY_START = Date.now();
  const srv = await startServer(name, PORT);
  startups.push(srv.startupMs); tlsStarts.push(srv.tlsMs);
  // 1. replay
  const lines = [];
  for (const r of reqs) {
    const resp = await post(PORT, form(r, r.data));
    lines.push(JSON.stringify({ status: resp.status, body: maskEnvelope(resp.text) }));
  }
  fs.writeFileSync(path.join(OUT, `${name}.responses.jsonl`), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, `${name}.db.json`), JSON.stringify(dumpDb(srv.db), null, 1)); // state after the verbatim replay
  // 2. latency per command type (single-command requests)
  const singles = [];
  for (const r of reqs) {
    let list; try { list = JSON.parse(r.data)._cmdList; } catch { continue; }
    for (const c of list ?? []) singles.push({ cmd: c._cmd, body: form(r, JSON.stringify({ _msgCount: 1, _cmdList: [c], _sync: 1 })) });
  }
  const lat = {}, cpu = {};
  const byCmd = {};
  for (const x of singles) if (!args.only || args.only.split(",").includes(x.cmd)) (byCmd[x.cmd] ??= []).push(x);
  if (!args["replay-only"]) for (const [cmd, list] of Object.entries(byCmd)) {
    const c0 = cpuNs(srv.child.pid);
    for (let k = 0; k < ROUNDS; k++) for (const x of list) { const r = await post(PORT, x.body); (lat[cmd] ??= []).push(r.ms); (agg[cmd] ??= []).push(r.ms); }
    const per = (cpuNs(srv.child.pid) - c0) / 1000 / (ROUNDS * list.length);
    cpu[cmd] = per; (aggCpu[cmd] ??= []).push([per, ROUNDS * list.length]);
  }
  // 3. throughput
  let tp = null;
  if (!args["no-throughput"] && !args["replay-only"]) {
    let n = 0; const end = performance.now() + SECONDS * 1000; const t0 = performance.now();
    await Promise.all(Array.from({ length: CLIENTS }, async (_, ci) => { for (let i = ci; performance.now() < end; i += CLIENTS) { await post(PORT, singles[i % singles.length].body); n++; } }));
    tp = { requests: n, seconds: (performance.now() - t0) / 1000, rps: n / ((performance.now() - t0) / 1000) };
  }
  const hwm = await stop(srv);
  rss.push(hwm);
  summary.files[name] = { requests: reqs.length, singleCommands: singles.length, startupMs: srv.startupMs, tlsReadyMs: srv.tlsMs, peakRssKb: hwm, throughput: tp,
    latencyMs: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: pct(v, 50), p99: pct(v, 99), cpuUs: cpu[k] }])) };
  fs.rmSync(srv.tmp, { recursive: true, force: true });
}
summary.startupMsHealth = pct(startups, 50); summary.startupMsTlsReady = pct(tlsStarts, 50); summary.peakRssKbMax = Math.max(...rss);
summary.latencyMs = Object.fromEntries(Object.entries(agg).map(([k, v]) => { const c = aggCpu[k] ?? []; const n = c.reduce((a, b) => a + b[1], 0); return [k, { n: v.length, p50: +pct(v, 50).toFixed(3), p99: +pct(v, 99).toFixed(3), cpuUs: +(c.reduce((a, b) => a + b[0] * b[1], 0) / (n || 1)).toFixed(1) }]; }));
const tps = Object.values(summary.files).map((f) => f.throughput?.rps).filter(Boolean);
summary.throughputRps = tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : null;
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
console.log(`binary ${(summary.binSizeBytes / 1e6).toFixed(2)} MB | startup(health) ${summary.startupMsHealth.toFixed(0)} ms | TLS port ready ${summary.startupMsTlsReady.toFixed(0)} ms | peak RSS ${(summary.peakRssKbMax / 1024).toFixed(1)} MB | throughput ${summary.throughputRps?.toFixed(0)} req/s (${CLIENTS} clients)`);
const rows = Object.entries(summary.latencyMs).sort((a, b) => b[1].n - a[1].n);
console.log("command".padEnd(34), "n".padStart(6), "p50 ms".padStart(8), "p99 ms".padStart(8), "cpu us/req".padStart(11));
for (const [k, v] of rows) console.log(k.padEnd(34), String(v.n).padStart(6), v.p50.toFixed(3).padStart(8), v.p99.toFixed(3).padStart(8), v.cpuUs.toFixed(1).padStart(11));
