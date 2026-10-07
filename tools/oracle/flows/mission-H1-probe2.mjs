// H1 probe 2: pizza (6,1) seeded, bungalow 2171 WAITING (no contract) and signed in-session. Mission 31 as C17.
import { seedCommerce, PIZZA_AT_6_1_WAITING, signHouse } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedCommerce(u, prof, PIZZA_AT_6_1_WAITING);
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "31" }, { Reached: [], chunk: "" }, { Given: [], chunk: "18" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(4000); await shot("00-ready");
  await signHouse(o); await shot("01-signed");
  await sleep(6000); await shot("02-after-sign"); stat("signed");
  await m(588, 353); await sleep(1200); await c(588, 353); await sleep(3000); await shot("03-collected");
  stat("collected"); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
