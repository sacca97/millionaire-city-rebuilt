// Complete the instantBuild mission 5 by placing one house and instantly finishing it; record claim and reload state.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "5" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await c(618, 459); await sleep(3000); await c(255, 355); await sleep(3000);
  await m(572, 241); await sleep(800); await c(572, 241); await sleep(4000);
  await c(572, 241); await sleep(3000); await shot("01-instant-popup");
  await c(376, 360); await sleep(4000); await shot("02-instant-built"); stat("completed"); dump("completed");
  await c(570, 127); await sleep(2000); await shot("03-popup-closed");
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
