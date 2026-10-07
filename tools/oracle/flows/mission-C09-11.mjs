// Complete the build mission 11 ("Fountain Dream", 3 x decorations_font_02 "Fountain") by placing three Fountains; record claim and reload.
// Decorations need UNOWNED free grass tiles (buying/seeding the plot makes it fail with "You need free terrain").
// Spots are three free 2x2 blocks in the row y=-2..-1 (computed free against the starter map): (6,-2),(3,-2),(-4,-2).
// The shop REMEMBERS its last page: navigate to page 5 once, then just re-open + click the remembered price button.
export const seed = (_u, prof) => {
  prof.exp = "12000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "11" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  const spots = [[572, 241], [476, 241], [252, 241]];
  for (let i = 0; i < spots.length; i++) {
    await c(618, 459); await sleep(4000);
    await c(536, 164); await sleep(2000); await shot(`1${i}-shop`);
    // navigate to page 5 every time: the original remembers its last page, ours resets to page 1.
    for (let k = 0; k < 8; k++) { await c(426, 381); await sleep(250); }
    for (let k = 0; k < 4; k++) { await c(743, 381); await sleep(900); }
    await shot(`2${i}-page5`);
    await c(641, 358); await sleep(3000); await shot(`3${i}-bought`);
    await m(spots[i][0], spots[i][1]); await sleep(800);
    await c(spots[i][0], spots[i][1]); await sleep(3500); await shot(`4${i}-placed`);
  }
  await c(570, 127); await sleep(1500);
  stat("completed"); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
