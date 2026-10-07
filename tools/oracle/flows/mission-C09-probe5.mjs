// Probe 5: check the player level and the "Fountain" (decorations_font_02) card state at exp=12000; shop page 4.
export const seed = (_u, prof) => {
  prof.exp = "12000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "11" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(618, 459); await sleep(3000);
  await c(536, 164); await sleep(1500);
  await c(743, 381); await sleep(1200);
  await c(743, 381); await sleep(1200);
  await c(743, 381); await sleep(1500); await shot("01-page4");
}
