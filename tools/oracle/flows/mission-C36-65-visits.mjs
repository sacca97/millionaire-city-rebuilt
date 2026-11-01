// Class C36 visitPartner, representative mission 65 "Business Partners Deal" (amount 40, visitPartner, unlockLevel 20). Seeded as UP.
// Every NPC visit counts (NeighborObject.isPartner = isAdvisor(), DollarsGame.as:1620-1624): 40 visits of Cindy (613,547), each followed
// by Home (365,447). The first visit also shows the "Friend Upgrade" popup (two OK clicks at 380,430) and the "Mission Completed: Visit
// other Cities" popup after the first Home, which covers the friends bar until closed (570,127). Run with VISITS=40 (default 40).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "65" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  const visits = Number(process.env.VISITS ?? 40);
  await o.boot(); await sleep(10000); await shot("00-boot");
  for (let i = 0; i < visits; i++) {
    await c(613, 547); await sleep(7000);
    if (i === 0) { await shot("01-visit"); for (let k = 0; k < 2; k++) { await c(380, 430); await sleep(2500); } }
    await c(365, 447); await sleep(9000); // Home
    if (i === 0) { await shot("02-home"); await c(570, 127); await sleep(2000); await shot("03-home-popup-closed"); }
  }
  stat("visited"); dump("completed");
  await reload(); await sleep(3000); await shot("04-reloaded"); stat("reloaded"); dump("final");
}
