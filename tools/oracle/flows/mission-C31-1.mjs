// Complete the nameCity mission 1 ("Name It") from a seeded save; record claim and reload state.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "1" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(533, 67); await sleep(2000); await shot("01-magazine-closed");
  await c(35, 357); await sleep(2500); await shot("02-missions");
  await c(517, 220); await sleep(2500); await shot("03-name-it");
  await c(388, 257); await sleep(800); await o.type("MyTown"); await sleep(800); await shot("04-typed");
  await c(380, 468); await sleep(3500); await shot("05-mission-complete"); stat("completed"); dump("completed");
  await c(570, 127); await sleep(2000); await shot("06-popup-closed");
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
