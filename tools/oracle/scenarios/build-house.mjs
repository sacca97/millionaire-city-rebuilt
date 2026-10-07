import { seedPostTutorial, sleep } from "../lib.mjs";
export default { seed: seedPostTutorial, async run(o) {
  await o.waitGame(); await o.click(447, 528); await sleep(2000); await o.click(651, 673); await sleep(3000);
  await o.click(815, 662); await sleep(1000); await o.move(790, 390); await sleep(500); for (const [dx,dy] of [[0,0],[28,14],[-28,-14],[28,-14],[-28,14],[0,28],[0,-28],[56,0],[-56,0]]) { await o.click(792+dx, 392+dy); await sleep(1500); }
  await o.shot("plot-bought"); await o.dump("plot-bought");
  await o.click(870, 662); await sleep(3000); await o.click(507, 558); await sleep(3000);
  await o.move(790, 390); await sleep(800); await o.move(793, 392); await sleep(800); await o.shot("placing");
  await o.click(793, 392); await sleep(4000); await o.shot("house-placed"); await o.dump("house-placed");
  await o.click(793, 392); await sleep(3000); await o.shot("house-clicked"); // contract/rent UI: inspect screenshot, extend coordinates
  await o.dump("house-clicked");
}};
