// Complete the collect mission 32 ("Pizzalicious Sale II", 5 x commerce_pizza collects, reward commerce_coffee).
// Seeded: road-connected Pizzeria (6,1) with Customers > 0 and Income > 0 (lib-commerce.mjs), the collect counter already at 4
// (PollManager "collectcommerce_pizza/4", the same shortcut as flows/mission-collect.mjs), and one collect in the flow makes it 5.
// The bungalow is signed in-session (see mission-C17-31.mjs for why).
// Mission 32 needs mission 31 reached (unlockSku), so 18 and 31 are seeded as Given.
import { seedCommerce, PIZZA_AT_6_1_WAITING, signHouse } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedCommerce(u, prof, PIZZA_AT_6_1_WAITING);
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "32" }, { Reached: [], chunk: "" }, { Given: [], chunk: "18,31" }];
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
