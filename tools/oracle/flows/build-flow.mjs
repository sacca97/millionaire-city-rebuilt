export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, mutateDoc, dump, reload } = o;
  await o.boot(); await sleep(2000);
  stat("start"); await shot("00-start");
  await c(563, 459); await sleep(1000); await shot("01-terrain-tool");
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await shot("02-terrain-bought"); stat("terrain");
  await c(618, 459); await sleep(3000); await shot("03-shop");
  await c(255, 355); await sleep(3000); await m(572, 241); await sleep(800); await shot("04-placing");
  await c(572, 241); await sleep(4000); await shot("05-placed"); stat("placed");
  await m(700, 120); await sleep(1500); await shot("06-placed-away"); stat("placed+away");
  mutateDoc("universe", (u) => { const W = u.universe.find((e) => e.World).World; const mine = W.find((c) => c.whose === "0"); const it = mine.Company.find((i) => i.sku === "houses_001_001" && i.x === "6"); it.Item[0].time = "4000"; it.Item[0].savedAt = String(Date.now()); });
  await reload();
  await shot("07-after-reload"); stat("reload");
  await sleep(6000); await shot("08-built"); stat("built");
  await m(575, 243); await sleep(1200); await c(575, 243); await sleep(3000); await shot("09-click-house"); stat("clicked");
  await c(290, 215); await sleep(3500); await shot("10-contract-chosen"); stat("contract");
  await m(700, 120); await sleep(1000); await shot("11-renting");
  mutateDoc("universe", (u) => { const W = u.universe.find((e) => e.World).World; const mine = W.find((c) => c.whose === "0"); const it = mine.Company.find((i) => i.sku === "houses_001_001" && i.x === "6"); console.log("rent item", JSON.stringify(it)); it.Item[0].time = "3000"; it.Item[0].savedAt = String(Date.now()); });
  await reload();
  await sleep(3000); await shot("12-rent-ready"); stat("rent-ready");
  await m(575, 243); await sleep(1200); await shot("13-hover-ready");
  await c(575, 243); await sleep(1500); await shot("14-collect-1"); await sleep(2000); await shot("15-collect-2"); stat("collected");
  await sleep(3000); dump("final");
}
