// Complete the alt-set collect mission 95 ("5 from Pizza", 5 x commerce_pizza collects, coins 40000 + exp 100, showInABtest alt_missions).
// Same shortcut as mission-C19-32.mjs: road-connected Pizzeria (6,1) with Customers > 0 and Income > 0 (lib-commerce.mjs), the
// collect counter seeded at 4 (PollManager "collectcommerce_pizza/4"), and one real collect in the flow makes it 5.
// Alt set: the profile flag altMissions:1 must be in the flags string (see docs/missions-flow-recipes.md). Mission 95 has no unlockSku.
import { seedCommerce, PIZZA_AT_6_1_WAITING, signHouse } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedCommerce(u, prof, PIZZA_AT_6_1_WAITING);
  prof.flags = "altMissions:1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "95" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
  const poll = prof.Profile.find((entry) => Array.isArray(entry.PollManager));
  poll.PollManager = [{ Count: [], chunk: "collectcommerce_pizza/4" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(4000); await shot("00-ready");
  await signHouse(o); await shot("01-signed");
  await sleep(8000); await reload(); await sleep(2000); await shot("02-reloaded-before-collect");
  await m(588, 353); await sleep(1200); await c(588, 353); await sleep(3000); await shot("03-collected");
  stat("collected"); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
