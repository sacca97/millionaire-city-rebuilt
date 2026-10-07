// Probe: Commerces shop tab page 1 card coordinates (not a verify flow).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "9" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot } = o;
  await o.boot(); await sleep(3000);
  await c(618, 459); await sleep(3000); await shot("01-shop-houses");
  await c(407, 164); await sleep(2000); await shot("02-commerces");
}
