import { seedPostTutorial, sleep } from "../lib.mjs";
export default { seed: seedPostTutorial, async run(o) {
  await o.waitGame(); await o.shot("daily-prizes");
  await o.click(447, 528); await sleep(2000); await o.click(651, 673); await sleep(3000);
  await o.shot("hud-1280x800"); await o.dump("post-tutorial");
  await o.scroll(10000); await sleep(500); await o.shot("page-bottom");
}};
