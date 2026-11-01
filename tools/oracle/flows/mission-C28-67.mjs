// Class C28 investmentDone, representative mission 67 "Smart Investing" (type investmentDone, amount 5, unlockLevel 12). Seeded as UP.
// The `investmentDone` event fires when a finished SUCCESSFUL investment is CLAIMED: PopupInvestSuccess.onClose registers
// investmentDone + investment (decompiled/scripts/com/dchoc/dollars/GUI/PopupInvestSuccess.as:99-100). A failed claim registers only
// `investment` (PopupInvestFail.as:82), so it does not count here.
// Counter shortcut: the PollManager counter "investmentDone" is seeded at 4, and one real success claim makes 5.
// Claim: the NPC investments are seeded as running rows with startedAt 21 days back (the server flips them to state 3 on load),
// then toolbar invest icon (247,455), Investment Portfolio (515,554), first "Results" (503,182), close "Well Done" (569,170).
const NPC = ["100000000000101", "100000000000102", "100000000000103"];
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "67" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
  const poll = prof.Profile.find((entry) => Array.isArray(entry.PollManager));
  poll.PollManager = [{ Count: [], chunk: "investmentDone/4" }];
};
export const seedDocs = (mutateDoc) => mutateDoc("investmentsList", (d) => {
  const t = Date.now() - 21 * 86_400_000;
  d.investmentsStarted = "3";
  d.investmentsList = NPC.map((extId, i) => ({ investment: [], extId, userId: "-1", value: "0", time: "0", remindTime: "0", state: "2", startedAt: String(t + i), id: String(900001 + i) }));
});

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot"); stat("boot");
  await c(247, 455); await sleep(3000); await shot("01-invest-menu");
  await c(515, 554); await sleep(3000); await shot("02-portfolio");
  await c(503, 182); await sleep(3000); await shot("03-results");
  await c(569, 170); await sleep(3000); await shot("04-after-close");
  await sleep(6000); stat("claimed"); dump("completed");
  await reload(); await sleep(3000); await shot("05-reloaded"); stat("reloaded"); dump("final");
}
