// Drives OUR client (playwright-core): node ours-shot.mjs <prefix> <w> <h> <json steps> [url]; steps: click|move|wait|key|eval|shot. Needs CHROME=<chromium>.
import { chromium } from "playwright-core";
// usage: node drv.mjs out.png w h 'json steps'  steps: [["click",x,y],["wait",ms],["shot","name"],["eval","js"],["move",x,y],["key","k"]]
const [,, prefix, w, h, steps, url="http://localhost:5175/"] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0,300)));
await p.goto(url); await p.waitForTimeout(6000);
for (const s of JSON.parse(steps)) {
  if (s[0]==="click") { await p.mouse.click(s[1], s[2]); }
  else if (s[0]==="drag") { await p.mouse.move(s[1], s[2]); await p.mouse.down(); await p.mouse.move(s[3], s[4], { steps: 8 }); await p.mouse.up(); } // ["drag",x1,y1,x2,y2]
  else if (s[0]==="move") await p.mouse.move(s[1], s[2]);
  else if (s[0]==="wait") await p.waitForTimeout(s[1]);
  else if (s[0]==="key") await p.keyboard.press(s[1]);
  else if (s[0]==="eval") console.log("[eval]", JSON.stringify(await p.evaluate(s[1]))?.slice(0,1500));
  else if (s[0]==="shot") await p.screenshot({ path: `${prefix}_${s[1]}.png` });
  await p.waitForTimeout(400);
}
await b.close();
