// Reward-shape class R03 reward group 1: same flow as mission-C02-56-taipei.mjs; the profile flag missionAltReward:1 selects the A/B reward group.
// Class C02 beat, mission 56 "The Sheik challenge" (condition 2 = Sheik, companyValue 900000000, unlockLevel 25). Seeded as UP.
// Attempt 2: the client recomputes companyValue from the city items on load (apps/client/src/game/game.ts:345; the original shows
// $872,000 too), so a seeded companyValue does not reach 900M. One house with companyValue 999999999 (houses_064_002, Taipei 101,
// itemDefinitions.xml) is seeded on a free plot (-5,-12) so the city value passes Sheik's 900M. Seeded with the XP of level 25.
export const seed = (u, prof) => {
  prof.exp = "198150"; prof.DCCoins = "500000"; prof.flags = "missionAltReward:1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "56" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
  const world = u.universe.find((e) => e.World).World.find((c) => c.whose === "0");
  world.Company.push({ sku: "houses_064_002", x: "-5", y: "-12", Item: [{ State: [], id: "1", mode: "1", time: "0" }] });
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot");
  await c(570, 127); await sleep(2000); await shot("01-after-close"); stat("closed");
  await sleep(4000); dump("completed");
  await reload(); await sleep(3000); await shot("02-reloaded"); stat("reloaded"); dump("final");
}
