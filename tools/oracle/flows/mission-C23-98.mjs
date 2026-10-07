// Auto-complete the alt-set earn mission 98 ("1 Million in company value", companyValue >= 1,000,000, showInABtest alt_missions) from a seeded 990,000-coin save with altMissions:1; record state and reload.
// Mission 98 has no unlockSku in missionDefinitions.xml (only 308 depends on 98), so no prerequisite is seeded as Given.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "990000"; prof.millionNewsFeed = "1"; prof.flags = "altMissions:1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "98" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(6000);
  await shot("01-earn-mission"); stat("completed"); dump("completed");
  await sleep(8000); await reload(); await sleep(3000);
  await shot("reloaded"); stat("reloaded"); dump("final");
}
