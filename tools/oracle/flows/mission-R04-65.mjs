// Reward-shape class R04 (reward group 0: exp only, rewardAmount 10000). Mission 65 "Business Partners Deal" is seeded as REACHED
// (claim-only: its visitPartner trigger is not driven), claimed in the missions panel, then reload. No altMissions flag.
// Same claim path as mission-default-item-reward.mjs.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  prof.flags = "";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "" }, { Reached: [], chunk: "65" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(2000); await dump("loaded-reached");
  await c(35, 357); await sleep(1500); await shot("00-item-reward");
  await c(517, 220); await sleep(2500); await shot("01-claimed"); stat("claimed"); dump("claimed");
  await reload(); await shot("02-reloaded"); stat("reloaded"); dump("final");
}
