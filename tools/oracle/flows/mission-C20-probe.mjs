// C20 probe: place a Bungalow, finish construction, open the contract dialog and screenshot it (find contract 154 = income time 2h, 4th card).
export const seed = (_u, prof) => {
  prof.exp = "12000"; prof.DCCoins = "500000";
  const missionEntry = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missionEntry.Missions = [{ Up: [], chunk: "55" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
  const pollEntry = prof.Profile.find((entry) => Array.isArray(entry.PollManager));
  pollEntry.PollManager = [{ Count: [], chunk: "collectHouses%2/199" }];
};

export default async function (o) {
  const { sleep, click: c, mv: m, shot, stat, mutateDoc, dump, reload } = o;
  await o.boot(); await sleep(2000);
  await c(563, 459); await sleep(1000);
  for (const [tx, ty] of [[556, 225], [588, 225], [556, 257], [588, 257]]) {
    await m(tx, ty); await sleep(300); await c(tx, ty); await sleep(1200);
  }
  await c(618, 459); await sleep(3000); await c(255, 355); await sleep(3000);
  await m(572, 241); await sleep(800); await c(572, 241); await sleep(4000);
  mutateDoc("universe", (u) => {
    const mine = u.universe.find((entry) => entry.World).World.find((company) => company.whose === "0");
    const house = mine.Company.find((item) => item.sku === "houses_001_001" && item.x === "6");
    house.Item[0].time = "4000"; house.Item[0].savedAt = String(Date.now());
  });
  await reload(); await sleep(6000);
  await m(575, 243); await sleep(1200); await c(575, 243); await sleep(3000);
  await shot("01-contract-dialog"); stat("dialog");
  await dump("probe");
}
