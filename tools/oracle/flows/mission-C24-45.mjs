// Auto-complete the earn mission 45 (companyValue >= 5,000,000) from a seeded 4.8M-coin save; record state and reload.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "4800000"; prof.millionNewsFeed = "1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "45" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(6000);
  await shot("01-earn-mission"); stat("completed"); dump("completed");
  await reload(); await sleep(3000);
  await shot("reloaded"); stat("reloaded"); dump("final");
}
