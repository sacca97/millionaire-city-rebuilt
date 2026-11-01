// Class C27 investment, representative mission 66 "Investing" (type investment, amount 10, unlockLevel 8). Seeded as UP.
// The `investment` event fires when a finished investment is CLAIMED: PopupInvestSuccess.onClose (decompiled/scripts/com/dchoc/dollars/GUI/PopupInvestSuccess.as:99-100)
// registers investmentDone + investment, PopupInvestFail registers investment (:82). Starting an investment does not count.
// Counter shortcut: only 3 NPCs exist, so the PollManager counter "investment" is seeded at 7 and the 3 real claims below make 10.
// Claims: the 3 NPC investments are seeded as running rows with startedAt 21 days back; the server flips them to state 3 on load
// (refresh_investments), then Investment Portfolio (515,554), "Results" (503,182), close "Well Done" (569,170), three times.
const NPC = ["100000000000101", "100000000000102", "100000000000103"];
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "66" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
  const poll = prof.Profile.find((entry) => Array.isArray(entry.PollManager));
  poll.PollManager = [{ Count: [], chunk: "investment/7" }];
};
export const seedDocs = (mutateDoc) => mutateDoc("investmentsList", (d) => {
  const t = Date.now() - 21 * 86_400_000;
  d.investmentsStarted = "3";
  d.investmentsList = NPC.map((extId, i) => ({ investment: [], extId, userId: "-1", value: "0", time: "0", remindTime: "0", state: "2", startedAt: String(t + i), id: String(900001 + i) }));
});

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot"); stat("boot");
  await c(247, 455); await sleep(3000); await shot("01-invest-menu"); // toolbar invest icon
  await c(515, 554); await sleep(3000); await shot("02-portfolio");
  // After the 2nd claim company value passes 1M: mission 44 (earn companyValue, "You're a Millionaire I") pops up and swallows the next
  // click, so its close button (window 822,330 = stage 570,127) is pressed after claims 2 and 3 (also closes the mission 66 popup).
  for (let i = 0; i < 3; i++) {
    await c(503, 182); await sleep(3000); await shot(`03-${i}-results`);
    await c(569, 170); await sleep(2000); await shot(`04-${i}-after-close`);
    if (i > 0) { await c(570, 127); await sleep(2000); await shot(`05-${i}-after-mission-popup`); }
  }
  await sleep(6000); stat("claimed"); dump("completed");
  await reload(); await sleep(3000); await shot("06-reloaded"); stat("reloaded"); dump("final");
}
