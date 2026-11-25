#!/usr/bin/env node
// Headless idle soak: start the real server on a temp save, load the built client in headless Chromium and sample
// JS heap/DOM/views for a few minutes. No window is shown, so it is safe to run while working elsewhere.
//
//   node tools/perf/soak.mjs [--minutes 5] [--interval 15] [--out /tmp/mcity-soak.json]
//
// Requires a built client (make build) and Playwright's chromium in ~/.cache/ms-playwright (tools/oracle installs
// playwright-core). The save is seeded post-tutorial with today's daily reward already given, so no modal should
// hold the simulation on load.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serverBinaryPath } from "../server-binary.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "tools/conformance/package.json"));
const Database = require("better-sqlite3");
const { chromium } = createRequire(path.join(root, "tools/oracle/package.json"))("playwright-core");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const MINUTES = Number(arg("minutes", "5"));
const INTERVAL_S = Number(arg("interval", "15"));
const OUT = path.resolve(arg("out", path.join(os.tmpdir(), "mcity-soak.json")));
const DIST = path.join(root, "apps", "client", "dist", "index.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(DIST)) {
  console.error(`built client not found: ${DIST}\nrun \`make build\` first`);
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer(dbPath, ports, log) {
  const env = {
    ...process.env,
    MCITY_WORKSPACE_ROOT: root,
    MCITY_DB_PATH: dbPath,
    MCITY_HTTP_PORT: String(ports.http),
    MCITY_HTTPS_PORT: String(ports.https),
    MCITY_FACEBOOK_PORT: String(ports.fb),
    MCITY_DISABLE_FB_SHIM: "1",
  };
  const fd = fs.openSync(log, "w");
  const child = spawn(serverBinaryPath(), [], { cwd: root, env, stdio: ["ignore", fd, fd] });
  for (let i = 0; i < 2000; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early; see ${log}`);
    try {
      const r = await fetch(`http://127.0.0.1:${ports.http}/health`);
      await r.arrayBuffer();
      if (r.status === 200 || r.status === 400) return child;
    } catch {
      /* not up yet */
    }
    await sleep(25);
  }
  throw new Error(`server did not become healthy; see ${log}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

function seed(dbPath) {
  const db = new Database(dbPath);
  try {
    const rows = db.prepare("select tag, json from save_documents where user_id = 1").all();
    const update = db.prepare("update save_documents set json = ?, updated_at = ? where user_id = 1 and tag = ?");
    for (const { tag, json } of rows) {
      const doc = JSON.parse(json);
      let changed = false;
      if (tag === "universe") {
        const prof = doc.universe?.find((e) => Array.isArray(e.Profile))?.Profile;
        if (prof) {
          prof.tutorialEnd = "1";
          prof.bossGenre = "1";
          changed = true;
        }
      }
      if (tag === "dailyBonusInfo" && doc.dailyBonusInfo) {
        doc.dailyBonusInfo.dailyRewardsLastGivenDate = String(Date.now());
        changed = true;
      }
      if (changed) update.run(JSON.stringify(doc), new Date().toISOString(), tag);
    }
  } finally {
    db.close();
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcity-soak-"));
const dbPath = path.join(tmp, "soak.sqlite");
const log = path.join(tmp, "server.log");
const ports = { http: await freePort(), https: await freePort(), fb: await freePort() };
let server;
let browser;
const samples = [];
try {
  // First boot creates the schema/user; then seed the save while the server is stopped.
  server = await startServer(dbPath, ports, log);
  await stopServer(server);
  seed(dbPath);
  server = await startServer(dbPath, ports, log);

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME || undefined,
    args: [
      "--enable-precise-memory-info",
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("console:", m.text());
  });
  await page.goto(`http://127.0.0.1:${ports.http}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__mcity?.city), undefined, { timeout: 90_000 });

  const sample = () =>
    page.evaluate(() => {
      const m = performance.memory;
      const mc = window.__mcity;
      return {
        t: Date.now(),
        heap: m ? m.usedJSHeapSize : null,
        heapTotal: m ? m.totalJSHeapSize : null,
        nodes: document.getElementsByTagName("*").length,
        views: mc?.city?.views?.size ?? null,
        items: mc?.game?.items?.().length ?? null,
        visibleItems: mc?.city?.views ? [...mc.city.views.values()].filter((v) => v.view.container.visible).length : null,
      };
    });

  const started = Date.now();
  const end = started + MINUTES * 60_000;
  console.log(`soaking ${MINUTES} min (${MINUTES * 60 / INTERVAL_S} samples) at ${ports.http}`);
  while (Date.now() < end) {
    const s = await sample();
    samples.push(s);
    const heapMb = s.heap === null ? "n/a" : `${(s.heap / 1048576).toFixed(1)}MB`;
    console.log(`${String(Math.round((s.t - started) / 1000)).padStart(4)}s heap ${heapMb} nodes ${s.nodes} views ${s.views}`);
    await sleep(INTERVAL_S * 1000);
  }
  samples.push(await sample());
} finally {
  if (browser) await browser.close();
  await stopServer(server);
}

const heap = samples.map((s) => s.heap).filter((v) => v !== null);
const first = samples[0];
const last = samples[samples.length - 1];
const result = {
  minutes: MINUTES,
  samples,
  first,
  last,
  heapStart: first?.heap ?? null,
  heapEnd: last?.heap ?? null,
  heapDelta: first?.heap != null && last?.heap != null ? last.heap - first.heap : null,
  heapMax: heap.length ? Math.max(...heap) : null,
  nodeStart: first?.nodes ?? null,
  nodeEnd: last?.nodes ?? null,
};
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nheap ${first?.heap ?? "n/a"} -> ${last?.heap ?? "n/a"} bytes; nodes ${first?.nodes} -> ${last?.nodes}; ${OUT}`);
