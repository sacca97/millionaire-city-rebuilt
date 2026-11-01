// End-to-end core loop: Game controller -> CommandQueue -> real server (temp sqlite) -> reload.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Game } from "../src/game/game";
import { parseWorld, type WorldState } from "../src/model/save";
import { GameConnection } from "../src/net/protocol";
import { setDocument, startTestServer, type TestServer } from "./rustServer";
import { fetchText, loadDefsSync } from "./helpers";

const apps: TestServer[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.stop();
});

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcity-game-")), "save.sqlite");

async function startServer(dbPath: string) {
  const app = await startTestServer(dbPath);
  apps.push(app);
  const conn = new GameConnection({ baseUrl: app.baseUrl, uid: app.uid });
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
      // the info box shows the raw contract income (InfoBoxContract.as:63), the payout below still includes influence
      expect(opts[0]).toMatchObject({ sku: 1, cost: 90, income: 350 });
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

/** Finds the player's company element (whose="0") in the stored universe and returns its child list. */
function myCompanyChildren(node: unknown): unknown[] | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = myCompanyChildren(child);
      if (found) return found;
    }
    return undefined;
  }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (Array.isArray(o.Company) && String(o.whose) === "0") return o.Company;
    for (const value of Object.values(o)) {
      const found = myCompanyChildren(value);
      if (found) return found;
    }
  }
  return undefined;
}

describe("save with an item whose definition is not served", () => {
  // Game.boot (game.ts) keeps such an item in the save untouched, does not simulate it and warns (pre-fix: Economy.nodeOf crash).
  it("boots, keeps the item in the save, does not simulate it and carries it through later saves and a reload", async () => {
    const UNKNOWN = "houses_015_001_bavarian"; // expired limited edition
    const SID = "900001";
    // The bundled XML still lists the expired edition, the served table (what the client gets) does not.
    expect(defs.has(UNKNOWN)).toBe(true);
    const served = new Map([...defs].filter(([sku]) => sku !== UNKNOWN));
    const dbPath = tmpDb();

    // First run: complete the tutorial (tutorial_completed would otherwise reset a save with houses), then inject the item.
    {
      const { app, conn } = await startServer(dbPath);
      await Game.boot({ conn, defs: served, fetchText, skipTutorial: true });
      const universe = app.getDocument("universe");
      const children = myCompanyChildren(universe);
      expect(children).toBeDefined();
      children!.push({
        Item: [{ State: [], id: "1", mode: "4", contractSku: "1" }],
        sid: SID,
        sku: UNKNOWN,
        x: "10",
        y: "10",
        isSuspended: "0"
      });
      // the server caches documents: stop it, then write the file
      await apps.pop()?.stop();
      setDocument(dbPath, "universe", universe);
    }

    // Boot under test: no crash, one warning, the item is not simulated.
    const { conn, dbWorld } = await startServer(dbPath);
    const stored = (await dbWorld()).mine!.items.find((i) => i.sid === SID);
    expect(stored).toMatchObject({ sku: UNKNOWN, stateId: 1 });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let game: Game;
    let warnings: string[];
    try {
      game = await Game.boot({ conn, defs: served, fetchText, skipTutorial: true });
    } finally {
      warnings = warn.mock.calls.map((call) => String(call[0])); // read before restore, which clears the calls
      warn.mockRestore();
    }
    expect(warnings.filter((w) => w.includes(UNKNOWN))).toHaveLength(1);
    expect(game.item(SID)).toBeUndefined();
    expect(game.items().map((i) => i.sid)).not.toContain(SID);

    // No income or simulation: a long tick leaves the money and experience unchanged. The boot's packet is sent first, so
    // the one-call 3-day tick does not expire the session's no-response timer while it is in flight.
    await game.flush();
    const before = game.profile;
    game.tick(3 * 86_400_000);
    expect(game.profile.coins).toBe(before.coins);
    expect(game.profile.exp).toBe(before.exp);
    expect(game.profile.cash).toBe(before.cash);
    expect(game.item(SID)).toBeUndefined();

    // A normal action and its save leave the unknown item in the save exactly as it was.
    const built = game.autoBuild("houses_001_001");
    expect(built).toBeTruthy();
    await game.flush();
    const afterSave = await dbWorld();
    expect(afterSave.mine!.items.find((i) => i.sid === SID)).toEqual(stored);
    expect(afterSave.mine!.items.find((i) => i.sid === built!.sid)).toMatchObject({ sku: "houses_001_001" });

    // A reload keeps it too.
    await apps.pop()?.stop();
    const again = await startServer(dbPath);
    const warnAgain = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let reloaded: Game;
    try {
      reloaded = await Game.boot({ conn: again.conn, defs: served, fetchText, skipTutorial: true });
    } finally {
      warnAgain.mockRestore();
    }
    expect(reloaded!.item(SID)).toBeUndefined();
    expect((await again.dbWorld()).mine!.items.find((i) => i.sid === SID)).toEqual(stored);
  });
});
