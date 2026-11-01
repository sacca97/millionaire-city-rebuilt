// Class C27 investment, representative mission 66 "Investing" (amount 10, investment, unlockLevel 8). Seeded as UP.
// The `investment` event fires when a finished investment is CLAIMED (PopupInvestSuccess / PopupInvestFail), not when it starts.
// Offline path (Rust server, docs/rust-server-friends.md): toolbar invest icon (247,455) -> "Send Investment Request" (375,433): the NPC
// friends accept at once (POST /local/npc-invest, the page reloads the game) -> three running investments (Ronald, Cindy, Sheik, 19 days).
// To claim, time-warp them like the seed below (startedAt 21 days ago; the server flips state 2 -> 3 on load), then Investment Portfolio
// (515,554), "Results" (503,182 per row, rows 69 px apart), close "Well Done" (569,170). Seeded here so the flow can claim in one run.
const NPC = ["100000000000101", "100000000000102", "100000000000103"];
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "66" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};
export const seedDocs = (mutateDoc) => mutateDoc("investmentsList", (d) => {
  const t = Date.now() - 21 * 86_400_000;
  d.investmentsStarted = "3";
  d.investmentsList = NPC.map((extId, i) => ({ investment: [], extId, userId: "-1", value: "0", time: "0", remindTime: "0", state: "2", startedAt: String(t + i), id: String(t + i) }));
});

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot");
  await c(247, 455); await sleep(3000); await shot("01-invest-menu");
  await c(515, 554); await sleep(3000); await shot("02-portfolio"); // three "Results" buttons
  for (let i = 0; i < 3; i++) { await c(503, 182); await sleep(3000); if (i === 0) await shot("03-well-done"); await c(569, 170); await sleep(2000); }
  await shot("04-after-claims"); stat("claimed");
  await sleep(6000); dump("completed");
  await reload(); await sleep(3000); await shot("05-reloaded"); stat("reloaded"); dump("final");
}
