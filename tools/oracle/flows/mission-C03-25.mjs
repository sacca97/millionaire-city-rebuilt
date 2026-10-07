// Complete the bonus mission 25 (bonus houses_001 >= 12 % influence; 25 needs mission 10 given).
// The tutorial bungalow 2171 (4,2) has influence 2 % (tree 2090). A fountain (decorations_font_02, influence 14, 2x2) is seeded
// at (6,2), which covers the bungalow: 2 + 14 = 16 % (conditions 12 and 16 are both met). Decorations need no terrain.
// The bungalow stays without contract (only the influence counts for bonus). Reached missions: 25 and 26 (same event).
import { addDecoration } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  addDecoration(u, "decorations_font_02", 9201, 6, 2);
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "25" }, { Reached: [], chunk: "" }, { Given: [], chunk: "10" }];
};

export default async function (o) {
  const { sleep, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(6000); await shot("00-ready"); stat("boot");
  await sleep(4000); await shot("01-settled"); stat("settled");
  dump("completed");
  await sleep(8000); await reload(); await sleep(4000); await shot("reloaded"); stat("reloaded"); dump("final");
}
