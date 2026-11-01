// Black-box port of the house-rent timer tests of apps/server/test/server.test.ts: seed a save with stored wall-clock
// timestamps (savedAt) through the DB file, restart, and read the world over HTTP.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { itemBySid, mkHq, mkItem, stateOf, worldOf } from "./lib/saves.js";

cleanupServersAfterEach();

describe("house rent state", () => {
  test("does not resurrect collected house rent after restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        profile.level = "6";
        mine.Company.push(mkItem("3011", "houses_001_001", "8", "6", { id: "1", mode: "5", time: "0", contractSku: "1", savedAt: String(Date.now() - 10_000) }, String(mine.sid ?? "1")));
      })
    );
    const c = clientFor(s);
    await c.cmdList([["update_item", { action: "new_mode", sid: "3011", mode: 1, time: 0, contractSku: 1 }]]);
    await s.restart();
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "3011"));
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("1");
    expect(state?.time).toBe("0");
    expect(state?.contractSku).toBeUndefined();
    expect(state?.savedAt).toBeUndefined();
  });

  test("persists the original late-collection countdown when a house becomes rent-ready", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push(mkHq("3020"));
        mine.Company.push(mkItem("3013", "houses_001_001", "10", "6", { id: "1", mode: "4", time: "180000", contractSku: "1", savedAt: String(Date.now()) }));
      })
    );
    await clientFor(s).cmdList([["update_item", { action: "new_mode", sid: "3013", mode: 5, time: 0, contractSku: 1 }]]);
    await s.restart();
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "3013"));
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("5");
    expect(Number(state?.time)).toBeGreaterThan(3_500_000);
    expect(Number(state?.time)).toBeLessThanOrEqual(3_600_000);
    expect(Number(state?.savedAt)).toBeGreaterThan(Date.now() - 10_000);
  });

  test("marks overdue ready rent as abandoned after the original grace period", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push(mkHq("3020"));
        mine.Company.push(mkItem("3014", "houses_001_001", "11", "6", { id: "1", mode: "4", time: "180000", contractSku: "1", savedAt: String(Date.now() - 4_000_000) }));
      })
    );
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "3014"));
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("7");
    expect(state?.time).toBe("0");
    expect(state?.contractSku).toBe("1");
  });

  test("collapses unsupported house collectible states back to waiting for contract on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push(mkHq("3020"));
        mine.Company.push(mkItem("3012", "houses_001_001", "9", "6", { id: "1", mode: "14", time: "0", contractSku: "1", savedAt: String(Date.now() - 10_000) }));
      })
    );
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "3012"));
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("1");
    expect(state?.time).toBe("0");
    expect(state?.contractSku).toBeUndefined();
  });

  test("advances offline house contract timers based on saved wall-clock time", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push(mkItem("3010", "houses_001_001", "8", "6", { id: "1", mode: "4", time: "600000", contractSku: "2", savedAt: String(Date.now() - 120_000) }));
      })
    );
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "3010"));
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("4");
    expect(Number(state?.time)).toBeGreaterThanOrEqual(470_000);
    expect(Number(state?.time)).toBeLessThanOrEqual(490_000);
    expect(Number(state?.savedAt)).toBeGreaterThan(Date.now() - 10_000);
  });
});
