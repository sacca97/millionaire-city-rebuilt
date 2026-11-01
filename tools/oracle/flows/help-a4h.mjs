// Ask-for-help flow (PopupInstantBuild / StateOnConstructionOwner.onAskHelp): build a house, click the construction (Popup_wonders),
// press "Ask for help" (ask_for_help -> help_id "null" -> TID_A4H_REQUEST info popup), then click the construction again and
// press the cash button (Instant Build).
export const seed = (u, prof) => { prof.DCCoins = "200000"; prof.DCCash = "100"; };
export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump } = o;
  await o.boot(); await sleep(3000); await c(533, 67); await sleep(2000); stat("start"); await shot("00-start");
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) { await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200); }
  await c(618, 459); await sleep(3000); await shot("shop"); await c(Number(process.env.SX ?? 388), Number(process.env.SY ?? 355)); await sleep(3000); await m(572, 241); await sleep(800); await c(572, 241); await sleep(4000);
  stat("placed");
  await c(572, 241); await sleep(3000); await shot("01-popup");
  await c(Number(process.env.AX ?? 464), Number(process.env.AY ?? 401)); await sleep(2500); await shot("02-after-ask"); stat("asked");
  await c(Number(process.env.OX ?? 380), Number(process.env.OY ?? 375)); await sleep(1500); await shot("03-info-closed");
  await c(572, 241); await sleep(3000); await shot("04-popup-again");
  await c(Number(process.env.BX ?? 320), Number(process.env.BY ?? 401)); await sleep(3000); await shot("05-trade-box");
  dump("final");
}
