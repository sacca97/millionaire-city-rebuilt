// Interactive: fresh (tutorial-required) save, idles. Control via http://127.0.0.1:<base+3>/{shot,mouse,eval,key,quit}
import { sleep } from "../lib.mjs";
export default { async run(o) { await o.waitLog(/load_success/, 150000); await sleep(15000); console.log("ready; db", o.dbPath); await sleep(Number(process.env.HOLD_MS || 3000000)); } };
