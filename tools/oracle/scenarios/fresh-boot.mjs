import { sleep } from "../lib.mjs";
export default { async run(o) {
  await o.waitLog(/get_world|login/, 120000).catch(() => {}); await sleep(20000);
  await o.shot("loading-or-advisor");
  await o.waitLog(/\[game\]/); await sleep(15000); await o.shot("advisor");
  await o.click(537, 510); await sleep(5000); await o.shot("tutorial-1");
  await sleep(5000); await o.shot("tutorial-2");
  await o.dump("after-tutorial-start");
}};
