import { Application } from "pixi.js";
import { GameConnection } from "./net/protocol";
import { loadDefinitions } from "./model/definitions";
import { parseWorld } from "./model/save";
import { SpriteLibrary } from "./view/sprites";
import { CityView, MAP_COLS, MAP_ROWS } from "./view/city";
import { TrafficView } from "./view/traffic";

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x1d2a1f, antialias: false, resolution: window.devicePixelRatio || 1, autoDensity: true });
  document.getElementById("game")!.appendChild(app.canvas);
  const conn = new GameConnection();
  await conn.login();
  const [defs, lib, world] = await Promise.all([loadDefinitions(), SpriteLibrary.load(), conn.query("get_world")]);
  const state = parseWorld((world?._dat ?? {}) as Record<string, unknown>);
  const city = new CityView(app, lib, defs);
  await city.render(state);
  city.centerOn(MAP_COLS / 2, MAP_ROWS / 2);

  const traffic = new TrafficView(app, TrafficView.roadsFromRelative(state.roads, MAP_COLS, MAP_ROWS), lib, { plots: 20, seed: 1 });
  city.world.addChildAt(traffic.container, 1);
  await traffic.start();
  app.ticker.add((t) => traffic.tick(t.deltaMS));
  // fast-forward so the test screenshot has cars: spawn a batch immediately
  for (let i = 0; i < 200; i += 1) traffic.sim.trySpawn();
  (window as unknown as { __mcity: unknown }).__mcity = { conn, state, city, defs, traffic };
}
boot().catch((e) => { document.body.insertAdjacentHTML("beforeend", `<pre style="color:#fff">${String(e)}</pre>`); console.error(e); });
