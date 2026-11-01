// Probe (C33): what the first and second clicks on the Friend Upgrade popup do after the Sheik visit, one screenshot each.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "68" }, { Reached: [], chunk: "" }, { Given: [], chunk: "39" }];
  const poll = prof.Profile.find((entry) => Array.isArray(entry.PollManager));
  poll.PollManager = [{ Count: [], chunk: "upgradehouses_005_002/69" }];
};
export default async function (o) {
  const { sleep, click: c, shot } = o;
  const sheik = o.p ? [663, 555] : [688, 547];
  await o.boot(); await sleep(10000);
  await c(...sheik); await sleep(7000); await shot("01-visit");
  await c(380, 430); await sleep(2500); await shot("02-after-click1");
  await c(380, 430); await sleep(2500); await shot("03-after-click2");
  await sleep(1000);
}
