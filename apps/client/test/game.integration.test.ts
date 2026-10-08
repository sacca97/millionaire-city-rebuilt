// End-to-end core loop: Game controller -> CommandQueue -> real server (temp sqlite) -> reload.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Game } from "../src/game/game";
import { parseWorld, type WorldState } from "../src/model/save";
import { GameConnection } from "../src/net/protocol";
import { createServerApp } from "../../server/src/serverApp";
import { getServerConfig } from "../../server/src/config";
import { fetchText, loadDefsSync } from "./helpers";

const apps: Array<ReturnType<typeof createServerApp>> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.stop();
});

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcity-game-")), "save.sqlite");

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

const defs = loadDefsSync();

/**
 * Company values the client had at earlier checkpoints. The original's persisted company value LAGS the last event (the security
 * object reports the stale UserDataFacade baseline, SecurityNormal.verify keeps it: docs/save-parity.md), so the DB value is either exact
 * or one of the values seen before; coins/exp/cash are exact (the server applies the reported gains).
 */
const seenValues = new Set<number>();
const watched = new WeakSet<Game>();

/** DB profile must equal the client's after the queue drained. */
async function expectSynced(game: Game, dbWorld: () => Promise<WorldState>, label: string, checkValue = true) {
  if (!watched.has(game)) {
    watched.add(game);
    game.on("profile", (pp) => seenValues.add(pp.companyValue));
  }
  await game.flush();
  const w = await dbWorld();
  const p = game.profile;
  const dbValue = Number(w.profile.raw.companyValue);
  expect({ label, coins: Number(w.profile.raw.DCCoins), exp: w.profile.exp, cash: w.profile.cash }).toEqual({
    label,
    coins: p.coins,
    exp: p.exp,
    cash: p.cash
  });
  if (checkValue) expect({ label, ok: dbValue === p.companyValue || seenValues.has(dbValue), dbValue, now: p.companyValue, seen: [...seenValues] }).toMatchObject({ label, ok: true }); // eslint-disable-line
  seenValues.add(p.companyValue);
  seenValues.add(dbValue);
  return w;
}

describe("Game core loop against the real server", () => {
  it("build -> construct -> sign -> rent -> collect -> sell, money in sync, persisted across reload", async () => {
    const dbPath = tmpDb();
    let sid = "";
    let after: ReturnType<Game["items"]>;
    {
      const { conn, dbWorld } = await startServer(dbPath);
      const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
      expect(game.tutorialSkipped).toBe(true);
      const p0 = game.profile;
      // DollarsGame.as:815 recomputes the company value at load; the DB keeps the starter value until the next command carries it
      await expectSynced(game, dbWorld, "boot", false);

      // build (terrain is bought tile by tile, then the item)
      const item = game.autoBuild("houses_001_001")!;
      expect(item).toBeTruthy();
      sid = item.sid;
      expect(game.profile.coins).toBeLessThan(p0.coins);
      expect(game.profile.exp).toBe(p0.exp + defs.get("houses_001_001")!.rules.exp);
      let w = await expectSynced(game, dbWorld, "built");
      expect(w.mine!.items.find((i) => i.sid === sid)).toMatchObject({ sku: "houses_001_001", stateId: 0 });
      expect(w.terrain.length).toBeGreaterThan(0);

      // construction finishes (x1e9 clock)
      game.tick(600_001);
      game.tick(3100); // construction-end notification animation
      expect(game.item(sid)).toMatchObject({ stateId: 1, mode: 1 });
      w = await expectSynced(game, dbWorld, "constructed");
      expect(w.mine!.items.find((i) => i.sid === sid)).toMatchObject({ stateId: 1 });
      expect(w.mine!.items.find((i) => i.sid === sid)!.state.mode).toBe("1");

      // sign
      game.timeScale = 1;
      const opts = game.contractOptions(sid);
      expect(opts.length).toBeGreaterThan(3);
      // 350 base rent + the influence of the decorations around the house (ItemObject.getIncomeValue :369)
      const rent = Math.trunc(350 + (350 * game.economy.influencePercent(sid)) / 100);
      expect(opts[0]).toMatchObject({ sku: 1, cost: 90, income: rent });
      expect(game.signContract(sid, 1)).toBe(true);
      expect(game.item(sid)).toMatchObject({ mode: 4, contractSku: 1 });
      w = await expectSynced(game, dbWorld, "signed");
      expect(w.mine!.items.find((i) => i.sid === sid)!.state).toMatchObject({ mode: "4", contractSku: "1" });

      // rent timer elapses -> collectable
      game.tick(200_000);
      expect(game.item(sid)!.mode).toBe(5);
      w = await expectSynced(game, dbWorld, "collectable");
      expect(w.mine!.items.find((i) => i.sid === sid)!.state.mode).toBe("5");

      // collect: +rent coins, +1 xp, house returns to waiting-for-contract on the server too
      const before = game.profile;
      expect(game.collectRent(sid)).toEqual({ coins: rent, exp: 1 });
      expect(game.profile.coins).toBe(before.coins + rent);
      w = await expectSynced(game, dbWorld, "collected");
      expect(w.mine!.items.find((i) => i.sid === sid)!.state.mode).toBe("1");

      // second build + sell round trip, a road and a destroyed terrain tile
      const second = game.autoBuild("houses_001_001")!;
      await expectSynced(game, dbWorld, "built2");
      expect(game.sellItem(second.sid)).toBe(true);
      w = await expectSynced(game, dbWorld, "sold");
      expect(w.mine!.items.find((i) => i.sid === second.sid)).toBeUndefined();
      after = game.items();
    }
    await apps.pop()?.stop();

    // reload on the same DB
    const { conn, dbWorld } = await startServer(dbPath);
    const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
    expect(game.tutorialSkipped).toBe(false);
    expect(game.items().map((i) => i.sid).sort()).toEqual(after.map((i) => i.sid).sort());
    expect(game.item(sid)).toMatchObject({ stateId: 1, mode: 1 });
    await expectSynced(game, dbWorld, "reloaded", false); // recomputed from the items at load (Profile.calculateCompanyValue)
  });

  it("construction and rent timers survive a reload (server savedAt catch-up)", async () => {
    const dbPath = tmpDb();
    let sid = "";
    let t0 = 0;
    {
      const { conn } = await startServer(dbPath);
      const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
      sid = game.autoBuild("houses_001_001")!.sid;
      await game.flush();
      t0 = game.item(sid)!.time;
      expect(t0).toBeGreaterThan(0);
    }
    await apps.pop()?.stop();
    await new Promise((r) => setTimeout(r, 2500));
    const { conn } = await startServer(dbPath);
    const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
    const t = game.item(sid)!;
    // exactly the ~2.5 s that elapsed offline (a double catch-up would remove ~5 s)
    expect(t.stateId).toBe(0);
    expect(t0 - t.time).toBeGreaterThan(2400);
    expect(t0 - t.time).toBeLessThan(3600);
  });

  it("terrain, roads, move and demolition keep the DB in sync", async () => {
    const { conn, dbWorld } = await startServer(tmpDb());
    const game = await Game.boot({ conn, defs, fetchText, skipTutorial: true });
    let spot = { x: 0, y: 0 };
    search: for (let y = 0; y < 60; y += 1) for (let x = 0; x < 90; x += 1) if (game.checkTerrain(x, y).ok) { spot = { x, y }; break search; }
    const price = game.terrainPrice;
    const coins0 = game.profile.coins;

    // terrain purchase
    expect(game.checkTerrain(spot.x, spot.y).ok).toBe(true);
    expect(game.buyTerrain(spot.x, spot.y)).toBe(true);
    expect(game.profile.coins).toBe(coins0 - price);
    let w = await expectSynced(game, dbWorld, "terrain");
    expect(w.terrain.length).toBeGreaterThan(0);

    // road on the owned terrain tile replaces it (refund) and persists
    expect(game.buildRoad(spot.x, spot.y)).toBe(true);
    expect(game.profile.coins).toBe(coins0);
    w = await expectSynced(game, dbWorld, "road");
    expect(w.roads.length).toBeGreaterThan(0);
    expect(game.destroyAt(spot.x, spot.y)).toBe(true);
    await expectSynced(game, dbWorld, "road removed");

    // move a house (movePriceCoins + time price) and demolish it
    const house = game.autoBuild("houses_001_001")!;
    const to = { x: house.tileX, y: house.tileY };
    const spot2 = game.findSpot("houses_001_001", to.x + 6, to.y)!;
    for (let dx = 0; dx < 2; dx += 1) for (let dy = 0; dy < 2; dy += 1) game.buyTerrain(spot2.x + dx, spot2.y + dy);
    const before = game.profile.coins;
    expect(game.moveItem(house.sid, spot2.x, spot2.y)).toBe(true);
    expect(game.profile.coins).toBeLessThan(before);
    w = await expectSynced(game, dbWorld, "moved");
    expect(w.mine!.items.find((i) => i.sid === house.sid)).toMatchObject({ x: spot2.x - 45, y: spot2.y - 30 });

    // sell refunds 35% of the company value
    const refund = game.sellPrice(game.item(house.sid)!);
    expect(refund).toBe(Math.trunc(defs.get("houses_001_001")!.rules.companyValue * 0.35));
    const c = game.profile.coins;
    game.sellItem(house.sid);
    expect(game.profile.coins).toBe(c + refund);
    await expectSynced(game, dbWorld, "demolished");
  });
});
