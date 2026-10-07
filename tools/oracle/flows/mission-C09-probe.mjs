// Probe: open the shop and the Decorations tab to read card coordinates (not a verify flow).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "11" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(618, 459); await sleep(3000); await shot("01-shop");
  await c(536, 164); await sleep(2000); await shot("02-decorations");
}
