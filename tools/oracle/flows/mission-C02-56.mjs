// Class C02 beat, representative mission 56 "The Sheik challenge" (type beat, condition 2 = Sheik, companyValue 900000000,
// unlockLevel 25). Seeded as UP with the XP of level 25 (XPTable.xml xpneed 198150) and companyValue 900M (Sheik's value).
// The beat event is checked from the profile company value (Profile.eventCheck, Profile.as:746-760): no server work.
// Flow: boot (the event fires on load), close the mission popup, dump, reload, dump.
export const seed = (_u, prof) => {
  prof.exp = "198150"; prof.DCCoins = "500000"; prof.companyValue = "900000000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "56" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot");
  await c(570, 127); await sleep(2000); await shot("01-after-close"); stat("closed");
  await sleep(4000); dump("completed");
  await reload(); await sleep(3000); await shot("02-reloaded"); stat("reloaded"); dump("final");
}
