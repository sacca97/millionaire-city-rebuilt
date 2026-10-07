// Complete the bonus mission 29 ("Rockstar Villa": bonus houses_006_001 >= 90 % influence; unlockLevel 18 = 41490 exp).
// Seeded: a Villa houses_006_001 (4x3) at (14,-6), waiting, on owned terrain, and seven fountains (decorations_font_02, influence 14
// each, ratio 2) on free grass around it: (12,-8) (14,-8) (16,-8) (18,-8) (12,-3) (14,-3) (16,-3). 7 x 14 = 98 >= 90.
// The villa's own cost (2,000,000 company value) makes the earn popups open at boot: they are closed first.
import { seedHouses, addDecoration } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedHouses(u, [{ sid: 9401, sku: "houses_006_001", x: 14, y: -6 }]);
  const fountains = [[12, -8], [14, -8], [16, -8], [18, -8], [12, -3], [14, -3], [16, -3]];
  fountains.forEach(([x, y], i) => addDecoration(u, "decorations_font_02", 9402 + i, x, y));
  prof.exp = "41490"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "29" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(5000); await shot("00-ready");
  await c(570, 127); await sleep(1500); await c(533, 67); await sleep(1500); await shot("00b-popups-closed");
  stat("settled");
  await sleep(4000); dump("completed");
  await sleep(8000); await reload(); await sleep(4000); await shot("reloaded"); stat("reloaded"); dump("final");
}
