// earnDCCoins progress counter: coins cross 1,000,000 upward (Name It claim +20,000), then a few more coin changes (terrain).
export const seed = (u, prof) => { prof.DCCoins = "990000"; prof.DCCash = "100"; };
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); stat("start");
  await c(533, 67); await sleep(2000);
  await c(35, 357); await sleep(2500); await c(517, 220); await sleep(2500);
  await c(388, 257); await sleep(800); await o.type("MyTown"); await sleep(800);
  await c(380, 468); await sleep(3500); stat("mission1"); await shot("01-claimed");
  await c(570, 127); await sleep(2000); await c(578, 154); await sleep(1500);
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  stat("terrain"); await sleep(3000); dump("before-reload");
  await reload(); stat("reloaded"); dump("final");
}
