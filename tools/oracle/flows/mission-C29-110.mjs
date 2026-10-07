// Complete the alt moveHouse mission 110 ("Time to move", move 1 x decorations_tree_01): seed a Cypress at (7,-3), buy a destination
// 2x2 plot, use the move tool (briefcase -> move) to move it onto the plot; record claim and reload.
export const seed = (u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000"; prof.flags = "altMissions:1";
  const world = u.universe.find((entry) => Array.isArray(entry.World)).World;
  const mine = world.find((company) => company.whose === "0");
  mine.Company.push({ Item: [{ State: [], id: "5" }], sid: "9002", csid: "1", sku: "decorations_tree_01", x: "7", y: "-3", isSuspended: "0" });
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "110" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); stat("start"); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  stat("terrain");
  await c(55, 452); await sleep(1500); await shot("01-multibar");
  await c(65, 398); await sleep(1500); await shot("02-move-tool");
  await m(588, 193); await sleep(1200); await shot("03-hover-tree");
  await c(588, 193); await sleep(1500); await shot("04-picked");
  await m(572, 241); await sleep(1200); await shot("05-ghost");
  await c(572, 241); await sleep(3000); await shot("06-dropped");
  await c(340, 373); await sleep(3000); await shot("07-confirmed"); stat("moved");
  await sleep(3000); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
