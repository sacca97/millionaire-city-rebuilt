import { addTerrain } from "./lib-commerce.mjs";
// Class C21 collectUpgraded (nameType), rep mission 104 "CollectUpgradedIncomes" (alt set: showInABtest alt_missions, parameter Houses,
// amount 50, unlockLevel 4, no unlockSku). Seeded as UP with altMissions:1 and the XP of level 4 (XPTable.xml xpneed 1580).
// Counter shortcut: PollManager "collectUpgradedHouses/49", one upgraded collect makes it 50.
// Same house as mission-C22-77: bungalow 2171 (4,2) on rent and ready (mode 5), upgraded by the NPC at get_world.
export const seed = (u, prof) => {
  prof.exp = "1580"; prof.DCCoins = "500000"; prof.flags = "altMissions:1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "104" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
  const poll = prof.Profile.find((entry) => Array.isArray(entry.PollManager));
  poll.PollManager = [{ Count: [], chunk: "collectUpgradedHouses/49" }];
  const mine = u.universe.find((entry) => entry.World).World.find((company) => company.whose === "0");
  // The bungalow (4,2) with its terrain and the starter roads: found or added (the seed doc may not hold it yet).
  addTerrain(u, [[4, 2], [5, 2], [4, 3], [5, 3]]);
  const item = [{ State: [], id: "1", mode: "5", time: "3600000", savedAt: String(Date.now()), contractSku: "1", contractGroupSku: "1" }];
  const house = mine.Company.find((c) => c.sid === "2171");
  if (house) house.Item = item;
  else mine.Company.push({ Item: item, sid: "2171", csid: "1", sku: "houses_001_001", x: "4", y: "2", isSuspended: "0" });
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot");
  await c(570, 127); await sleep(2000); await shot("01-after-close"); stat("closed");
  await m(506, 364); await sleep(1200); await shot("02-house-hover");
  await c(506, 364); await sleep(4000); await shot("03-collected"); stat("collected");
  await sleep(4000); dump("completed");
  await reload(); await sleep(4000); await shot("04-reloaded"); stat("reloaded"); dump("final");
}
