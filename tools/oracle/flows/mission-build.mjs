// Complete one exact-SKU build mission from a seeded post-tutorial save; record claim and reload state.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "6" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(2000); await shot("00-seeded");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) {
    await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200);
  }
  await c(618, 459); await sleep(3000); await c(383, 355); await sleep(3000);
  await m(572, 241); await sleep(800); await shot("01-placing");
  await c(572, 241); await sleep(3500); await shot("02-mission-completed"); stat("completed"); dump("completed");
  await c(570, 127); await sleep(1000); await shot("03-popup-closed");
  await reload(); await shot("04-reloaded"); stat("reloaded"); dump("final");
}
