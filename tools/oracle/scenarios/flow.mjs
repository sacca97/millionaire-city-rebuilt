// Oracle adapter for the shared flows in tools/oracle/flows/<name>.mjs: FLOW=<name> node tools/oracle/run.mjs flow
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { sleep } from "../lib.mjs"; import { seedFlow, statOf } from "../flowlib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const name = process.env.FLOW ?? "build-flow";
const mod = await import(path.join(here, "..", "flows", name + ".mjs"));
const X = 252, Y = 203;
export default { seed: (o) => seedFlow(o.mutateDoc, { daily: mod.daily, extra: mod.seed, docs: mod.seedDocs }), async run(o) {
  const log = path.join(o.outDir, "server.log");
  const loads = () => (fs.readFileSync(log, "utf8").match(/load_success/g) ?? []).length;
  let seen = 0;
  const waitLoad = async () => { const t = Date.now(); while (Date.now() - t < 150000 && loads() <= seen) await sleep(500); seen = loads(); await sleep(6000); };
  const h = {
    sleep, getDoc: o.getDoc, mutateDoc: o.mutateDoc, OUT: o.outDir,
    shot: (l) => o.shot(l), mv: (x, y) => o.move(x + X, y + Y), click: async (x, y) => { await o.move(x + X, y + Y); await sleep(300); await o.click(x + X, y + Y); },
    down: (x, y) => o.eval(`1`).then(() => fetch(`http://127.0.0.1:${o.ports.ctl}/mouse?type=down&x=${x + X}&y=${y + Y}`)),
    up: (x, y) => fetch(`http://127.0.0.1:${o.ports.ctl}/mouse?type=up&x=${x + X}&y=${y + Y}`),
    type: async (t) => { for (const ch of t) { await fetch(`http://127.0.0.1:${o.ports.ctl}/key?key=${encodeURIComponent(ch)}`); await sleep(200); } },
    drag: async (x1, y1, x2, y2) => { const f = (t, x, y) => fetch(`http://127.0.0.1:${o.ports.ctl}/mouse?type=${t}&x=${x + X}&y=${y + Y}`); await f("move", x1, y1); await sleep(200); await f("down", x1, y1); await sleep(300); for (let i = 1; i <= 8; i++) { await f("move", Math.round(x1 + (x2 - x1) * i / 8), Math.round(y1 + (y2 - y1) * i / 8)); await sleep(100); } await f("up", x2, y2); },
    stat: (l) => statOf(o.getDoc, l), dump: (l) => o.dump(l),
    boot: async () => { await waitLoad(); },
    reload: async () => { try { await o.eval("setTimeout(()=>location.reload(),50);1"); } catch {} await waitLoad(); },
  };
  await mod.default(h);
}};
