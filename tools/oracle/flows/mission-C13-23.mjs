// Complete the checkInfluence mission 23 (commerce_flower_shop, Customers >= 30, unlockLevel 7).
// Seeded: road-connected florist (3,-3) (lib-commerce.mjs FLORIST_AT_3_M3) and two houses_023_001 (20 tenants each) that are
// WAITING and signed in-session: the population is 20 after the first contract and 40 after the second (>= 30).
import { seedCommerce, FLORIST_AT_3_M3, signHouse } from "./lib-commerce.mjs";

export const seed = (u, prof) => {
  seedCommerce(u, prof, FLORIST_AT_3_M3);
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "23" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, dump, reload } = o;
  await o.boot(); await sleep(4000); await shot("00-ready");
  // the seeded company value (florist + 2 houses) completes the earn mission "Millionaire I" at boot and its popups eat the clicks:
  // close them first (X buttons of "Mission Completed" and "Millionaire the Year").
  await c(570, 127); await sleep(1500); await c(533, 67); await sleep(1500); await shot("00b-popups-closed");
  await signHouse(o, 572, 241); await shot("01-signed-A");
  await sleep(6000); stat("signed-A");
  await signHouse(o, 572, 337); await shot("02-signed-B");
  await sleep(8000); await shot("03-settled"); stat("signed-B");
  dump("completed");
  await sleep(8000); await reload(); await shot("reloaded"); stat("reloaded"); dump("final");
}
