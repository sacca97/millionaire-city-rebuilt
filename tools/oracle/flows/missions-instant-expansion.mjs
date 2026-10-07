// 1M-company-value magazine, "Name It" mission (type city name, claim), terrain, house, instant build (coins), mission 5 claim, drag map, buy expansion with cash.
export const seed = (u, prof) => { prof.DCCoins = "4500000"; prof.DCCash = "100"; };
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); stat("start"); await shot("00-start");
  await c(533, 67); await sleep(2000); await shot("01-magazine-closed");
  await c(35, 357); await sleep(2500); await shot("02-missions");
  await c(517, 220); await sleep(2500); await shot("03-name-it");
  await c(388, 257); await sleep(800); await o.type("MyTown"); await sleep(800); await shot("04-typed");
  await c(380, 468); await sleep(3500); await shot("05-mission-complete"); stat("mission1");
  await c(570, 127); await sleep(2000); await shot("05b-after-complete");
  await c(578, 154); await sleep(1500); await shot("05c-closed");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await c(618, 459); await sleep(3000); await c(255, 355); await sleep(3000); await m(572, 241); await sleep(800); await c(572, 241); await sleep(4000);
  await c(572, 241); await sleep(3000); await shot("06-instant-popup");
  await c(376, 360); await sleep(4000); await shot("07-instant-built"); stat("instant");
  await c(570, 127); await sleep(2000); await shot("08-after-popup");
  await o.drag(600, 150, 280, 350); await sleep(1500); await shot("09-dragged");
  await c(628, 400); await sleep(2500); await shot("10-expansion-popup");
  await c(212, 361); await sleep(3500); await shot("11-expansion-bought"); stat("expansion");
  await o.drag(280, 350, 600, 150); await sleep(1000);
  await sleep(3000); dump("before-reload");
  await reload(); await shot("12-reloaded"); stat("reloaded"); dump("final");
}
