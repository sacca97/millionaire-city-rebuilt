import { seedPostTutorial, sleep } from "../lib.mjs";
export default { seed: seedPostTutorial, async run(o) {
  await o.waitGame(); await o.click(447, 528); await sleep(2000); await o.click(651, 673); await sleep(3000);
  await o.click(870, 662); await sleep(3000); await o.shot("shop-houses");
  await o.dump("shop-open");
}};
