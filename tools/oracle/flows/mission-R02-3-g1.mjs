// Reward-shape class R02 reward group 1 (coins+exp): same flow as mission-C01-3.mjs; the profile flag missionAltReward:1 selects the A/B reward group.
// Class C01 askForHelp, representative mission 3 "Helping Hand" (type askForHelp, amount 1, unlockSku 17, reward 35000 coins).
// Seeded as UP with 17 Given (its unlockSku). The `askForHelp` event is registered at once when "Ask for Help" is pressed on a
// construction: StateOnConstructionOwner.onAskHelp (decompiled/scripts/com/dchoc/dollars/world/items/states/StateOnConstructionOwner.as:366-382)
// sends ask_for_help and registers askForHelp; ours: apps/client/src/ui/popups/instantBuild.ts:39-47 (game.poll('askForHelp')).
// Steps from help-a4h.mjs (same stage coordinates, 760x600 stage; checked against the boot screenshots of both sides):
// shop (563,459), item (388,355), place (572,241), click the construction (572,241), "Ask for Help" (464,401),
// close the "You can only ask help once every 12 hours" info (380,375).
export const seed = (_u, prof) => {
  prof.DCCoins = "200000"; prof.DCCash = "100"; prof.flags = "missionAltReward:1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "3" }, { Reached: [], chunk: "" }, { Given: [], chunk: "17" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await c(533, 67); await sleep(2000); stat("start"); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await c(618, 459); await sleep(3000); await shot("shop");
  await c(Number(process.env.SX ?? 388), Number(process.env.SY ?? 355)); await sleep(3000);
  await m(572, 241); await sleep(800); await c(572, 241); await sleep(4000);
  stat("placed");
  await c(572, 241); await sleep(3000); await shot("01-popup");
  await c(464, 401); await sleep(2500); await shot("02-after-ask"); stat("asked");
  await c(380, 375); await sleep(1500); await shot("03-info-closed");
  await sleep(25000); stat("claimed"); dump("completed"); // 25 s: the earn-mission chain (39, 44-46, 6) finishes after the ask in the original; 6 s dumped it mid-chain (attempt 1)
  await reload(); await sleep(3000); await shot("04-reloaded"); stat("reloaded"); dump("final");
}
