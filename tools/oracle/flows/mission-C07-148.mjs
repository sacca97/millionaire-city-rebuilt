// Complete the alt build mission 148 ("World of Wonder: Two More", build any 2, no parameter) by buying two 2x2 plots and placing two Bungalows;
// record claim and reload. (Decorations do not feed the generic `build` counter; buildings do.)
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000"; prof.flags = "altMissions:1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "148" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  const blocks = [[[556, 225], [588, 225], [556, 257], [588, 257], [572, 241]],
                  [[460, 225], [492, 225], [460, 257], [492, 257], [476, 241]]];
  for (let i = 0; i < blocks.length; i++) {
    const [a, b, d, e, centre] = blocks[i];
    await c(563, 459); await sleep(1000);
    for (const [tx, ty] of [a, b, d, e]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
    await c(618, 459); await sleep(3000); await c(255, 355); await sleep(3000);
    await m(centre[0], centre[1]); await sleep(800); await c(centre[0], centre[1]); await sleep(4000); await shot(`1${i}-placed`);
  }
  await c(570, 127); await sleep(1500);
  stat("completed"); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
