import { describe, it, expect } from "vitest";
import { computeTileIndices, tilesetPos, tilesetIndex, TILE_OFFSETS, GRASS_TILE } from "./terrain";

const C = 10, R = 10;
const at = (x: number, y: number) => y * C + x;

describe("terrain", () => {
  it("empty is grass", () => {
    const o = computeTileIndices({ cols: C, rows: R, terrain: new Set(), road: new Set() });
    expect(new Set(o)).toEqual(new Set([GRASS_TILE]));
  });
  it("isolated terrain = form 15", () => {
    const o = computeTileIndices({ cols: C, rows: R, terrain: new Set([at(5, 5)]), road: new Set() });
    expect(o[at(5, 5)]).toBe(TILE_OFFSETS.terrain + 15);
  });
  it("3x3 terrain block corners/edges/centre", () => {
    const t = new Set<number>();
    for (let y = 4; y < 7; y++) for (let x = 4; x < 7; x++) t.add(at(x, y));
    const o = computeTileIndices({ cols: C, rows: R, terrain: t, road: new Set() });
    const b = TILE_OFFSETS.terrain;
    expect(o[at(4, 4)]).toBe(b + 0);
    expect(o[at(5, 4)]).toBe(b + 1);
    expect(o[at(5, 5)]).toBe(b + 4);
    expect(o[at(6, 6)]).toBe(b + 8);
  });
  it("row wrap: tile at x=9 does not see x=0 of next row", () => {
    const o = computeTileIndices({ cols: C, rows: R, terrain: new Set([at(9, 2), at(0, 3)]), road: new Set() });
    expect(o[at(9, 2)]).toBe(TILE_OFFSETS.terrain + 15);
    expect(o[at(0, 3)]).toBe(TILE_OFFSETS.terrain + 15);
  });
  it("straight road and crosswalk at T-junction", () => {
    const r = new Set<number>();
    for (let x = 2; x <= 6; x++) r.add(at(x, 5));
    r.add(at(4, 4));
    const o = computeTileIndices({ cols: C, rows: R, terrain: new Set(), road: r });
    expect(o[at(3, 5)]).toBe(2); // crosswalk H, tileset idx 1
    expect(o[at(5, 5)]).toBe(2);
    expect(o[at(4, 5)]).toBe(TILE_OFFSETS.road + 19);
    expect(o[at(2, 5)]).toBe(TILE_OFFSETS.road + 12);
    expect(tilesetIndex(o[at(3, 5)])).toBe(1);
  });
  it("terrain overrides road; geometry", () => {
    const o = computeTileIndices({ cols: C, rows: R, terrain: new Set([at(1, 1)]), road: new Set([at(1, 1)]) });
    expect(o[at(1, 1)]).toBe(TILE_OFFSETS.terrain + 15);
    expect(tilesetPos(37)).toEqual({ col: 5, row: 2 });
  });
});
