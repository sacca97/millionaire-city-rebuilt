// Economy flows against the real server (temp sqlite): decorations are built at once, commerces start renting, wonders end
// in StateOnBuilt, clubs wait for their crew, HQ road connectivity suspends/resumes items; everything survives a reload.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Game, type GameItem } from "../src/game/game";
import { RENT_MODE, STATE_ID } from "../src/net/commands";
import { parseWorld, type WorldState } from "../src/model/save";
import { GameConnection } from "../src/net/protocol";
import { createServerApp } from "../../server/src/serverApp";
import { getServerConfig } from "../../server/src/config";
import { fetchText, loadDefsSync } from "./helpers";

const apps: Array<ReturnType<typeof createServerApp>> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.stop();
});
const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcity-eco-")), "save.sqlite");
const defs = loadDefsSync();

/** Advance the simulation clock by `ms` without feeding the command queue a huge real-time delta. */
function advance(game: Game, ms: number): void {
  game.timeScale = ms / 1000;
  game.tick(1000);
  game.timeScale = 1;
}

async function startServer(dbPath: string) {
  const config = { ...getServerConfig(), dbPath, useHttpsFacebookShim: false, httpPort: 0, httpsPort: 0 };
  const app = createServerApp(config);
  apps.push(app);
  await app.start();
  const conn = new GameConnection({ baseUrl: `http://127.0.0.1:${config.httpPort}`, uid: config.launcherUserId });
  await conn.login();
  const dbWorld = async (): Promise<WorldState> => parseWorld((await conn.query("get_world", { targetUserId: 1 }))!._dat);
  return { app, conn, dbWorld };
}

/** Builds roads from the item's ring to the nearest road tile over free tiles (BFS) so it is HQ-connected. */
function connect(game: Game, it: GameItem): void {
  const roads = game.world.roads;
  const free = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < 90 && y < 60 && !game.itemAtTile(x, y) && !roads.has(y * 90 + x) && game.checkRoad(x, y).ok;
  const start: Array<[number, number]> = [];
  for (let dx = -1; dx <= it.cols; dx += 1) {
    for (let dy = -1; dy <= it.rows; dy += 1) {
      const corner = (dx === -1 || dx === it.cols) && (dy === -1 || dy === it.rows);
      if (!corner && free(it.tileX + dx, it.tileY + dy)) start.push([it.tileX + dx, it.tileY + dy]);
    }
  }
  const prev = new Map<number, [number, number] | null>(start.map(([x, y]) => [y * 90 + x, null]));
  const q = [...start];
  let end: [number, number] | undefined;
  while (q.length > 0 && !end) {
    const [x, y] = q.shift() as [number, number];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as Array<[number, number]>) {
      if (roads.has(ny * 90 + nx)) {
        end = [x, y];
        break;
      }
      if (free(nx, ny) && !prev.has(ny * 90 + nx)) {
        prev.set(ny * 90 + nx, [x, y]);
        q.push([nx, ny]);
      }
    }
  }
  let cur = end ?? null;
  while (cur) {
    game.buildRoad(cur[0], cur[1]);
    cur = prev.get(cur[1] * 90 + cur[0]) ?? null;
  }
}

describe("economy against the real server", () => {
  it("decoration built at once, commerce renting, wonder built, club hiring; all persisted", async () => {
    const dbPath = tmpDb();
    let ids: Record<string, string> = {};
    {
      const { conn, dbWorld } = await startServer(dbPath);
      const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
      game.applyGain({ coins: 3_000_000, cash: 10, exp: 1200 });
      const deco = game.autoBuild("decorations_tree_01")!;
      expect(deco).toMatchObject({ stateId: STATE_ID.BUILT });
      const shop = game.autoBuild("commerce_pizza")!;
      const wonder = game.autoBuild("wonder_statue_of_money")!;
      const club = game.autoBuild("club_001")!;
      for (const it of [shop, wonder, club]) connect(game, it);
      expect(club).toMatchObject({ stateId: 7, mode: 2 });
      expect([...game.economy.disconnectedSids()]).toEqual([]);
      await game.flush();

      advance(game, 1_300_000); // pizza construction (20 min) done: it starts renting at once
      expect(shop).toMatchObject({ stateId: STATE_ID.RENT, mode: RENT_MODE.RENTING });
      advance(game, 21_000 * 60_000); // wonder (14 days) done
      expect(wonder).toMatchObject({ stateId: STATE_ID.BUILT });
      expect(game.economy.wonderValue("influence", { sku: "houses_001_001", type: 0 })).toBe(defs.get("wonder_statue_of_money")!.rules.incomeValue);

      // club: pay the crew with gold, complete -> a normal item waiting for a contract
      const cash = game.profile.cash;
      expect(game.buyCrew(club.sid)).toBe(true);
      expect(game.profile.cash).toBe(cash - 6);
      expect(game.completeCrew(club.sid)).toBe(true);
      expect(club).toMatchObject({ stateId: STATE_ID.RENT, mode: RENT_MODE.WAITING_FOR_CONTRACT });
      await game.flush();
      const w = await dbWorld();
      const byId = (sid: string) => w.mine!.items.find((i) => i.sid === sid)!;
      expect(byId(deco.sid)).toMatchObject({ stateId: STATE_ID.BUILT });
      expect(byId(shop.sid)).toMatchObject({ stateId: STATE_ID.RENT });
      expect(byId(shop.sid).state.mode).toBe(String(RENT_MODE.RENTING));
      expect(byId(wonder.sid)).toMatchObject({ stateId: STATE_ID.BUILT });
      expect(byId(club.sid)).toMatchObject({ stateId: STATE_ID.RENT });
      expect(Number(w.profile.raw.DCCash)).toBe(game.profile.cash);
      ids = { deco: deco.sid, shop: shop.sid, wonder: wonder.sid, club: club.sid };
    }
    await apps.pop()?.stop();
    const { conn } = await startServer(dbPath);
    const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
    expect(game.item(ids.deco)).toMatchObject({ stateId: STATE_ID.BUILT });
    expect(game.item(ids.shop)).toMatchObject({ stateId: STATE_ID.RENT, isCommerce: true });
    expect(game.item(ids.wonder)).toMatchObject({ stateId: STATE_ID.BUILT, isWonder: true });
    expect(game.item(ids.club)).toMatchObject({ stateId: STATE_ID.RENT, isClub: true });
    expect(game.economy.wonderValue("influence", { sku: "houses_001_001", type: 0 })).toBeGreaterThan(0);
  });

  it("an item without a road to the HQ is suspended (server flag, frozen timers); a road resumes it", async () => {
    const { conn, dbWorld } = await startServer(tmpDb());
    const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
    game.applyGain({ coins: 3_000_000 });
    // the 2x2 spot (inside my plots) farthest from every road
    const roads = [...game.world.roads].map((i) => [i % 90, Math.floor(i / 90)] as const);
    let best: { x: number; y: number; d: number } | undefined;
    for (let x = 30; x < 62; x += 1) {
      for (let y = 15; y < 45; y += 1) {
        const cells = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => [x + dx, y + dy] as const);
        if (!cells.every(([cx, cy]) => game.checkTerrain(cx, cy).ok || game.world.terrain.has(cy * 90 + cx)) || cells.some(([cx, cy]) => game.itemAtTile(cx, cy))) continue;
        const d = Math.min(...roads.map(([rx, ry]) => Math.abs(rx - x) + Math.abs(ry - y)));
        if (!best || d > best.d) best = { x, y, d };
      }
    }
    const spot = best!;
    expect(spot.d).toBeGreaterThan(4);
    for (let dx = 0; dx < 2; dx += 1) for (let dy = 0; dy < 2; dy += 1) game.buyTerrain(spot.x + dx, spot.y + dy);
    expect(game.build("houses_001_001", spot.x, spot.y)).toBe(true);
    const house = game.itemAtTile(spot.x, spot.y)!;
    expect(game.economy.isConnected(house.sid)).toBe(false);
    game.tick(100);
    expect(house.suspended).toBe(true);
    await game.flush();
    let w = await dbWorld();
    expect(w.mine!.items.find((i) => i.sid === house.sid)!.suspended).toBe(true);
    // suspended items do not run: a long elapsed time changes nothing
    const t0 = house.time;
    advance(game, 600_000);
    expect(house.time).toBe(t0);
    // a suspended house whose rent is ready does not pay
    house.stateId = STATE_ID.RENT;
    house.mode = RENT_MODE.GET_RENT;
    const coins = game.profile.coins;
    expect(game.collectRent(house.sid)).toBeNull();
    expect(game.profile.coins).toBe(coins);
    house.stateId = STATE_ID.CONSTRUCTION;
    house.mode = 2;
    connect(game, house);
    expect(game.economy.isConnected(house.sid)).toBe(true);
    game.tick(100);
    expect(house.suspended).toBe(false);
    await game.flush();
    w = await dbWorld();
    expect(w.mine!.items.find((i) => i.sid === house.sid)!.suspended).toBe(false);
    advance(game, 700_000);
    expect(house).toMatchObject({ stateId: STATE_ID.RENT }); // construction runs again
  });
});
