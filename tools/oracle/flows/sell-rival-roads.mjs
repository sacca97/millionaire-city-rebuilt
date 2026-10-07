// contract on the seeded house, sell it, build 2 roads, destroy one, buy a rival for-sale house, buy terrain, reload. Stage coords.
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(2000); stat("start"); await shot("00-start");
  await c(506, 364); await sleep(2500); await c(290, 215); await sleep(3500); await shot("01-contract"); stat("contract");
  await c(733, 459); await sleep(1000); await m(506, 360); await sleep(800); await c(506, 360); await sleep(2000); await shot("02-destroy-confirm");
  await c(420, 368); await sleep(3000); await shot("03-sold"); stat("sold");
  await c(676, 459); await sleep(1000); await m(650, 322); await sleep(500); await c(650, 322); await sleep(1500); await c(682, 322); await sleep(2500); await shot("04-roads"); stat("roads");
  await c(733, 459); await sleep(1000); await m(650, 322); await sleep(500); await c(650, 322); await sleep(2500); await shot("05-destroy-road"); stat("road-destroy-click");
  await c(420, 368); await sleep(2500); await shot("06-road-destroyed"); stat("road-destroyed");
  await c(506, 459); await sleep(1000); await m(268, 330); await sleep(1200); await c(268, 330); await sleep(2000); await shot("07-rival-popup");
  await c(376, 360); await sleep(9000); await shot("08-rival-bought"); stat("rival");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1500); }
  await shot("09-terrain"); stat("terrain");
  await c(506, 459); await sleep(4000); dump("before-reload");
  await reload(); await shot("10-reloaded"); stat("reloaded"); dump("final");
}
