// Complete the moveHouse mission 87 ("Transplanting", 1 x Decorations_tree): place a Cypress Tree, then move it with the move tool.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "87" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await shot("01-terrain");
  await c(618, 459); await sleep(3000);
  await c(536, 164); await sleep(1500);
  await c(255, 348); await sleep(2500);
  await m(556, 225); await sleep(800); await c(556, 225); await sleep(3000); await shot("02-tree-placed");
  await c(55, 452); await sleep(1500); await shot("03-multibar");
  await c(65, 398); await sleep(1500); await shot("04-move-tool");
  await m(556, 225); await sleep(1200); await c(556, 225); await sleep(1500); await shot("05-picked");
  await m(556, 257); await sleep(1200); await c(556, 257); await sleep(3000); await shot("06-dropped");
  await c(340, 373); await sleep(3000); await shot("07-confirmed"); stat("completed"); dump("completed");
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
