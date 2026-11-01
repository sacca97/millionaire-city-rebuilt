// Black-box port of the NPC neighbour tests of apps/server/test/server.test.ts.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { extractRoadTiles, getItemsOverlappingRoads, golden } from "./lib/util.js";

cleanupServersAfterEach();

describe("NPC neighbours", () => {
  test("returns distinct NPC neighbor worlds for the advisor city and Sheik city", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.login();
    await s.seed((db) => {
      db.editUniverse(({ profile }) => {
        profile.bossGenre = "1";
        profile.tutorialEnd = "1";
      });
      // a stale local row for NPC user 101 must never leak into the generated Sheik city
      db.insertUser(101, "stale-npc-sheik", "Stale Sheik");
      db.setDoc("universe", { universe: [{ Profile: [], cityname: "Stale Local Override" }, { World: [] }] }, 101);
    });

    const startup = (
      await c.cmdList([
        ["get_world", { targetUserId: 100 }],
        ["get_world", { targetUserId: 101 }]
      ])
    ).list;
    const advisorUniverse = startup[0]._dat.universe as Array<Record<string, any>>;
    const sheikUniverse = startup[1]._dat.universe as Array<Record<string, any>>;
    const advisorProfile = advisorUniverse.find((entry) => Array.isArray(entry.Profile)) as Record<string, any>;
    const sheikProfile = sheikUniverse.find((entry) => Array.isArray(entry.Profile)) as Record<string, any>;
    const advisorWorld = advisorUniverse.find((entry) => Array.isArray(entry.World)) as { World: Array<Record<string, any>> };
    const sheikWorld = sheikUniverse.find((entry) => Array.isArray(entry.World)) as { World: Array<Record<string, any>> };
    const advisorMine = advisorWorld.World.find((entry) => Array.isArray(entry.Company) && entry.whose === "0");
    const sheikMine = sheikWorld.World.find((entry) => Array.isArray(entry.Company) && entry.whose === "0");
    const sheikPlots = sheikProfile.Profile.find((entry: any) => Array.isArray(entry.Plots));
    const advisorPlots = advisorProfile.Profile.find((entry: any) => Array.isArray(entry.Plots));
    const advisorHq = advisorMine?.Company.find((entry: any) => entry.sku === "HeadQuarter");
    const sheikHq = sheikMine?.Company.find((entry: any) => entry.sku === "HeadQuarter");
    const advisorRoadTiles = extractRoadTiles(advisorWorld);
    const sheikRoadTiles = extractRoadTiles(sheikWorld);

    expect(advisorProfile.userName).toBe("Cindy");
    expect(advisorProfile.cityname).toBe("Chocolate Fields");
    expect(advisorProfile.planeSku).toBe("plane_03");
    expect(sheikProfile.cityname).toBe("Sheik&apos;s City");
    expect(advisorHq?.x).toBe("-1");
    expect(advisorHq?.y).toBe("-4");
    expect(sheikHq?.x).toBe("-1");
    expect(sheikHq?.y).toBe("-3");
    expect(advisorMine?.Company).toHaveLength(golden.ronaldLayoutItemCount);
    expect(sheikMine?.Company).toHaveLength(483);
    expect(advisorPlots?.type).toBe(golden.ronaldPlotsType);
    expect(sheikPlots?.type).toBe("0,2,2,2,0,1,2,2,2,1,1,2,2,2,1,1,2,2,2,1,0,2,2,2,0");
    expect(advisorMine?.Company.some((entry: any) => entry.sku === "wonder_npc_Ronald")).toBe(true);
    expect(sheikMine?.Company.some((entry: any) => entry.sku === "commerce_casino")).toBe(true);
    expect(getItemsOverlappingRoads(advisorMine?.Company ?? [], advisorRoadTiles)).toEqual([]);
    expect(getItemsOverlappingRoads(sheikMine?.Company ?? [], sheikRoadTiles)).toEqual([]);

    await s.seed((db) =>
      db.editUniverse(({ profile }) => {
        profile.bossGenre = "0";
      })
    );

    const ronaldUniverse = (await c.cmdList([["get_world", { targetUserId: 100 }]])).list[0]._dat.universe as Array<Record<string, any>>;
    const ronaldProfile = ronaldUniverse.find((entry) => Array.isArray(entry.Profile)) as Record<string, any>;
    const ronaldWorld = ronaldUniverse.find((entry) => Array.isArray(entry.World)) as { World: Array<Record<string, any>> };
    const ronaldMine = ronaldWorld.World.find((entry) => Array.isArray(entry.Company) && entry.whose === "0");
    const ronaldPlots = ronaldProfile.Profile.find((entry: any) => Array.isArray(entry.Plots));
    const ronaldHq = ronaldMine?.Company.find((entry: any) => entry.sku === "HeadQuarter");
    const ronaldRoadTiles = extractRoadTiles(ronaldWorld);

    expect(ronaldProfile.userName).toBe("Ronald");
    expect(ronaldProfile.cityname).toBe("Chocolate Fields");
    expect(ronaldProfile.planeSku).toBe("plane_03");
    expect(ronaldHq?.x).toBe("-1");
    expect(ronaldHq?.y).toBe("-4");
    expect(ronaldMine?.Company).toHaveLength(golden.ronaldLayoutItemCount);
    expect(ronaldPlots?.type).toBe(golden.ronaldPlotsType);
    expect(ronaldMine?.Company.some((entry: any) => entry.sku === "wonder_npc_Ronald")).toBe(true);
    expect(getItemsOverlappingRoads(ronaldMine?.Company ?? [], ronaldRoadTiles)).toEqual([]);
  });

  test("allows up to five daily visitor upgrades per NPC city and persists upgraded buildings", async () => {
    const s = await startServer({ noFacebookShim: true });
    const c = clientFor(s);
    await c.login();
    await s.seed((db) =>
      db.editUniverse(({ profile }) => {
        profile.bossGenre = "1";
        profile.tutorialEnd = "1";
      })
    );

    const initialUpgrades = (await c.cmdList([["get_upgrades_list", { userId: 101 }]])).list[0]._dat;
    expect(initialUpgrades.upgradesUniverseAvailable).toBe("5");
    expect(initialUpgrades.upgradesList).toEqual([]);

    await c.cmdList([
      ["add_upgrade_item", { visitorId: 1, ownerId: 101, sid: "2001", type: "0" }],
      ["add_upgrade_item", { visitorId: 1, ownerId: 101, sid: "4008", type: "0" }],
      ["add_upgrade_item", { visitorId: 1, ownerId: 101, sid: "4030", type: "0" }],
      ["add_upgrade_item", { visitorId: 1, ownerId: 101, sid: "2001", type: "0" }]
    ]);

    const upgraded = (await c.cmdList([["get_upgrades_list", { userId: 101 }]])).list[0]._dat;
    expect(upgraded.upgradesUniverseAvailable).toBe("2");
    expect((upgraded.upgradesList as Array<Record<string, unknown>>).map((entry) => entry.sid)).toEqual(["2001", "4008", "4030"]);
    expect((upgraded.upgradesList as Array<Record<string, unknown>>).every((entry) => entry.extId === s.uid)).toBe(true);
  });
});
