// Oracle harness helpers: isolated server + original Flash client under Xvfb.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../..");
const require = createRequire(path.join(root, "apps/server/package.json"));
const Database = require("better-sqlite3");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PB = Number(process.env.MCITY_ORACLE_PORT_BASE ?? 31833);
const P = { http: PB, https: PB + 1, fb: PB + 2, ctl: PB + 3 };

export async function createOracle(name, { width = 1280, height = 800, seed } = {}) {
  const outDir = path.join(here, "out", name);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcity-oracle-"));
  const dbPath = path.join(tmp, "oracle.sqlite");
  const children = [];
  const spawnGrp = (cmd, args, opts, logName) => {
    const log = fs.openSync(path.join(outDir, logName), "w");
    const c = spawn(cmd, args, { ...opts, detached: true, stdio: ["ignore", log, log] });
    children.push(c);
    return c;
  };
  const stopAll = async () => { // kill only process groups we started
    for (const c of children) { try { process.kill(-c.pid, "SIGTERM"); } catch {} }
    await sleep(1000);
    for (const c of children) { try { process.kill(-c.pid, "SIGKILL"); } catch {} }
  };
  const o = { outDir, dbPath, ports: P, width, height, stopAll, n: 0 };

  spawnGrp("npx", ["tsx", "src/main.ts"], {
    cwd: path.join(root, "apps/server"),
    env: { ...process.env, MCITY_CMDLOG: process.env.MCITY_CMDLOG ?? path.join(outDir, "cmds.jsonl"), NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${path.join(here, "cmdlog.cjs")}`, MCITY_DB_PATH: dbPath, MCITY_HTTP_PORT: P.http, MCITY_HTTPS_PORT: P.https, MCITY_FACEBOOK_PORT: P.fb },
  }, "server.log");
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${P.http}/health`)).ok) break; } catch {}
    if (i > 60) throw new Error("server did not start; see out/" + name + "/server.log");
    await sleep(500);
  }
  o.db = () => new Database(dbPath, { readonly: true });
  o.getDoc = (tag, user = 1) => { const d = o.db(); try { const r = d.prepare("select json from save_documents where user_id=? and tag=?").get(user, tag); return r && JSON.parse(r.json); } finally { d.close(); } };
  o.mutateDoc = (tag, fn, user = 1) => { const d = new Database(dbPath); try { const r = d.prepare("select json from save_documents where user_id=? and tag=?").get(user, tag); const j = JSON.parse(r.json); fn(j); d.prepare("update save_documents set json=?, updated_at=? where user_id=? and tag=?").run(JSON.stringify(j), new Date().toISOString(), user, tag); } finally { d.close(); } };
  o.seedDb = (fn) => fn(o);
  o.dump = (label) => { // all save docs of all users -> out/<label>.saves.json
    const d = o.db();
    try {
      const rows = d.prepare("select user_id,tag,json from save_documents order by user_id,tag").all();
      const docs = {}; for (const r of rows) (docs[r.user_id] ??= {})[r.tag] = JSON.parse(r.json);
      fs.writeFileSync(path.join(outDir, `${label}.saves.json`), JSON.stringify(docs, null, 2));
      return docs;
    } finally { d.close(); }
  };
  if (seed) o.seedDb(seed);
  o.launch = ({ query = "" } = {}) => {
    spawnGrp("xvfb-run", ["-a", "-s", `-screen 0 ${width}x${height}x24`, path.join(root, "node_modules/electron/dist/electron"), path.join(here, "loader.cjs")], {
      cwd: root,
      env: { ...process.env, ORACLE_URL: `https://127.0.0.1:${P.https}/launcher${query}`, ORACLE_CTL_PORT: P.ctl, ORACLE_FB_PORT: P.fb, ORACLE_W: width, ORACLE_H: height },
    }, "electron.log");
  };
  const ctl = async (p, params = {}) => {
    const r = await fetch(`http://127.0.0.1:${P.ctl}/${p}?` + new URLSearchParams(params));
    if (!r.ok) throw new Error(`ctl ${p}: ${await r.text()}`);
    return r;
  };
  o.waitCtl = async () => { for (let i = 0; i < 60; i++) { try { await ctl("eval", { js: "1" }); return; } catch { await sleep(500); } } throw new Error("electron control port never came up; see electron.log"); };
  o.shot = async (label) => { // webContents.capturePage -> PNG, numbered
    const f = path.join(outDir, `${String(++o.n).padStart(2, "0")}-${label}.png`);
    fs.writeFileSync(f, Buffer.from(await (await ctl("shot")).arrayBuffer()));
    return f;
  };
  o.click = async (x, y) => { await ctl("mouse", { type: "click", x, y }); };
  o.move = async (x, y) => { await ctl("mouse", { type: "move", x, y }); };
  o.eval = async (js) => JSON.parse(await (await ctl("eval", { js })).text());
  o.scroll = (y) => o.eval(`window.scrollTo(0,${y});window.scrollY`);
  /** Flash stage origin in window coords (page is scrolled). Click in SWF coords with o.clickSwf. */
  o.swfRect = () => o.eval(`(()=>{const r=document.getElementById('flash').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  o.clickSwf = async (x, y) => { const r = await o.swfRect(); await o.click(Math.round(r.x + x), Math.round(r.y + y)); };
  o.waitLog = async (re, ms = 120000, file = "server.log") => { // wait for regex in server log
    const t = Date.now();
    while (Date.now() - t < ms) { if (re.test(fs.readFileSync(path.join(outDir, file), "utf8"))) return; await sleep(500); }
    throw new Error("timeout waiting for " + re);
  };
  o.waitGame = async () => { await o.waitLog(/load_success/); await sleep(6000); };
  o.stop = async () => { try { await ctl("quit"); } catch {} await stopAll(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return o;
}

/** Seed: mark the starter save as post-tutorial (tutorialEnd=1, advisor chosen). */
export function seedPostTutorial(o) {
  o.mutateDoc("universe", (u) => {
    const prof = u.universe.find((e) => Array.isArray(e.Profile));
    prof.tutorialEnd = "1"; prof.bossGenre = "1";
  });
}

/** Seed: post-tutorial + level ~10 + identical collectible album state (tools/oracle/seed-collectibles.cjs does the same for our DB). */
export function seedCollectibles(o) {
  seedPostTutorial(o);
  o.mutateDoc("universe", (u) => { u.universe.find((e) => Array.isArray(e.Profile)).exp = "6000"; });
  o.mutateDoc("collectiblesList", (c) => { c.collectiblesList = [{ Objects: [], skus: "gift_001:1,gift_002:2,gift_003:1,gift_004:3,gift_005:2,gift_006:1,gift_029:1,gift_030:4" }, { Rewards: [], skus: "" }, { Pending: [], tupla: "" }]; });
}
