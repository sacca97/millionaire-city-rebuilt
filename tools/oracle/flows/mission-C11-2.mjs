// Complete the buy mission 2 ("Pizzalicious", buy 1 x commerce_pizza): the `buy` event is the rival-sale completion, so buy the
// rival Pizzeria on the starter map (commerce_pizza @ world -7,-3, shown "FOR SALE"), confirm the popup, record claim and reload.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "2" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(506, 459); await sleep(1000);
  await m(172, 225); await sleep(1200); await c(172, 225); await sleep(2500); await shot("01-rival-popup");
  await c(376, 360); await sleep(9000); await shot("02-bought"); stat("bought");
  await c(570, 127); await sleep(1000);
  stat("completed"); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
