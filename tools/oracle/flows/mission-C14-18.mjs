// Complete the checkInfluence mission 18 ("Pizzalicious Clients I": Customers >= 3 for a commerce_pizza).
// Seeded: road-connected Pizzeria (6,1) (lib-commerce.mjs) and the tutorial bungalow 2171 (population 3 once signed),
// signed in-session so the population is counted during play. Mission 18 needs mission 2 given (unlockSku).
import { seedCommerce, PIZZA_AT_6_1_WAITING, signHouse } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedCommerce(u, prof, PIZZA_AT_6_1_WAITING);
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "18" }, { Reached: [], chunk: "" }, { Given: [], chunk: "2" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(4000); await shot("00-ready");
  await signHouse(o); await shot("01-signed");
  await sleep(8000); await shot("02-settled"); stat("signed");
  dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
