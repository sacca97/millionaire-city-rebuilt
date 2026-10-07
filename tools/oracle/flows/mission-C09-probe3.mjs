// Probe 3: further Decorations shop pages to find decorations_font_02 "Fountain1" (not a verify flow).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "1200000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "11" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat } = o;
  await o.boot(); await sleep(3000); stat("start");
  await c(618, 459); await sleep(3000);
  await c(536, 164); await sleep(2000); await shot("01-page1");
  for (let p = 2; p <= 8; p++) { await c(743, 381); await sleep(1500); await shot(`0${p}-page${p}`); }
}
