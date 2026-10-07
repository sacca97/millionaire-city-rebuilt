// Complete the collect mission 31 ("Pizzalicious Sale I", 1 x commerce_pizza): place a Pizzeria on the known-good plot, make its income ready, collect it.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "31" }, { Reached: [], chunk: "" }, { Given: [], chunk: "18" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, mutateDoc, dump, reload } = o;
  await o.boot(); await sleep(2000); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const ty of [289, 321, 353]) {
    for (const tx of [556, 588, 620]) { await m(tx, ty); await sleep(150); await c(tx, ty); await sleep(700); }
  }
  await shot("01-terrain");
  await c(618, 459); await sleep(3000);
  await c(407, 164); await sleep(1500);
  await c(255, 348); await sleep(2500);
  await m(588, 321); await sleep(800); await c(588, 321); await sleep(3500); await shot("02-placed");
  mutateDoc("universe", (u) => {
    const mine = u.universe.find((entry) => entry.World).World.find((company) => company.whose === "0");
    const pizza = mine.Company.find((item) => item.sku === "commerce_pizza");
    pizza.Item[0].time = "2000"; pizza.Item[0].savedAt = String(Date.now());
  });
  await reload(); await sleep(4000); await shot("03-ready");
  await m(588, 321); await sleep(1200); await c(588, 321); await sleep(2500);
  await shot("04-collected"); stat("collected"); dump("collected");
  await c(570, 127); await sleep(1000);
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
