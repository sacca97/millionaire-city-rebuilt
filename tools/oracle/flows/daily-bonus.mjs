// daily prize claim at the first login of the day (reward roll is random server-side: compare structure, not the sku), then reload (no second prize).
export const daily = true;
export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-daily"); stat("start");
  await c(195, 325); await sleep(2500); await shot("01-claimed");
  await c(399, 470); await sleep(3500); await shot("02-closed"); stat("claimed");
  await sleep(3000); dump("before-reload");
  await reload(); await shot("03-reloaded"); stat("reloaded"); dump("final");
}
