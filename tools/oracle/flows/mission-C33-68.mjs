// Class C33 upgrade sku, representative mission 68 "Friendly Visit I" (type upgrade, parameter houses_005_002, amount 70, unlockLevel 8).
// Seeded as UP. The original registers `upgrade` on every visitor upgrade (StateOnRentVisitor.doDoClick:35 -> ItemObject.registerEvent:
// PollManager key upgrade + sku). Counter shortcut: the poll counter "upgradehouses_005_002" is seeded at 69, one real upgrade of a
// houses_005_002 house on Sheik (layout: 10 such houses, all "waiting") makes 70.
// Visit: friends bar Sheik (688,547), "Friend Upgrade" popup (two clicks at 380,430), click candidate houses (add_upgrade_item),
// Home (365,447). Which house is houses_005_002 is found from the sid of each add_upgrade_item (apps/server-rs/data/sheikLayout.json).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  // 39 (visitCity) is seeded Given: ours registers visitCity at visit start and shows its "Mission Completed" popup inside the visit
  // (blocking the house clicks); the original defers it to Home. Seeding it done keeps both runs free of that popup.
  missions.Missions = [{ Up: [], chunk: "68" }, { Reached: [], chunk: "" }, { Given: [], chunk: "39" }];
  const poll = prof.Profile.find((entry) => Array.isArray(entry.PollManager));
  poll.PollManager = [{ Count: [], chunk: "upgradehouses_005_002/69" }];
};

// Grid of house clicks on Sheik's city (stage coordinates; the city area is roughly y 110..410). MCITY_UPGRADES_PER_DAY=100 lifts the
// daily cap, so every eligible house that is clicked upgrades once (the first click gave sid 4083 = houses_008_002 in a 1-click probe).
const CLICKS = [];
for (let y = 110; y <= 410; y += 60) for (let x = 60; x <= 700; x += 60) CLICKS.push([x, y]);

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(10000); await shot("00-boot"); stat("boot");
  // Sheik's friends-bar box: stage (688,547) in the original window; our 760x600 HUD draws the same box at about (663,555)
  const sheik = o.p ? [663, 555] : [688, 547];
  await c(...sheik); await sleep(7000); await shot("01-visit-sheik");
  // the first-visit "Friend Upgrade" popup: the original needs two clicks; ours has one popup, and its second click at (380,430) lands on
  // the visitor Home arrow (ours ends the visit there, see mission-C33-probe.mjs), so ours gets one click
  // Rerun 2026-11-01: the same one click on both sides after the same 3 s wait (see mission-C34-69.mjs)
  await sleep(3000); await c(380, 430); await sleep(2500); await shot("02-after-ok"); stat("visited");
  // pan the city to the right so the houses on the left edge (Sheik's houses_005_002 at world x -21..-30) come into view
  await o.drag(250, 300, 700, 300); await sleep(1500); await shot("02b-panned");
  for (let i = 0; i < CLICKS.length; i++) {
    const [x, y] = CLICKS[i];
    console.log(`CLICK ${Date.now()} ${x} ${y}`); await c(x, y); await sleep(1200);
    if (i % 11 === 10) await shot(`03-${String(i).padStart(2, "0")}-grid`);
  }
  await c(365, 447); await sleep(9000); await shot("04-home"); // Home button of a visited city
  await sleep(2000); dump("completed");
  await reload(); await sleep(3000); await shot("05-reloaded"); stat("reloaded"); dump("final");
}
