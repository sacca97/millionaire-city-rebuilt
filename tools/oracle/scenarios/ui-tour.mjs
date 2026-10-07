import { seedPostTutorial, sleep } from "../lib.mjs";
// Options gear, vault bar, storage/album, road + demolish tool cursors. Stage origin in the 1280x800 window = (252,203).
const X = 252, Y = 203;
export default { seed: seedPostTutorial, async run(o) {
  const c = (x, y) => o.click(x + X, y + Y), m = (x, y) => o.move(x + X, y + Y);
  await o.waitGame(); await c(195, 325); await sleep(2000); await c(399, 470); await sleep(4000);
  await m(748, 408); await sleep(900); await o.shot("gear-hover");
  await c(748, 408); await sleep(1500); await o.shot("options-open");
  await m(690, 408); await sleep(900); await o.shot("options-hover-btn");
  await c(748, 408); await sleep(800);
  await c(150, 458); await sleep(1500); await o.shot("vault-open");
  await c(150, 458); await sleep(500);
  await c(675, 459); await sleep(800); await m(556, 225); await sleep(900); await o.shot("road-tool");
  await c(505, 459); await sleep(500);
  await c(733, 459); await sleep(800); await m(300, 100); await sleep(900); await o.shot("destroy-tool-empty");
  await m(150, 215); await sleep(900); await o.shot("destroy-tool-house");
  await c(505, 459); await sleep(500);
  await c(60, 455); await sleep(2500); await o.shot("briefcase");
  await o.dump("ui-tour");
}};
