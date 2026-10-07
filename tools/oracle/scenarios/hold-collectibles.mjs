import { seedCollectibles, sleep } from "../lib.mjs";
export default { seed: seedCollectibles, async run(o) { await o.waitGame(); console.log("ready"); await sleep(Number(process.env.HOLD_MS || 900000)); } };
