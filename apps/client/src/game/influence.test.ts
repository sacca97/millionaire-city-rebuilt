import { describe, expect, it } from "vitest";
import {
  affectedHouses,
  buildInfluenceIndex,
  commercePopulation,
  disconnectedItems,
  houseInfluencePercent,
  influenceRect,
  roadTilesAround,
  roadsReachableFromHQ,
  type InfluenceNode
} from "./influence";

const node = (o: Partial<InfluenceNode> & { sid: string }): InfluenceNode => ({ type: 0, isHQ: false, x: 0, y: 0, cols: 1, rows: 1, ratio: 0, value: 0, ...o });
const COLS = 40;
const ROWS = 30;
const roadSet = (tiles: Array<[number, number]>): Set<number> => new Set(tiles.map(([x, y]) => y * COLS + x));

describe("influence areas (ItemObject.influenceLoopNeighbours)", () => {
  it("extends the footprint by the ratio on every side", () => {
    expect(influenceRect({ x: 10, y: 10, cols: 3, rows: 2, ratio: 2 })).toEqual({ x0: 8, y0: 8, x1: 15, y1: 14 });
  });

  it("relates a decoration to the houses whose footprint touches its area, each once, never the HQ", () => {
    const tree = node({ sid: "t", type: 2, x: 10, y: 10, ratio: 2, value: 5 });
    const near = node({ sid: "h1", x: 12, y: 10, cols: 2, rows: 2 }); // x 12..13 inside [8,13)
    const edge = node({ sid: "h2", x: 13, y: 10 }); // x=13 is outside
    const hq = node({ sid: "hq", isHQ: true, x: 10, y: 12, cols: 4, rows: 3 });
    const idx = buildInfluenceIndex([tree, near, edge, hq]);
    expect(idx.covers.get("t")).toEqual(["h1"]);
    expect(idx.coveredBy.get("h1")).toEqual(["t"]);
    expect(idx.coveredBy.has("h2")).toBe(false);
  });

  it("house influence = sum of decoration percents + wonder bonus; commerces/clubs add none", () => {
    const nodes = [
      node({ sid: "d1", type: 2, x: 5, y: 5, ratio: 3, value: 4 }),
      node({ sid: "d2", type: 2, x: 7, y: 5, ratio: 3, value: -1 }),
      node({ sid: "c", type: 1, x: 5, y: 8, cols: 3, rows: 3, ratio: 3 }),
      node({ sid: "h", x: 6, y: 6 })
    ];
    const bySid = new Map(nodes.map((n) => [n.sid, n]));
    const idx = buildInfluenceIndex(nodes);
    expect(houseInfluencePercent("h", idx, bySid, 0)).toBe(3);
    expect(houseInfluencePercent("h", idx, bySid, 7)).toBe(10);
  });

  it("commerce population sums the tenants of the renting, connected houses in its area", () => {
    const nodes = [node({ sid: "c", type: 1, x: 10, y: 10, cols: 3, rows: 3, ratio: 2 }), node({ sid: "a", x: 9, y: 9 }), node({ sid: "b", x: 14, y: 10 }), node({ sid: "far", x: 30, y: 30 })];
    const idx = buildInfluenceIndex(nodes);
    const live = new Set(["a", "b", "far"]);
    const src = { isAffecting: (s: string) => live.has(s), housePopulation: (s: string) => ({ a: 10, b: 20, far: 99 })[s] ?? 0 };
    expect(affectedHouses("c", idx, src)).toEqual(["a", "b"]);
    expect(commercePopulation("c", idx, src)).toBe(30);
    live.delete("a");
    expect(commercePopulation("c", idx, src)).toBe(20);
  });
});

describe("HQ road connectivity (Map.astarSearchItem)", () => {
  const hq = node({ sid: "hq", isHQ: true, x: 10, y: 10, cols: 4, rows: 3 });

  it("road tiles around an item skip the corners", () => {
    const all = (x: number, y: number) => x >= 4 && x <= 6 && y >= 4 && y <= 6 && !(x === 5 && y === 5);
    const tiles = roadTilesAround({ x: 5, y: 5, cols: 1, rows: 1 }, all);
    expect(tiles).toHaveLength(4); // the 8-tile ring minus its 4 corners
  });

  it("an item is connected when a road path (4-neighbour) joins the HQ ring and its ring", () => {
    // HQ at (10..13, 10..12); a road along y=13 from x=10 to x=20, a house at (21,13) next to it, another at (21,20) with no road
    const road = roadSet(Array.from({ length: 11 }, (_, i) => [10 + i, 13] as [number, number]));
    const connected = node({ sid: "h1", x: 21, y: 13 });
    const lonely = node({ sid: "h2", x: 21, y: 20 });
    const off = disconnectedItems([hq, connected, lonely], road, COLS, ROWS);
    expect([...off]).toEqual(["h2"]);
  });

  it("diagonal road tiles do not connect", () => {
    const road = roadSet([[10, 13], [11, 14], [12, 15]]);
    const reach = roadsReachableFromHQ(hq, road, COLS, ROWS);
    expect(reach.has(14 * COLS + 11)).toBe(false);
    const h = node({ sid: "h", x: 13, y: 16 });
    expect(disconnectedItems([hq, h], road, COLS, ROWS).has("h")).toBe(true);
  });

  it("no HQ -> nothing is disconnected; decorations and the HQ never need a road", () => {
    expect(disconnectedItems([node({ sid: "h", x: 1, y: 1 })], new Set(), COLS, ROWS).size).toBe(0);
    const off = disconnectedItems([hq, node({ sid: "d", type: 2, x: 30, y: 20 }), node({ sid: "h", x: 30, y: 25 })], new Set(), COLS, ROWS);
    expect([...off]).toEqual(["h"]);
  });
});
