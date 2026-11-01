// Interactive exploration of the friends features with the original client: post-tutorial save, level 9, $500k, no daily reward due;
// idles for HOLD_MS (default 15 min); drive it with http://127.0.0.1:<PORT_BASE+3>/{shot,mouse,eval,key,quit} (see tools/oracle/README.md).
import { sleep } from "../lib.mjs";
import { seedFlow } from "../flowlib.mjs";
// HOLD_INVEST_DONE=1: the three NPC friends already hold investments that ran out 1 day ago (state 2 -> 3 on load: claimable).
const seedInvestDone = (mutateDoc) => mutateDoc("investmentsList", (d) => {
  const t = Date.now() - 21 * 86_400_000;
  d.investmentsStarted = "3";
  d.investmentsList = ["100000000000101", "100000000000102", "100000000000103"].map((extId, i) => ({ investment: [], extId, userId: "-1", value: "0", time: "0", remindTime: "0", state: "2", startedAt: String(t + i), id: String(t + i) }));
});
export default { seed: (o) => { seedFlow(o.mutateDoc, { extra: (_u, prof) => { prof.exp = "6000"; prof.DCCoins = "500000"; } }); if (process.env.HOLD_INVEST_DONE === "1") seedInvestDone(o.mutateDoc); }, async run(o) { await o.waitGame(); console.log("ready; db", o.dbPath); await sleep(Number(process.env.HOLD_MS || 900000)); } };
