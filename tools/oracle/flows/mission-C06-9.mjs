// Complete the build mission 9 ("Diversify", 5 x Commerces) by buying five free 3x3 blocks and placing five Pizzerias; record claim and reload state.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "9" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  const blocks = [
    { xs: [556, 588, 620], ys: [129, 161, 193], centre: [588, 161] },
    { xs: [652, 684, 716], ys: [129, 161, 193], centre: [684, 161] },
    { xs: [460, 492, 524], ys: [193, 225, 257], centre: [492, 225] },
    { xs: [460, 492, 524], ys: [289, 321, 353], centre: [492, 321] },
    { xs: [556, 588, 620], ys: [289, 321, 353], centre: [588, 321] },
  ];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    await c(563, 459); await sleep(1000);
    for (const ty of b.ys) { for (const tx of b.xs) { await m(tx, ty); await sleep(150); await c(tx, ty); await sleep(700); } }
    await shot(`1${i}-terrain`);
    await c(618, 459); await sleep(3000);
    await c(407, 164); await sleep(1500);
    await c(255, 348); await sleep(2500);
    await m(b.centre[0], b.centre[1]); await sleep(800);
    await c(b.centre[0], b.centre[1]); await sleep(3500); await shot(`2${i}-placed`);
  }
  await c(570, 127); await sleep(1500);
  stat("completed"); dump("completed");
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
