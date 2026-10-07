// H1 probe: seeded road-connected commerce_pizza (6,1) with the tutorial bungalow 2171 signed and RENTING.
// Goal: the ORIGINAL shows Customers > 0 and Income > 0 in the commerce tooltip. Uses lib-commerce.mjs.
import { seedCommerce, PIZZA_AT_6_1 } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedCommerce(u, prof, PIZZA_AT_6_1);
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "31" }, { Reached: [], chunk: "" }, { Given: [], chunk: "18" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(4000); await shot("00-ready");
  await m(588, 353); await sleep(1500); await shot("01-hover-pizza");
  await c(588, 353); await sleep(1500); await shot("02-click-pizza");
  stat("probe"); dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
