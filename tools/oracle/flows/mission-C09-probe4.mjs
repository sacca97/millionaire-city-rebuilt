// Probe 4: Decorations shop pages 5-10 with 500k coins (no earn popup) to find decorations_font_02.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "11" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot } = o;
  await o.boot(); await sleep(3000);
  await c(618, 459); await sleep(3000);
  await c(536, 164); await sleep(2000); await shot("00-page0");
  for (let p = 1; p <= 10; p++) { await c(743, 381); await sleep(1500); await shot(`p${p}`); }
}
