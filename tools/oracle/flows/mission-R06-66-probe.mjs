// Probe for the R06 claim hang: same seed and clicks as mission-R06-66.mjs, but after the claim click it times how long the page
// takes to answer a trivial evaluate (the screenshot after the claim timed out in two earlier runs).
export const seed = (_u, prof) => {
  prof.exp = "6000"; prof.DCCoins = "500000";
  prof.flags = "";
  const missions = prof.Profile.find((entry) => Array.isArray(entry.Missions));
  missions.Missions = [{ Up: [], chunk: "" }, { Reached: [], chunk: "66" }, { Given: [], chunk: "" }];
};

export default async function (o) {
  const { sleep, click: c, shot, stat, p } = o;
  await o.boot(); await sleep(2000);
  await c(35, 357); await sleep(1500);
  const t0 = Date.now();
  await c(517, 220);
  for (const wait of [1000, 3000, 6000]) {
    await sleep(wait);
    const r = await Promise.race([p.evaluate(() => 1).then(() => "answered"), sleep(15000).then(() => "NO ANSWER in 15s")]);
    console.log(`probe after claim +${Date.now() - t0} ms: ${r}`);
  }
  await shot("01-claimed");
}
