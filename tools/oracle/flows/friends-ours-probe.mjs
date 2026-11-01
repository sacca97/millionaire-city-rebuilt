// OUR client against the Rust server: friends bar (get_neighbor_list + NPCs), visit Sheik, Home, investments window.
// usage: CHROME=~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome MCITY_CLIENT_DIST=/tmp/<build> OUT=<dir> PORT=32520 PREVIEW=http://127.0.0.1:32520/ \
//        MCITY_ORACLE_SERVER_CMD=<mcity-server> node tools/oracle/ours-flow.mjs friends-ours-probe
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "39,65" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};
export default async function (o) {
  const { sleep, click: c, shot, dump } = o;
  await o.boot(); await sleep(4000); await shot("00-friends-bar");
  await c(688, 547); await sleep(6000); await shot("01-visit-sheik");
  await c(380, 430); await sleep(2000); await shot("02-visit-sheik-2");
  dump("visit");
}
