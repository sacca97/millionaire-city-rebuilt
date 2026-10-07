// Interactive exploration: boots post-tutorial save and idles; control via http://127.0.0.1:31836/{shot,mouse,eval,key,quit}
import { seedPostTutorial, sleep } from "../lib.mjs";
export default { seed: seedPostTutorial, async run(o) { await o.waitGame(); console.log("ready; db", o.dbPath); await sleep(Number(process.env.HOLD_MS || 900000)); } };
