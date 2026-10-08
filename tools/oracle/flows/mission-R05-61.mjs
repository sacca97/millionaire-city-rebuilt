// Reward-shape class R05 (reward group 0: exp 60000). Mission 61 "Pimp the Colonial" (unlockSku 30) is seeded as REACHED with its
// prerequisite 30 Given (claim-only: its bonus trigger is not driven), claimed in the missions panel, then reload. No altMissions flag.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  prof.flags = "";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "" }, { Reached: [], chunk: "61" }, { Given: [], chunk: "30" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(2000); await dump("loaded-reached");
  await c(35, 357); await sleep(1500); await shot("00-item-reward");
  await c(517, 220); await sleep(2500); await shot("01-claimed"); stat("claimed"); dump("claimed");
  await reload(); await shot("02-reloaded"); stat("reloaded"); dump("final");
}
