// Black-box port of the incomplete/broken tutorial save tests of apps/server/test/server.test.ts.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { cleanupServersAfterEach, startServer } from "./lib/server.js";
import { itemBySid, missionLists, mkItem, stateOf, worldOf } from "./lib/saves.js";
import { golden } from "./lib/util.js";

cleanupServersAfterEach();

describe("tutorial saves", () => {
  test("resets incomplete tutorial progress on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await clientFor(s).cmdList([
      ["update_profile", { action: "city_name", value: "Broken Tutorial Save" }],
      ["update_item", { action: "build", sid: "99", sku: "HeadQuarter", x: 1, y: -4, state: 4 }]
    ]);
    await s.restart();
    const world = await clientFor(s).world(1);
    const profile = world[0];
    const worldContainer = world.find((entry: any) => Array.isArray(entry.World));
    const mineCompany = worldContainer.World.find((entry: any) => Array.isArray(entry.Company) && entry.whose === "0");
    const mineItems = mineCompany?.Company.filter((item: any) => Array.isArray(item.Item)) ?? [];
    expect(profile.cityname).toBe("Chocolate Fields");
    expect(profile.tutorialEnd).toBe("0");
    expect(mineItems.map((item: any) => item.sku)).toEqual(golden.starterDecorationSkus);
    expect(mineItems.some((item: any) => item.sku === "HeadQuarter")).toBe(false);
  });

  test("removes tutorial-placed map tiles and cypress tree from incomplete tutorial saves on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ mine, worldContainer }) => {
        const mapContainer = worldContainer.World.find((entry: any) => Array.isArray(entry.Map));
        const terrain = mapContainer.Map.find((entry: any) => Array.isArray(entry.Terrain));
        const road = mapContainer.Map.find((entry: any) => Array.isArray(entry.Road));
        const terrainTiles = new Set<string>(String(terrain.chunk ?? "").split(",").filter((tile) => tile.length > 0));
        const roadTiles = new Set<string>(String(road.chunk ?? "").split(",").filter((tile) => tile.length > 0));
        terrainTiles.add("5:2");
        terrainTiles.add("5:3");
        roadTiles.add("3:4");
        roadTiles.add("4:4");
        terrain.chunk = Array.from(terrainTiles).join(",");
        road.chunk = Array.from(roadTiles).join(",");
        mine.Company.push(mkItem("5098", "decorations_tree_01", "4", "1", { id: "5" }, String(mine.sid ?? "1")));
      })
    );
    await s.restart();
    const { profile, mine, worldContainer } = s.ctx();
    const mapContainer = worldContainer.World.find((entry: any) => Array.isArray(entry.Map));
    const terrain = mapContainer.Map.find((entry: any) => Array.isArray(entry.Terrain));
    const road = mapContainer.Map.find((entry: any) => Array.isArray(entry.Road));
    const terrainTiles = new Set<string>(String(terrain.chunk ?? "").split(",").filter((tile) => tile.length > 0));
    const roadTiles = new Set<string>(String(road.chunk ?? "").split(",").filter((tile) => tile.length > 0));
    expect(profile.tutorialEnd).toBe("0");
    expect(terrainTiles.has("4:2")).toBe(true);
    expect(terrainTiles.has("4:3")).toBe(true);
    expect(terrainTiles.has("5:2")).toBe(false);
    expect(terrainTiles.has("5:3")).toBe(false);
    expect(roadTiles.has("3:4")).toBe(false);
    expect(roadTiles.has("4:4")).toBe(false);
    expect(mine.Company.some((item: any) => item.sid === "5098" && item.sku === "decorations_tree_01")).toBe(false);
  });

  test("preserves decoration-only incomplete tutorial saves on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.cityname = "Decor Test";
        mine.Company.push(mkItem("5099", "decorations_tree_01", "4", "5", { id: "5" }, String(mine.sid ?? "1")));
      })
    );
    await s.restart();
    const { profile, mine } = s.ctx();
    expect(profile.cityname).toBe("Decor Test");
    expect(profile.tutorialEnd).toBe("0");
    expect(mine.Company.some((item: any) => item.sid === "5099" && item.sku === "decorations_tree_01")).toBe(true);
  });

  test("repairs broken completed tutorial saves on restart", async () => {
    const s = await startServer({ noFacebookShim: true });
    await s.seed((db) =>
      db.editUniverse(({ profile, mine }) => {
        profile.tutorialEnd = "1";
        delete profile.bossGenre;
        profile.DCCash = "50";
        profile.companyValue = "550000";
        const csid = String(mine?.sid ?? "1");
        mine.Company.push(
          mkItem("2006", "houses_001_001", "0", "0", { id: "5", mode: "1", time: "0" }, csid),
          mkItem("2007", "decorations_tree_01", "4", "1", { id: "5" }, csid),
          mkItem("2008", "houses_001_002", "8", "6", { id: "5", mode: "4", time: "28800000", contractSku: "2" }, csid)
        );
      })
    );
    await s.restart();
    const world = await clientFor(s).world(1);
    const repairedProfile = world[0];
    const repairedWorldContainer = world.find((entry: any) => Array.isArray(entry.World));
    const repairedMineCompany = repairedWorldContainer.World.find((entry: any) => Array.isArray(entry.Company) && entry.whose === "0");
    const repairedMineItems = repairedMineCompany?.Company.filter((item: any) => Array.isArray(item.Item)) ?? [];
    const repairedMap = repairedWorldContainer.World.find((entry: any) => Array.isArray(entry.Map));
    const repairedTerrain = repairedMap.Map.find((entry: any) => Array.isArray(entry.Terrain));
    const repairedRoad = repairedMap.Map.find((entry: any) => Array.isArray(entry.Road));
    const repairedHq = repairedMineItems.find((item: any) => item.sku === "HeadQuarter");
    const repairedHouse = repairedMineItems.find((item: any) => item.sku === "houses_001_001");
    const repairedBrokenRentHouse = repairedMineItems.find((item: any) => item.sid === "2008");
    const repairedBrokenRentState = stateOf(repairedBrokenRentHouse);
    const repairedUp = missionLists(repairedProfile).up;
    const repairedCount = missionLists(repairedProfile).count;
    expect(repairedProfile.tutorialEnd).toBe("1");
    expect(repairedProfile.bossGenre).toBe("0");
    expect(repairedProfile.DCCash).toBe("0");
    expect(repairedProfile.firstMission).toBe("1");
    expect(repairedHq?.x).toBe("-1");
    expect(repairedHq?.y).toBe("-3");
    expect(repairedHouse?.x).toBe("4");
    expect(repairedHouse?.y).toBe("2");
    expect(repairedTerrain?.chunk).toContain("5:2");
    expect(repairedTerrain?.chunk).toContain("5:3");
    expect(repairedRoad?.chunk).toContain("3:4");
    expect(repairedRoad?.chunk).toContain("4:4");
    // GamePlay.java:1346: the server no longer seeds/rewrites the Up list.
    expect(repairedUp?.chunk).toBe("");
    expect(repairedCount?.chunk).toBe("");
    expect(stateOf(repairedHouse)?.id).toBe("1");
    expect(stateOf(repairedHouse)?.mode).toBe("1");
    expect(stateOf(repairedHouse)?.time).toBe("0");
    expect(repairedBrokenRentState?.id).toBe("1");
    expect(repairedBrokenRentState?.mode).toBe("4");
    expect(Number(repairedBrokenRentState?.time)).toBeGreaterThan(28_700_000);
    expect(Number(repairedBrokenRentState?.time)).toBeLessThanOrEqual(28_800_000);
    expect(repairedBrokenRentState?.contractSku).toBe("2");
  });
});

void itemBySid; void worldOf;
