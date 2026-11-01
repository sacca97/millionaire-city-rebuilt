// Smoke of the offline NPC friends with the ORIGINAL client (needs the Rust server: MCITY_ORACLE_SERVER_CMD=.../mcity-server, and the
// harness loader maps graph/api.facebook.com to the shim, see docs/rust-server-friends.md):
//  1. the friends bar shows Mayor + Cindy + Sheik (no loading spinner)
//  2. click Sheik: his city loads ("Sheik's City", $900M), the "Friend Upgrade" popup is dismissed (several clicks are needed)
//  3. click a few buildings: a renting house sends add_upgrade_item ("x 5" upgrades left becomes "x 4", exp/coins grow)
//  4. Home: back in the own city; seeded mission 39 (visitCity) is completed ("Mission Completed: Visit other Cities")
//  5. toolbar invest icon -> "Send Investment Request": the NPC friends accept (POST /local/npc-invest), the page reloads the game,
//     the Investment Portfolio lists Ronald, Cindy, Sheik (19 days left)
// Coordinates are stage coordinates of the 760x600 SWF (the harness adds the window offset).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "39" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, dump } = o;
  await o.boot(); await sleep(10000); await shot("00-friends-bar");
  await c(688, 547); await sleep(7000); await shot("01-visit-sheik-popup"); // Sheik; Cindy is at (613,547)
  for (let i = 0; i < 2; i++) { await c(380, 430); await sleep(2500); } await shot("02-visit-sheik");
  for (const [x, y] of [[300, 190], [270, 190], [490, 330], [145, 250]]) { await c(x, y); await sleep(1500); }
  await shot("03-after-upgrade-clicks"); dump("visit");
  await c(365, 447); await sleep(9000); await shot("04-home-mission-completed"); // Home button of a visited city
  await c(570, 127); await sleep(2000); // close the mission popup
  await c(247, 455); await sleep(3000); await shot("05-invest-window"); // toolbar invest icon
  await c(375, 433); await sleep(2000); // Send Investment Request: NPC friends accept, the page reloads the game
  await o.boot(); await sleep(3000);
  await c(247, 455); await sleep(3000); await c(515, 554); await sleep(3000); await shot("06-investment-portfolio"); dump("final");
}
