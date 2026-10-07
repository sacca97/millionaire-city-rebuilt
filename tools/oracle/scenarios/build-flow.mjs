import fs from "node:fs"; import path from "node:path";
import { seedPostTutorial, sleep } from "../lib.mjs";
// build -> construction -> (reload with shortened timer) -> built popup -> contract -> collect. Stage origin (252,203).
const X = 252, Y = 203;
export default { seed: seedPostTutorial, async run(o) {
  const c = (x, y) => o.click(x + X, y + Y), m = (x, y) => o.move(x + X, y + Y);
  const prof = (tag) => { const u = o.getDoc("universe").universe; const p = u.find((e) => e.Profile).Profile[0] ?? u.find((e) => e.Profile); return u.find((e) => e.Profile); };
  const stat = (label) => { const u = o.getDoc("universe").universe; const P = u.find((e) => e.Profile); const W = u.find((e) => e.World).World; const mine = W.find((c) => c.whose === "0"); console.log(label, JSON.stringify({ coins: P.DCCoins, cv: P.companyValue, exp: P.exp, cash: P.DCCash, items: mine.Company.filter((i) => !i.sku.startsWith("decorations_tree")).map((i) => [i.sku, i.x, i.y, JSON.stringify(i.Item)]).slice(-3) })); };
  const waitLoads = async (n) => { const f = path.join(o.outDir, "server.log"); const t = Date.now(); while (Date.now() - t < 150000) { if ((fs.readFileSync(f, "utf8").match(/load_success/g) ?? []).length >= n) break; await sleep(500); } await sleep(6000); };
  await waitLoads(1); await c(195, 325); await sleep(2000); await c(399, 470); await sleep(4000);
  stat("start"); await o.shot("00-start");
  await c(563, 459); await sleep(1000);                       // buy-terrain tool (toolbar 4th button)
  await o.shot("01-terrain-tool");
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await o.shot("02-terrain-bought"); stat("terrain");
  await c(618, 459); await sleep(3000); await o.shot("03-shop");
  await c(255, 355); await sleep(3000); await m(572, 241); await sleep(800); await o.shot("04-placing");
  await c(572, 241); await sleep(4000); await o.shot("05-placed"); stat("placed");
  await m(700, 120); await sleep(1500); await o.shot("06-placed-away"); stat("placed+away");
  // shorten construction to 4 s (mode/time in the saved item) and reload the page so the client re-reads the DB
  o.mutateDoc("universe", (u) => { const W = u.universe.find((e) => e.World).World; const mine = W.find((c) => c.whose === "0"); const it = mine.Company.find((i) => i.sku === "houses_001_001" && i.x === "6"); it.Item[0].time = "4000"; it.Item[0].savedAt = String(Date.now()); });
  try { await o.eval("setTimeout(()=>location.reload(),50);1"); } catch {} await waitLoads(2);
  await o.shot("07-after-reload"); stat("reload");
  await sleep(6000); await o.shot("08-built"); stat("built");
  await m(575, 243); await sleep(1200); await c(575, 243); await sleep(3000); await o.shot("09-click-house"); stat("clicked");
  await c(290, 215); await sleep(3500); await o.shot("10-contract-chosen"); stat("contract");
  await m(700, 120); await sleep(1000); await o.shot("11-renting");
  o.mutateDoc("universe", (u) => { const W = u.universe.find((e) => e.World).World; const mine = W.find((c) => c.whose === "0"); const it = mine.Company.find((i) => i.sku === "houses_001_001" && i.x === "6"); console.log("rent item", JSON.stringify(it)); it.Item[0].time = "3000"; it.Item[0].savedAt = String(Date.now()); });
  try { await o.eval("setTimeout(()=>location.reload(),50);1"); } catch {} await waitLoads(3);
  await sleep(3000); await o.shot("12-rent-ready"); stat("rent-ready");
  await m(575, 243); await sleep(1200); await o.shot("13-hover-ready");
  await c(575, 243); await sleep(1500); await o.shot("14-collect-1"); await sleep(2000); await o.shot("15-collect-2"); stat("collected");
  await o.dump("flow2");
}};
