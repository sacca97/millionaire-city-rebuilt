// Gold variant of instant build: not enough coins -> PopupConfirm "exchange gold" -> exchange + instant build (StateOnConstructionOwner.instantBuildStart/instantBuildDoAccept).
export const seed = (u, prof) => { prof.DCCoins = "34300"; prof.DCCash = "100"; };
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await c(533, 67); await sleep(2000); stat("start"); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await c(618, 459); await sleep(3000); await c(255, 355); await sleep(3000); await m(572, 241); await sleep(800); await c(572, 241); await sleep(4000);
  stat("placed");
  await c(572, 241); await sleep(3000); await shot("01-instant-popup");
  if (process.env.STOP_AT_POPUP) { dump("final"); return; }
  const bx = Number(process.env.BX ?? 376), by = Number(process.env.BY ?? 360);
  await c(bx, by); await sleep(4000); await shot("02-after-click"); stat("instant");
  await sleep(2000); await shot("03-after"); await sleep(3000); dump("before-reload");
  await reload(); await shot("04-reloaded"); stat("reloaded"); dump("final");
}
