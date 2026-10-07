// Complete the build mission 11 (3 x decorations_font_02 "Fountain") by buying a 6x2 terrain strip and placing three Fountains; record claim and reload state.
export const seed = (_u, prof) => {
  prof.exp = "12000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "11" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const ty of [225, 257]) {
    for (const tx of [556, 588, 620, 652, 684, 716]) { await m(tx, ty); await sleep(200); await c(tx, ty); await sleep(800); }
  }
  await shot("01-terrain"); stat("terrain");
  const spots = [[572, 241], [636, 241], [700, 241]];
  for (let i = 0; i < spots.length; i++) {
    await c(618, 459); await sleep(4000); await shot(`1${i}-shop`);
    await c(536, 164); await sleep(2000);
    for (let k = 0; k < 8; k++) { await c(426, 381); await sleep(250); }
    for (let k = 0; k < 4; k++) { await c(743, 381); await sleep(900); }
    await shot(`2${i}-page5`);
    await c(641, 358); await sleep(3000); await shot(`3${i}-bought`);
    await m(spots[i][0], spots[i][1]); await sleep(800);
    await c(spots[i][0], spots[i][1]); await sleep(3500); await shot(`4${i}-placed`);
  }
  await c(570, 127); await sleep(1500);
  stat("completed"); dump("completed");
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
