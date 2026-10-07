// Complete the build mission 10 (2 x Decorations_tree) by buying a plot and placing two Cypress Trees; record claim and reload state.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "10" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await shot("01-terrain"); stat("terrain");
  const spots = [[556, 225], [588, 225]];
  for (let i = 0; i < spots.length; i++) {
    await c(618, 459); await sleep(3000);
    await c(536, 164); await sleep(1500);
    await c(255, 348); await sleep(2500);
    await m(spots[i][0], spots[i][1]); await sleep(800);
    await c(spots[i][0], spots[i][1]); await sleep(3000); await shot(`0${i + 2}-placed`);
  }
  await c(570, 127); await sleep(1500);
  stat("completed"); dump("completed");
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
