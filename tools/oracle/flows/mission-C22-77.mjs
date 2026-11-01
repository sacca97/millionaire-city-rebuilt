import { addTerrain } from "./lib-commerce.mjs";
// Class C22 collectUpgraded (sku), rep mission 77 "Shared Deal I" (type collectUpgraded, parameter Houses, amount 50, unlockSku 39).
// Seeded as UP with 39 Given (unlockSku). Counter shortcut: PollManager "collectUpgradedHouses/49", one upgraded collect makes it 50.
// The bungalow 2171 (4,2) is the only house: seeded on rent and READY (mode 5). The Rust server upgrades it at get_world (the NPC
// upgrade, docs/rust-server-friends.md "own-city NPC upgrades": Ronald first, one upgrade per house per day), so the collect pays +10%.
// Click (506,364) = bungalow (lib-commerce.mjs). Collect = hover + click.
export const seed = (u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "77" }, { Reached: [], chunk: "" }, { Given: [], chunk: "39" }];
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
