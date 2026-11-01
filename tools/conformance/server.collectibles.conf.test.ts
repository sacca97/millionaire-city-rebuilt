// Black-box port of the collectible tests of apps/server/test/server.test.ts.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { findCollectibleSavedAt } from "./lib/collectibles.js";
import { itemBySid, mkHq, mkItem, stateOf, worldOf } from "./lib/saves.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { hasArchivedAssetFiles } from "./lib/util.js";

cleanupServersAfterEach();
const archivedAssetTest = hasArchivedAssetFiles() ? test : test.skip;

const pendingOf = (doc: any) => doc.collectiblesList.find((e: any) => Array.isArray(e.Pending));
const objectsOf = (doc: any) => doc.collectiblesList.find((e: any) => Array.isArray(e.Objects));
const rewardsOf = (doc: any) => doc.collectiblesList.find((e: any) => Array.isArray(e.Rewards));

async function seedRentRunningHouse(s: Awaited<ReturnType<typeof startServer>>, opts: { level: string; hqSid: string; hqXY: [string, string]; sid: string; xy: [string, number | string]; savedAt: string }) {
  await s.seed((db) =>
    db.editUniverse(({ profile, mine }) => {
      profile.tutorialEnd = "1";
      profile.level = opts.level;
      mine.Company.push(mkItem(opts.hqSid, "HeadQuarter", opts.hqXY[0], opts.hqXY[1], { id: "4" }, String(mine.sid ?? "1")));
      mine.Company.push(mkItem(opts.sid, "houses_001_001", opts.xy[0], String(opts.xy[1]), { id: "1", mode: "4", time: "1800000", contractSku: "1", savedAt: opts.savedAt }, String(mine.sid ?? "1")));
    })
  );
}

describe("house collectibles", () => {
  archivedAssetTest("awards a pending house collectible when an eligible level-6 house becomes rent-ready", async () => {
    const s = await startServer({ noFacebookShim: true });
    const savedAt = findCollectibleSavedAt("9020", "houses_001_001", "1", true);
    await seedRentRunningHouse(s, { level: "6", hqSid: "9900", hqXY: ["1", "1"], sid: "9020", xy: ["12", 8], savedAt });
    const c = clientFor(s);
    const commands = (await c.cmdList([["update_item", { action: "new_mode", sid: "9020", mode: 5, time: 0, contractSku: 1 }]])).list;
    expect(commands).toHaveLength(2);
    expect(commands[0]._cmd).toBe("update_item");
    expect(commands[1]._cmd).toBe("update_item");
    expect(commands[1]._dat.action).toBe("give_collectible");
    expect(commands[1]._dat.sid).toBe("9020");
    expect(String(commands[1]._dat.sku)).toMatch(/^gift_/);
    const collectiblesList = (await c.cmdList([["get_collectibles_list", {}]])).list[0]._dat;
    const pendingEntry = pendingOf(collectiblesList);
    expect(pendingEntry?.tupla).toContain(`9020:${commands[1]._dat.sku}`);
  });

  test("does not award a house collectible before the level-6 unlock", async () => {
    const s = await startServer({ noFacebookShim: true });
    const savedAt = findCollectibleSavedAt("9023", "houses_001_001", "1", true);
    await seedRentRunningHouse(s, { level: "5", hqSid: "9901", hqXY: ["1", "1"], sid: "9023", xy: ["14", 8], savedAt });
    const commands = (await clientFor(s).cmdList([["update_item", { action: "new_mode", sid: "9023", mode: 5, time: 0, contractSku: 1 }]])).list;
    expect(commands).toHaveLength(1);
    expect(commands[0]._cmd).toBe("update_item");
    expect(commands[0]._dat.action).toBe("new_mode");
    expect(pendingOf(s.doc("collectiblesList"))?.tupla ?? "").not.toContain("9023:");
  });

  test("does not award a collectible on every completed house contract", async () => {
    const s = await startServer({ noFacebookShim: true });
    const savedAt = findCollectibleSavedAt("9024", "houses_001_001", "1", false);
    await seedRentRunningHouse(s, { level: "6", hqSid: "9902", hqXY: ["1", "1"], sid: "9024", xy: ["15", 8], savedAt });
    const commands = (await clientFor(s).cmdList([["update_item", { action: "new_mode", sid: "9024", mode: 5, time: 0, contractSku: 1 }]])).list;
    expect(commands).toHaveLength(1);
    expect(commands[0]._cmd).toBe("update_item");
    expect(commands[0]._dat.action).toBe("new_mode");
    expect(pendingOf(s.doc("collectiblesList"))?.tupla ?? "").not.toContain("9024:");
  });

  test("keeps a collected house collectible and clears it from the pending list", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) => db.editDoc("collectiblesList", (doc: any) => void (pendingOf(doc).tupla = "3021:gift_025")));
    await clientFor(s).cmdList([["update_collectible", { action: "KEEP", sid: "3021", sku: "gift_025" }]]);
    let doc = s.doc("collectiblesList");
    expect(objectsOf(doc)?.skus).toContain("gift_025");
    expect(pendingOf(doc)?.tupla ?? "").not.toContain("3021:gift_025");
    await s.restart();
    doc = s.doc("collectiblesList");
    expect(objectsOf(doc)?.skus).toContain("gift_025");
    expect(pendingOf(doc)?.tupla ?? "").not.toContain("3021:gift_025");
  });

  test("projects pending house collectibles back into the world on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) => {
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        profile.level = "6";
        mine.Company.push(mkItem("9903", "HeadQuarter", "1", "1", { id: "4" }, String(mine.sid ?? "1")));
        mine.Company.push(mkItem("9022", "houses_001_001", "13", "8", { id: "1", mode: "1", time: "0" }, String(mine.sid ?? "1")));
      });
      db.editDoc("collectiblesList", (doc: any) => void (pendingOf(doc).tupla = "9022:gift_025"));
    });
    await s.restart();
    const { mine } = await worldOf(clientFor(s));
    const state = stateOf(itemBySid(mine, "9022"));
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("14");
    expect(state?.time).toBe("0");
  });
});

describe("collectible claims", () => {
  test("persists bought collectible pieces across restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile }) => {
        profile.tutorialEnd = "1";
        profile.DCCash = "100";
      })
    );
    await clientFor(s).cmdList([["update_collectible", { action: "BUY", sid: "-1", sku: "gift_057", security: { cashGain: -3, cashNow: 97 } }]]);
    await s.restart();
    expect(objectsOf(s.doc("collectiblesList"))?.skus).toContain("gift_057");
    expect(s.profile().DCCash).toBe("97");
  });

  archivedAssetTest("persists collectible plane rewards to the profile plane", async () => {
    const s = await startServer({ noFacebookShim: true });
    await clientFor(s).cmdList([["update_collectible", { action: "GET_REWARD", sku: "2" }]]);
    expect(s.profile().planeSku).toBe("plane_02");
    expect(rewardsOf(s.doc("collectiblesList"))?.skus).toContain("2");
  });

  archivedAssetTest("persists collectible HQ skin rewards to the saved headquarters", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        mine.Company.push({
          Item: [
            { State: [], id: "4" },
            {
              Decorations: [
                {
                  Decoration: [
                    { sku: [], id: "HeadQuarter_01" },
                    { sku: [], id: "HeadQuarter_02" },
                    { sku: [], id: "HeadQuarter_03" },
                    { sku: [], id: "HeadQuarter_04" }
                  ],
                  type: "0",
                  currentSku: "HeadQuarter_01",
                  shadowRows: "0"
                }
              ]
            }
          ],
          sid: "9904",
          csid: String(mine.sid ?? "1"),
          sku: "HeadQuarter",
          x: "1",
          y: "1",
          isSuspended: "0"
        });
      })
    );
    await clientFor(s).cmdList([["update_collectible", { action: "GET_REWARD", sku: "1" }]]);
    await s.restart();
    const hq = itemBySid(s.ctx().mine, "9904");
    const decorations = hq?.Item?.find((entry: any) => Array.isArray(entry.Decorations));
    const skin = decorations?.Decorations?.find((entry: any) => Array.isArray(entry.Decoration));
    expect(skin?.currentSku).toBe("HeadQuarter_02");
    expect(skin?.shadowRows).toBe("1");
    expect(rewardsOf(s.doc("collectiblesList"))?.skus).toContain("1");
  });

  archivedAssetTest("persists item collectible reward claims from reward placement", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) => {
      db.editUniverse(({ profile }) => void (profile.tutorialEnd = "1"));
      db.editDoc("collectiblesList", (doc: any) => void (objectsOf(doc).skus = "gift_057,gift_058,gift_059,gift_060"));
    });
    await clientFor(s).cmdList([
      [
        "update_item",
        {
          action: "new_item",
          sid: "8801",
          collectible: "15",
          item: { Item: [{ State: [], id: "5" }], sid: "8801", csid: "1", sku: "houses_037_001", x: "4", y: "5", isSuspended: "0" },
          dec: "0"
        }
      ]
    ]);
    await s.restart();
    const doc = s.doc("collectiblesList");
    expect(rewardsOf(doc)?.skus).toContain("15");
    expect(objectsOf(doc)?.skus).toContain("gift_057");
    expect(s.ctx().mine.Company.some((entry: any) => entry.sid === "8801" && entry.sku === "houses_037_001")).toBe(true);
    void mkHq;
  });
});
