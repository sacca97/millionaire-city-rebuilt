// Drives OUR client through the same non-tutorial flow as flows/<flow>.mjs (760x600 stage coords, no offset).
// usage: CHROME=<chromium> MCITY_CLIENT_DIST=/tmp/<build> OUT=<dir> PORT=31863 PREVIEW=http://127.0.0.1:31863/ node ours-flow.mjs <flow>
// The isolated server serves both the built client and /Game; keep test builds out of the repository.
import { chromium } from "/home/sacca/.bun/install/cache/playwright-core/1.62.1@@@1/index.mjs";
import { spawn } from "node:child_process";
import { seedFlow, statOf } from "./flowlib.mjs";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url"; import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, "../..");
const Database = createRequire(path.join(root, "apps/server/package.json"))("better-sqlite3");
const OUT = process.env.OUT, PORT = Number(process.env.PORT ?? 31863), URL = process.env.PREVIEW ?? "http://localhost:5176/";
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mcity-ours-")), dbPath = path.join(tmp, "ours.sqlite");
const slog = path.join(OUT, "server.log");
const srv = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], { cwd: path.join(root, "apps/server"), detached: true, stdio: ["ignore", fs.openSync(slog, "w"), fs.openSync(slog, "a")],
  env: { ...process.env, MCITY_CMDLOG: path.join(OUT, "cmds.jsonl"), NODE_OPTIONS: `--require ${path.join(here, "cmdlog.cjs")}`, MCITY_DB_PATH: dbPath, MCITY_HTTP_PORT: PORT, MCITY_HTTPS_PORT: PORT + 1, MCITY_FACEBOOK_PORT: PORT + 2 } });
fs.writeFileSync(path.join(OUT, "server.pid"), String(srv.pid));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; ; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} if (i > 60) throw new Error("server"); await sleep(500); }
export const mutateDoc = (tag, fn, user = 1) => { const d = new Database(dbPath); try { const r = d.prepare("select json from save_documents where user_id=? and tag=?").get(user, tag); const j = JSON.parse(r.json); fn(j); d.prepare("update save_documents set json=?, updated_at=? where user_id=? and tag=?").run(JSON.stringify(j), new Date().toISOString(), user, tag); } finally { d.close(); } };
const getDoc = (tag, user = 1) => { const d = new Database(dbPath, { readonly: true }); try { const r = d.prepare("select json from save_documents where user_id=? and tag=?").get(user, tag); return r && JSON.parse(r.json); } finally { d.close(); } };
const dump = (label) => { const d = new Database(dbPath, { readonly: true }); try { const docs = {}; for (const r of d.prepare("select user_id,tag,json from save_documents order by user_id,tag").all()) (docs[r.user_id] ??= {})[r.tag] = JSON.parse(r.json); fs.writeFileSync(path.join(OUT, `${label}.saves.json`), JSON.stringify(docs, null, 2)); } finally { d.close(); } };
// the server creates the player on first load: do one bootstrap load, then seed post-tutorial, then the real run
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 760, height: 600 } });
p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
const flowName = process.argv[2] ?? "build-flow";
const mod = await import(path.join(here, "flows", flowName + ".mjs"));
seedFlow(mutateDoc, { daily: mod.daily, extra: mod.seed, docs: mod.seedDocs });
let n = 0, loadsSeen = 0;
const loads = () => (fs.readFileSync(slog, "utf8").match(/load_success/g) ?? []).length;
const waitLoad = async () => { const t = Date.now(); while (Date.now() - t < 120000 && loads() <= loadsSeen) await sleep(500); loadsSeen = loads(); await sleep(6000); };
const h = {
  p, sleep, getDoc, mutateDoc, dump, OUT,
  shot: (l) => p.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, "0")}-${l}.png`) }),
  mv: async (x, y) => { await p.mouse.move(x - 4, y - 4); await p.mouse.move(x, y); await sleep(250); },
  click: async (x, y) => { await h.mv(x, y); await p.mouse.click(x, y); await sleep(500); },
  down: async (x, y) => { await h.mv(x, y); await p.mouse.down(); }, up: async () => { await p.mouse.up(); },
  type: async (t) => { await p.keyboard.type(t, { delay: 100 }); },
  drag: async (x1, y1, x2, y2) => { await p.mouse.move(x1, y1); await p.mouse.down(); for (let i = 1; i <= 8; i++) { await p.mouse.move(x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8); await sleep(100); } await p.mouse.up(); },
  stat: (label) => statOf(getDoc, label),
  boot: async () => { await p.goto(URL); await waitLoad(); },
  reload: async () => { await p.reload(); await waitLoad(); },
};
try { await mod.default(h); } catch (e) { console.error(e); try { await h.shot("failure"); } catch {} }
await b.close();
try { process.kill(-srv.pid, "SIGTERM"); } catch {}
if (srv.exitCode === null) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    srv.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}
if (srv.exitCode === null) { try { process.kill(-srv.pid, "SIGKILL"); } catch {} }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(0);
