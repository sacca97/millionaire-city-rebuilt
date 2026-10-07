// Probe 2: page through the Decorations shop to find decorations_font_02 (not a verify flow).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "11" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot } = o;
  await o.boot(); await sleep(3000);
  await c(618, 459); await sleep(3000);
  await c(536, 164); await sleep(2000); await shot("01-page1");
  await c(743, 381); await sleep(1500); await shot("02-page2");
  await c(743, 381); await sleep(1500); await shot("03-page3");
  await c(743, 381); await sleep(1500); await shot("04-page4");
}
