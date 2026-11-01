// Black-box port of the "persists ... across restarts" tests of apps/server/test/server.test.ts.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { itemBySid, newItemCmd, stateOf, worldOf } from "./lib/saves.js";

cleanupServersAfterEach();

describe("persistence", () => {
  test("persists save mutations across restarts", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.cmdList([
      ["update_profile", { action: "city_name", value: "Revival City" }],
      ["update_item", { action: "build", sid: "2", sku: "houses_001_002", x: 24, y: 20, state: 1 }],
      ["update_profile", { action: "tutorial_completed" }]
    ]);
    await s.restart();
    const c2 = clientFor(s);
    const world = await c2.world(1);
    const profile = world[0];
    const worldContainer = world.find((entry: any) => Array.isArray(entry.World));
    const mineCompany = worldContainer.World.find((entry: any) => Array.isArray(entry.Company) && entry.whose === "0");
    expect(profile.cityname).toBe("Revival City");
    expect(mineCompany.Company.some((item: { sid?: string }) => item.sid === "2")).toBe(true);
  });

  test("persists tutorial-style new_item payloads with their real coordinates", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.cmdList([
      ["update_map", { action: "add", type: "Terrain", x: 5, y: 2 }],
      ["update_map", { action: "add", type: "Terrain", x: 5, y: 3 }],
      newItemCmd("10", "HeadQuarter", "-1", "-3", { id: "4" }),
      newItemCmd("11", "houses_004_001", "5", "2", { id: "1", mode: "1", time: "0" }),
      ["update_profile", { action: "tutorial_completed" }]
    ]);
    await s.restart();
    const c2 = clientFor(s);
    const world = await c2.world(1);
    const profile = world[0];
    const worldContainer = world.find((entry: any) => Array.isArray(entry.World));
    const mineCompany = worldContainer.World.find((entry: any) => Array.isArray(entry.Company) && entry.whose === "0");
    const mineItems = mineCompany.Company.filter((item: any) => Array.isArray(item.Item));
    const headQuarter = mineItems.find((item: any) => item.sid === "10");
    const tutorialHouse = mineItems.find((item: any) => item.sid === "11");
    const tutorialHouseState = stateOf(tutorialHouse);
    const mapContainer = worldContainer.World.find((entry: any) => Array.isArray(entry.Map));
    const terrainChunk = mapContainer.Map.find((entry: any) => Array.isArray(entry.Terrain));

    expect(profile.tutorialEnd).toBe("1");
    expect(headQuarter?.sku).toBe("HeadQuarter");
    expect(headQuarter?.x).toBe("-1");
    expect(headQuarter?.y).toBe("-3");
    expect(tutorialHouse?.sku).toBe("houses_004_001");
    expect(tutorialHouse?.x).toBe("5");
    expect(tutorialHouse?.y).toBe("2");
    expect(tutorialHouseState?.id).toBe("1");
    expect(tutorialHouseState?.mode).toBe("1");
    expect(terrainChunk?.chunk).toContain("5:2");
    expect(terrainChunk?.chunk).toContain("5:3");
  });

  test("persists new item placement security gains across restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile }) => {
        Object.assign(profile, { tutorialEnd: "1", exp: "206", DCCash: "116", DCCoins: "500000", companyValue: "550000" });
      })
    );
    const c = clientFor(s);
    const commands: Array<[string, any]> = [];
    for (let index = 0; index < 5; index += 1) {
      const sid = String(7000 + index);
      commands.push([
        "update_item",
        {
          action: "new_item",
          sid,
          sku: "decorations_special_65",
          item: { Item: [{ State: [], id: "5" }], sid, csid: "1", sku: "decorations_special_65", x: String(index), y: "-1", isSuspended: "0" },
          security: {
            expGain: 550,
            expNow: 206 + (index + 1) * 550,
            coinsGain: 0,
            coinsNow: 500000,
            cashGain: -2,
            cashNow: 116 - (index + 1) * 2,
            compValueGain: 120000,
            compValueNow: 550000 + (index + 1) * 120000
          }
        }
      ]);
    }
    await c.cmdList(commands);
    await s.restart();
    const { profile, mine } = s.ctx();
    expect(profile.exp).toBe("2956");
    expect(profile.DCCash).toBe("106");
    expect(profile.companyValue).toBe("1150000");
    expect(mine.Company.filter((item: any) => item.sku === "decorations_special_65")).toHaveLength(5);
  });

  test("preserves item sku when update payload sends a blank embedded sku", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.cmdList([
      newItemCmd("5090", "decorations_tree_01", "12", "6", { id: "5" }),
      [
        "update_item",
        {
          action: "move",
          sid: "5090",
          item: { Item: [{ State: [], id: "5" }], sid: "5090", csid: "1", sku: "", x: "14", y: "9", isSuspended: "0" }
        }
      ]
    ]);
    const decoration = itemBySid(s.ctx().mine, "5090");
    expect(decoration?.sku).toBe("decorations_tree_01");
    expect(decoration?.x).toBe("14");
    expect(decoration?.y).toBe("9");
  });

  test("persists rented house contract state across restarts", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.cmdList([
      ["update_profile", { action: "tutorial_completed" }],
      newItemCmd("3001", "houses_001_002", "8", "6", { id: "1", mode: "1", time: "0" }),
      ["update_item", { action: "new_mode", sid: "3001", mode: 4, time: 28800000, contractSku: 5 }]
    ]);
    await s.restart();
    const c2 = clientFor(s);
    const { mine } = await worldOf(c2);
    const state = stateOf(itemBySid(mine, "3001"));
    expect(state?.id).toBe("1");
    expect(state?.mode).toBe("4");
    expect(Number(state?.time)).toBeGreaterThan(28_700_000);
    expect(Number(state?.time)).toBeLessThanOrEqual(28_800_000);
    expect(state?.contractSku).toBe("5");
    expect(Number(state?.savedAt)).toBeGreaterThan(0);
  });
});
