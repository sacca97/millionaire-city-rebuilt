// Round-trips our command builders through the real server (CommandService + sqlite) over HTTP.
// Uses a temp sqlite file; never touches tmp/dev.sqlite.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GameCommands, type ProfileSnapshot } from "../src/net/commands";
import { GameConnection } from "../src/net/protocol";
import { CommandQueue } from "../src/net/session";
import { parseWorld, type WorldState } from "../src/model/save";
import { createServerApp } from "../../server/src/serverApp";
import { getServerConfig } from "../../server/src/config";

const apps: Array<ReturnType<typeof createServerApp>> = [];
afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.stop();
  }
});

async function boot(dbPath: string) {
  const config = { ...getServerConfig(), dbPath, useHttpsFacebookShim: false, httpPort: 0, httpsPort: 0 };
  const app = createServerApp(config);
  apps.push(app);
  await app.start();
  const conn = new GameConnection({ baseUrl: `http://127.0.0.1:${config.httpPort}`, uid: config.launcherUserId });
  await conn.login();
  const world = async (): Promise<WorldState> => parseWorld((await conn.query("get_world", { targetUserId: 1 }))!._dat);
  return { app, conn, world };
}

function session(conn: GameConnection, w: WorldState) {
  const profile: ProfileSnapshot = {
    exp: w.profile.exp,
    DCCoins: Number(w.profile.raw.DCCoins),
    DCCash: w.profile.cash,
    companyValue: Number(w.profile.raw.companyValue ?? 0)
  };
  const t0 = Date.now();
  const gc = new GameCommands({ profile: () => profile, millisSinceLogin: () => Date.now() - t0 });
  gc.security.init();
  const queue = new CommandQueue(conn);
  queue.markLoggedIn(conn.loginSync);
  return { profile, gc, queue };
}

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcity-cmd-")), "save.sqlite");
const SKU = "houses_001_002";

describe("command layer against the real server", () => {
  it("place -> construct -> sign contract -> collect rent -> persist across restart", async () => {
    const dbPath = tmpDb();
    let sid = "";
    let coinsAfter = 0;
    {
      const { conn, world } = await boot(dbPath);
      const w0 = await world();
      const mine = w0.mine!;
      sid = String(900 + w0.companies.reduce((n, c) => n + c.items.length, 0));
      const { profile, gc, queue } = session(conn, w0);
      const g0 = { exp: 0, coins: 0, cash: 0 };

      // place (build cost 1000 coins -> reflected through securityUpdate())
      // the server serves a tutorial-stage world until tutorial_completed has been persisted
      queue.sendCommand(gc.tutorialCompleted());
      queue.sendCommand(gc.addTerrain(20, 20, 0, true));
      profile.DCCoins -= 1000; // the server applies the reported GAIN (SecurityNormal.verify), so the spend must follow the baseline snapshot
      queue.sendCommand(
        gc.newItem({ sid, csid: mine.sid, sku: SKU, x: 20, y: 20, state: { id: 0, mode: 1, time: 1000 }, dec: "f1" })
      );
      await queue.drain();
      let w = await world();
      let item = w.mine!.items.find((i) => i.sid === sid);
      expect(item).toMatchObject({ sku: SKU, x: 20, y: 20, stateId: 0 });
      expect(Number(w.profile.raw.DCCoins)).toBe(profile.DCCoins);
      expect(w.terrain).toContainEqual([20, 20]);

      // construction finished
      queue.sendCommand(gc.finishConstruction(sid, SKU));
      // sign contract (post tutorial)
      queue.sendCommand(
        gc.signContract(sid, SKU, { contractSku: 5, incomeTimeMs: 28800000, contractGroupSku: "g", tutorialEnd: true }, g0)
      );
      await queue.drain();
      w = await world();
      item = w.mine!.items.find((i) => i.sid === sid);
      expect(item?.stateId).toBe(1);
      expect(item?.state.mode).toBe("4");
      expect(item?.state.contractSku).toBe("5");

      // collect rent: +300 coins, +5 exp, reflected in the security snapshot
      profile.DCCoins += 300;
      profile.exp += 5;
      queue.sendCommand(gc.collectRent(sid, SKU, { time: 0, contractSku: 5 }, { exp: 5, coins: 300, cash: 0 }));
      await queue.drain();
      w = await world();
      expect(Number(w.profile.raw.DCCoins)).toBe(profile.DCCoins);
      expect(w.profile.exp).toBe(profile.exp);
      coinsAfter = profile.DCCoins;
      await conn.query("ping");
    }
    await apps.pop()?.stop();

    // restart on the same DB: state persisted
    const { world } = await boot(dbPath);
    const w = await world();
    const item = w.mine!.items.find((i) => i.sid === sid);
    expect(item).toBeTruthy();
    expect(item?.sku).toBe(SKU);
    expect(Number(w.profile.raw.DCCoins)).toBe(coinsAfter);
  });

  it("move, sell, roads, plots, profile, poll and missions persist", async () => {
    const { app, conn, world } = await boot(tmpDb());
    const w0 = await world();
    const { profile, gc, queue } = session(conn, w0);
    const sid = "950";
    const mineSid = w0.mine!.sid;

    queue.sendCommand(gc.newItem({ sid, csid: mineSid, sku: SKU, x: 30, y: 30, state: { id: 1, mode: 1, time: 0 }, dec: "f1" }));
    queue.sendCommand(gc.move(sid, 31, 32, "f1"));
    queue.sendCommand(gc.addRoad(33, 33));
    queue.sendCommand(gc.addRoad(34, 33));
    queue.sendCommand(gc.delRoad(34, 33));
    queue.sendCommand(gc.cityName("Newtown"));
    queue.sendCommand(gc.poll("add", "BUILD", "houses"));
    queue.sendCommand(gc.poll("update", "LEVEL", "", "7"));
    queue.sendCommand(gc.tutorialCompleted());
    queue.sendCommand(gc.bossGenre(1));
    profile.DCCash -= 0;
    await queue.drain();

    let w = await world();
    expect(w.mine!.items.find((i) => i.sid === sid)).toMatchObject({ x: 31, y: 32 });
    expect(w.roads).toContainEqual([33, 33]);
    expect(w.roads).not.toContainEqual([34, 33]);
    expect(w.profile.cityName).toBe("Newtown");
    expect(w.profile.raw.bossGenre).toBe("1");

    const universe = JSON.stringify(app.repository.getDocument(1, "universe"));
    expect(universe).toContain("BUILDhouses/1");
    expect(universe).toContain("LEVEL/7");

    // sell: refund shows up as a coin gain
    profile.DCCoins += 400;
    queue.sendCommand(gc.destroy(sid, "f1"));
    await queue.drain();
    w = await world();
    expect(w.mine!.items.find((i) => i.sid === sid)).toBeUndefined();
    expect(Number(w.profile.raw.DCCoins)).toBe(profile.DCCoins);

    // money snapshot only (update_money)
    profile.DCCoins -= 123;
    queue.sendCommand(gc.money("exchange", { value: 1 }));
    await queue.drain();
    w = await world();
    expect(Number(w.profile.raw.DCCoins)).toBe(profile.DCCoins);
  });
});
