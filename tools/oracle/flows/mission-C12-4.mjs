// Complete the buyExpansion mission 4 ("Size does Matter") by buying one map expansion with cash; record claim and reload state.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "4500000"; prof.DCCash = "100";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "4" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(3000); await shot("00-start");
  await c(570, 127); await sleep(1500); await shot("01-popup1");
  await c(570, 127); await sleep(1500); await shot("01a-popup1b");
  await c(578, 154); await sleep(1500); await shot("01b-popup2");
  await c(533, 67); await sleep(2000); await shot("01c-magazine-closed");
  await o.drag(600, 150, 280, 350); await sleep(1500); await shot("02-dragged");
  await c(628, 400); await sleep(2500); await shot("03-expansion-popup");
  await c(212, 361); await sleep(3500); await shot("04-expansion-bought"); stat("completed"); dump("completed");
  await c(570, 127); await sleep(2000); await shot("05-popup-closed");
  await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
