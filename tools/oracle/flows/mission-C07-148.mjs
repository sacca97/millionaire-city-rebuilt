// C07 sku 148 is showInABtest="alt_missions"; boot and dump to confirm the original does not offer it.
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000"; prof.millionNewsFeed = "1";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "148" }, { Reached: [], chunk: "" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, shot, stat, dump } = o;
  await o.boot(); await sleep(6000);
  await shot("01-check"); stat("check"); dump("completed");
}
