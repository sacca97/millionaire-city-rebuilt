// Black-box port of the rival-property, tutorial-bungalow and construction-timer tests of apps/server/test/server.test.ts.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { itemBySid, mkHq, mkItem, newItemCmd, stateOf, worldOf } from "./lib/saves.js";

cleanupServersAfterEach();

describe("rival properties and tutorial bungalow", () => {
  test("moves bought rival sale items into the player company", async () => {
    const s = await startServer({ noFacebookShim: true });
    await clientFor(s).cmdList([
      ["update_profile", { action: "tutorial_completed" }],
      ["update_item", { action: "new_mode", sid: "2002", csid: "1", mode: 4, time: 180000 }],
      ["update_item", { action: "new_state", sid: "2002", state: 1, mode: 4, time: 180000, contractSku: 19 }]
    ]);
    await s.restart();
    const { mine, rival } = await worldOf(clientFor(s));
    const mineBought = itemBySid(mine, "2002");
    const rivalBought = itemBySid(rival, "2002");
    const state = stateOf(mineBought);
    expect(mineBought?.csid).toBe("1");
    expect(state?.id).toBe("1");
    expect(state?.contractSku).toBe("19");
    expect(rivalBought).toBeUndefined();
  });

  test("does not reset completed saves after the rival starter properties are bought out", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine, rival }) => {
        profile.tutorialEnd = "1";
        profile.cityname = "Bought Out City";
        profile.cityNameCodes = "66,111,117,103,104,116,32,79,117,116,32,67,105,116,121";
        for (const item of rival?.Company ?? []) {
          if (!Array.isArray(item.Item)) continue;
          item.csid = String(mine.sid ?? "1");
          const state = stateOf(item);
          if (state) {
            state.id = "1";
            state.mode = "4";
            state.time = "180000";
            state.contractSku = "19";
            state.savedAt = String(Date.now());
          }
          mine.Company.push(item);
        }
        if (rival) rival.Company = [];
      })
    );
    const { profile, mine, rival } = await worldOf(clientFor(s));
    expect(profile.cityname).toBe("Bought Out City");
    expect(profile.tutorialEnd).toBe("1");
    expect(mine.Company.some((item: { sid?: string }) => item.sid === "2001")).toBe(true);
    expect(rival.Company).toHaveLength(0);
  });

  test("preserves tutorial bungalow contracts and unbought rival sale houses across restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        profile.firstMission = "1";
        mine.Company.push(
          mkItem("1003", "HeadQuarter", "-1", "-3", { id: "4" }),
          mkItem("1004", "houses_001_001", "4", "2", { id: "1", mode: "4", time: "180000", contractSku: "1", savedAt: String(Date.now()) }),
          mkItem("1005", "decorations_tree_01", "4", "1", { id: "5" })
        );
      })
    );
    const { mine, rival } = await worldOf(clientFor(s));
    const tutorialHouseState = stateOf(itemBySid(mine, "1004"));
    const rivalSaleItems = rival.Company.filter((item: { sid?: string }) => ["2002", "2003", "2004"].includes(String(item.sid ?? "")));
    expect(tutorialHouseState?.id).toBe("1");
    expect(tutorialHouseState?.mode).toBe("4");
    expect(tutorialHouseState?.contractSku).toBe("1");
    expect(rivalSaleItems).toHaveLength(3);
    for (const item of rivalSaleItems) {
      const state = stateOf(item);
      expect(state?.id).toBe("3");
      expect(state?.mode).toBe("2");
    }
  });

  test("merges the legacy duplicate tutorial bungalow back onto the tutorial tile", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        profile.firstMission = "1";
        mine.Company.push(
          mkItem("1003", "HeadQuarter", "-1", "-3", { id: "4" }),
          mkItem("1004", "houses_001_001", "4", "2", { id: "1", mode: "1", time: "0" }),
          mkItem("2006", "houses_001_001", "0", "0", { id: "1", mode: "4", time: "180000", contractSku: "1", savedAt: String(Date.now()) })
        );
      })
    );
    const { mine } = await worldOf(clientFor(s));
    const bungalows = mine.Company.filter((item: { sku?: string }) => item.sku === "houses_001_001");
    const tutorialBungalow = bungalows.find((item: { x?: string; y?: string }) => item.x === "4" && item.y === "2");
    const state = stateOf(tutorialBungalow);
    expect(bungalows).toHaveLength(1);
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("4");
    expect(state?.contractSku).toBe("1");
  });
});

describe("construction timers", () => {
  test("advances offline construction timers based on saved wall-clock time", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push(mkItem("3020", "houses_003_001", "9", "6", { id: "0", mode: "2", time: "600000", savedAt: String(Date.now() - 120_000) }));
      })
    );
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "3020"));
    expect(state?.id).toBe("0");
    expect(state?.mode).toBe("2");
    expect(Number(state?.time)).toBeGreaterThanOrEqual(470_000);
    expect(Number(state?.time)).toBeLessThanOrEqual(490_000);
    expect(Number(state?.savedAt)).toBeGreaterThan(Date.now() - 10_000);
  });

  test("keeps zero-time construction saves finished on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push(mkItem("3020", "HeadQuarter", "-1", "-3", { id: "4" }), mkItem("3021", "houses_001_001", "9", "6", { id: "0", mode: "2", time: "0" }));
      })
    );
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "3021"));
    expect(state?.id).toBe("0");
    expect(state?.mode).toBe("2");
    expect(state?.time).toBe("0");
    expect(state?.savedAt).toBeUndefined();
  });

  // Original: after the startup normalisation it calls normalizeCompletedTutorialUniverse() again on the stored document and
  // expects "no change". Black-box: a second restart must leave the stored construction state (and the whole universe) as is.
  test("does not reset offline-finished construction timers on repeated normalization", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.restartWith((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push(
          mkItem("3030", "HeadQuarter", "-1", "-3", { id: "4" }),
          mkItem("3031", "houses_001_001", "9", "6", { id: "0", mode: "2", time: "600000", savedAt: String(Date.now() - 900_000) })
        );
      })
    );
    // startup normalisation has been applied to the stored document (no request was needed)
    const first = s.doc("universe");
    const state = stateOf(itemBySid(s.ctx().mine, "3031"));
    expect(state?.id).toBe("0");
    expect(state?.mode).toBe("2");
    expect(state?.time).toBe("0");
    await s.restart();
    await clientFor(s).world(1);
    expect(s.doc("universe")).toEqual(first);
    expect(stateOf(itemBySid(s.ctx().mine, "3031"))?.time).toBe("0");
  });

  test("stamps savedAt for live construction item mutations", async () => {
    const s = await startServer({ noFacebookShim: true });
    await clientFor(s).cmdList([newItemCmd("3022", "houses_001_001", "9", "6", { id: "0", mode: "2", time: "600000" })]);
    const state = stateOf(itemBySid(s.ctx().mine, "3022"));
    expect(state?.id).toBe("0");
    expect(state?.mode).toBe("2");
    expect(state?.time).toBe("600000");
    expect(Number(state?.savedAt)).toBeGreaterThan(Date.now() - 10_000);
  });
});
