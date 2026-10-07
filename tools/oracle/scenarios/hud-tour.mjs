import { seedPostTutorial, sleep } from "../lib.mjs";
// HUD tour: icon column hover, mission panel, options gear. Stage origin in the 1280x800 window = (252,203).
const X = 252, Y = 203;
export default { seed: seedPostTutorial, async run(o) {
  const c = (x, y) => o.click(x + X, y + Y), m = (x, y) => o.move(x + X, y + Y);
  await o.waitGame(); await c(195, 325); await sleep(2000); await c(399, 470); await sleep(5000);
  await o.shot("hud");                          // icons + click-me label
  await sleep(4000); await o.shot("hud-later");
  await m(35, 105); await sleep(900); await o.shot("hover-icon1");
  await m(35, 357); await sleep(900); await o.shot("hover-boss");
  await c(35, 357); await sleep(2500); await o.shot("missions-panel");
  await o.dump("hud-tour");
}};
