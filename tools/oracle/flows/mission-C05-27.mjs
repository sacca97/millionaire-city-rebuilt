// Complete the bonus mission 27 (bonus houses_002_001 >= 30 % influence; 27 needs mission 26 given, 26 needs 25 given).
// Seeded: a duplex houses_002_001 (3x3) at (3,-3), waiting (influence only), with 5 % from tree (0,1), and two fountains
// (decorations_font_02, influence 14 each) at (6,-4) and (6,-2). 5 + 14 + 14 = 33 >= 30. Decorations need no terrain.
import { seedHouses, addDecoration } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedHouses(u, [{ sid: 9301, sku: "houses_002_001", x: 3, y: -3 }]);
  addDecoration(u, "decorations_font_02", 9302, 6, -4);
  addDecoration(u, "decorations_font_02", 9303, 6, -2);
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "27" }, { Reached: [], chunk: "" }, { Given: [], chunk: "25,26" }];
};

export default async function (o) {
  const { sleep, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(6000); await shot("00-ready"); stat("boot");
  await sleep(4000); await shot("01-settled"); stat("settled");
  dump("completed");
  await sleep(8000); await reload(); await sleep(4000); await shot("reloaded"); stat("reloaded"); dump("final");
}
