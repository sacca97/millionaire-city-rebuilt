// Reward-shape class R01 reward group 1 (coins+exp): same flow as mission-C02-183-taipei.mjs; the profile flag missionAltReward:1 selects the A/B reward group.
// Class C02 beat, rep2 mission 183 "More CV than arab" (condition 2 = Sheik, unlockLevel 31, showInABtest alt_missions). Seeded as UP
// with altMissions:1 (the alt set) and the XP of level 31 (XPTable.xml xpneed 589480). Same city seed as mission-C02-56-taipei:
// one houses_064_002 (companyValue 999999999) on the free plot (-5,-12) so the city value passes Sheik's 900M.
export const seed = (u, prof) => {
  prof.exp = "589480"; prof.DCCoins = "500000"; prof.flags = "altMissions:1,missionAltReward:1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "183" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
  const world = u.universe.find((e) => e.World).World.find((c) => c.whose === "0");
  world.Company.push({ sku: "houses_064_002", x: "-5", y: "-12", Item: [{ State: [], id: "1", mode: "1", time: "0" }] });
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot");
  await c(570, 127); await sleep(2000); await shot("01-after-close"); stat("closed");
  await sleep(25000); dump("completed"); // the mission-reward chain (98, 122, 308-314) runs for ~20 s after the boot in both clients
  await reload(); await sleep(3000); await shot("02-reloaded"); stat("reloaded"); dump("final");
}
