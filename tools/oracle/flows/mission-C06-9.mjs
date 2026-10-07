// Complete the build mission 9 ("Diversify", 5 x Commerces) by buying five Pizzerias on seeded owned 3x3 plots; record claim and reload.
// Commerces need OWNED terrain: seed 3x3 blocks (free in the starter map, clear of the road at y=0).
export const seed = (u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const world = u.universe.find((entry) => Array.isArray(entry.World)).World;
  const map = world.find((entry) => Array.isArray(entry.Map)).Map;
  const terrain = map.find((entry) => Array.isArray(entry.Terrain));
  const blocks = [[-10, -5], [-4, -5], [3, -5], [6, -5], [8, 1]];
  const add = [];
  for (const [bx, by] of blocks) for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) add.push(`${bx + dx}:${by + dy}`);
  terrain.chunk = (terrain.chunk ? terrain.chunk.replace(/,?$/, ",") : "") + add.join(",") + ",";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "9" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  const spots = [[76, 161], [268, 161], [492, 161], [588, 161], [652, 353]];
  for (let i = 0; i < spots.length; i++) {
    await c(618, 459); await sleep(3500);
    await c(407, 164); await sleep(1500);
    await c(255, 348); await sleep(2500); await shot(`1${i}-bought`);
    await m(spots[i][0], spots[i][1]); await sleep(800);
    await c(spots[i][0], spots[i][1]); await sleep(4000); await shot(`2${i}-placed`);
  }
  await c(570, 127); await sleep(1500);
  stat("completed"); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
