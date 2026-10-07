import { Application, Graphics } from "pixi.js";
import { AudioManager } from "./audio/audio";
import { installDebugPanel } from "./debug/panel";
import { Game } from "./game/game";
import { MAP_COLS, MAP_ROWS, TILE } from "./game/geometry";
import { loadDefinitions } from "./model/definitions";
import { GameConnection } from "./net/protocol";
import { initUI } from "./ui";
import { CityView } from "./view/city";
import { SpriteLibrary } from "./view/sprites";
import { TrafficView } from "./view/traffic";

async function boot(): Promise<void> {
  const host = document.getElementById("game")!;
  const app = new Application();
  await app.init({ resizeTo: window, background: 0x1d2a1f, antialias: false, resolution: window.devicePixelRatio || 1, autoDensity: true });
  host.appendChild(app.canvas);

  // keepalive lets the last queued commands survive a page unload (see pagehide handler below).
  const conn = new GameConnection({ fetchFn: (input, init) => fetch(input, { ...init, keepalive: true }) });
  await conn.login();
  const [defs, lib, config] = await Promise.all([loadDefinitions(), SpriteLibrary.load(), conn.query("get_game_config")]);
  const game = await Game.boot({ conn, defs, fetchText: Game.fetchRules(), skipTutorial: new URLSearchParams(location.search).has("skipTutorial") });

  const city = new CityView(app, lib, defs);
  await city.render(game.state);
  // Rival companies' for-sale buildings (StateOnIA) are drawn like any item; their sign is added by ui/extras/rivals.ts.
  for (const c of game.state.companies) if (c !== game.state.mine) for (const it of c.items) void city.addItem(it);
  const hq = game.items().find((i) => i.sku === "HeadQuarter");
  if (hq) city.centerOnHQ(hq);
  else city.cameraStartTutorial();
  city.stateProvider = (sid) => {
    const it = game.item(sid);
    return it ? { stateId: it.stateId, mode: it.mode, time: it.time, incomeMs: it.incomeMs } : undefined;
  };

  const roadMap = () => ({ cols: MAP_COLS, rows: MAP_ROWS, roads: new Set(game.world.roads) });
  const traffic = new TrafficView(app, roadMap(), lib, {
    plots: game.expansions.states.filter((s) => s === 2).length,
    owned: (sku: string) => game.items().filter((i) => i.sku === sku).length
  });
  city.world.addChildAt(traffic.container, 1);
  await traffic.start();

  const audio = new AudioManager();
  audio.applyConfig((config?._dat ?? {}) as Record<string, string>);
  // DollarsGame.as:1640: once per session, when the world is shown (owner role): TASK_LOAD_SUCCESS {sig} (Server.java:466 resets load_fails).
  game.sendCommand(game.commands.loadSuccess());

  // Game -> view wiring.
  const selectionBox = new Graphics();
  city.overlayLayer.addChild(selectionBox);
  game.on("item-added", (item) => void city.addItem(item.placed));
  game.on("item-removed", ({ sid }) => city.removeItem(sid));
  game.on("item-changed", (item) => city.moveItemView(item.sid, item.sku, item.tileX, item.tileY));
  game.on("ghost", (g) => city.setGhost(g));
  game.on("map", ({ kind }) => {
    void city.redrawGround(game.world);
    if (kind === "road") traffic.setRoads(roadMap());
  });
  game.on("sound", ({ event, isDecoration }) => audio.play(event, { isDecoration }));
  game.on("selection", (item) => {
    selectionBox.clear();
    if (item) {
      selectionBox.rect(item.tileX * TILE, item.tileY * TILE, item.cols * TILE, item.rows * TILE).stroke({ color: 0xffff00, width: 2 });
    }
  });
  city.pointerHandlers = {
    move: (wx, wy) => game.pointerMove(wx, wy),
    click: (wx, wy) => game.pointerClick(wx, wy),
    leave: () => game.pointerLeave()
  };

  // Frame loop: wall-clock delta (Pixi caps deltaMS at 100 ms, which would slow timers in background tabs).
  let last = Date.now();
  app.ticker.add(() => {
    const now = Date.now();
    game.tick(now - last);
    last = now;
    traffic.tick(app.ticker.deltaMS);
  });
  const flushNow = (): void => {
    game.queue.flush();
    game.queue.tick(0);
  };
  window.addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushNow());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") game.setTool({ kind: "select" });
  });

  const root = document.createElement("div");
  root.id = "ui-root";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden";
  document.body.appendChild(root);
  await initUI({ game, conn, defs, audio, city, root });

  const debug = installDebugPanel(game);
  (window as unknown as { __mcity: unknown }).__mcity = { conn, game, state: game.state, city, defs, traffic, audio, debug };
}

boot().catch((err) => {
  document.body.insertAdjacentHTML("beforeend", `<pre style="color:#fff;padding:1em">${String(err)}</pre>`);
  console.error(err);
});
