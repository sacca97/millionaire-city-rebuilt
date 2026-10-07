// Name the city and claim its 20,000 coins to cross mission 43's 1,000,000 coin threshold.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "990000"; prof.millionNewsFeed = "1";
  const missionEntry = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missionEntry.Missions = [{ Up: [], chunk: "43" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(6000);
  await shot("01-earn-mission"); stat("claimed"); dump("claimed");
  await reload(); await sleep(3000);
  await shot("02-reloaded"); stat("reloaded"); dump("final");
}
