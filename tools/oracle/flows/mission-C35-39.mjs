// Class C35 visitCity, representative mission 39 "Visit other Cities" (amount 1, unlockLevel 2). Seeded as UP.
// Needs the Rust server (offline NPC friends, docs/rust-server-friends.md) and the harness FB mapping (default in loader.cjs).
// The friends bar shows Mayor, Cindy (613,547) and Sheik (688,547). Visit Cindy, dismiss the first-visit "Friend Upgrade" popup
// (needs two clicks), press Home (365,447): the own city shows "Mission Completed: Visit other Cities".
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "39" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot");
  await c(...(o.p ? [588, 555] : [613, 547])); await sleep(7000); await shot("01-visit-cindy");
  for (let i = 0; i < 2; i++) { await c(380, 430); await sleep(2500); } await shot("02-after-ok"); stat("visited");
  await c(365, 447); await sleep(9000); await shot("03-home"); // Home button of a visited city
  await sleep(2000); dump("completed");
  await reload(); await sleep(3000); await shot("04-reloaded"); stat("reloaded"); dump("final");
}
