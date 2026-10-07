// Port of Millionaire City terrain/road autotiling. Pure TS, no DOM/Pixi.
// Original: decompiled/scripts/com/dchoc/dollars/map/{Map,Background,TileData}.as

export const TILE_SIZE = 32;
export const TILESET_COLS = 16; // Background.as:~316 (idx % 16, int(idx/16))
export const TILESET_ROWS = 8;
export const TILESET_WIDTH = 512;
export const TILESET_HEIGHT = 256;
/** Map.as:249 mTileOffsets = [terrain, road, grass] */
export const TILE_OFFSETS = { terrain: 14, road: 62, grass: 1 } as const;
export const GRASS_TILE = 1; // Map.as:223 (stored value; tileset index 0)
/** Background.as:25: 0, so the "unowned area" offset is a no-op. */
export const TILE_MAX = 0;

export type TileSet = Set<number> | ArrayLike<boolean | number>;
export interface TerrainOpts {
  cols: number;
  rows: number;
  /** player-owned built terrain tiles (index = y*cols+x) */
  terrain: TileSet;
  road: TileSet;
}

const has = (s: TileSet, i: number): boolean =>
  s instanceof Set ? s.has(i) : !!(s as ArrayLike<boolean | number>)[i];

/** Ground type per tile. TileData.as:315-344 getGroundType: road, then terrain overrides. */
export type Ground = "grass" | "terrain" | "road";

/** Tileset (0-based column-major-row) coordinates for a tileset index. */
export function tilesetPos(idx: number): { col: number; row: number } {
  return { col: idx % TILESET_COLS, row: Math.floor(idx / TILESET_COLS) };
}

/**
 * Map.as:2937-3170 getTileTerrainForm, returns form 0..46 (15 = isolated).
 * `same(i, kind)` = neighbour has same ground type.
 * Left/right neighbours require the same row (Map.as:2614 TileIsInTheSameRow);
 * others only validity (Map.as:2437 TileIsInTheMap). Diagonals are only tested
 * when all 4 orthogonals are set, so no row-wrap issue arises.
 */
export function terrainForm(
  cols: number,
  rows: number,
  ground: Ground[],
  i: number,
  kind: Ground,
): number {
  const n = cols * rows;
  const ok = (j: number) => j >= 0 && j < n && ground[j] === kind;
  const row = Math.floor(i / cols);
  const R = Math.floor((i + 1) / cols) === row && ok(i + 1);
  const L = Math.floor((i - 1) / cols) === row && ok(i - 1) && i % cols !== 0;
  const U = ok(i - cols);
  const D = ok(i + cols);
  const UL = ok(i - 1 - cols);
  const UR = ok(i + 1 - cols);
  const DL = ok(i - 1 + cols);
  const DR = ok(i + 1 + cols);
  let f = 15;
  if (R) {
    f = 12;
    if (L) {
      f = 10;
      if (U) {
        f = 19;
        if (D) {
          f = 16;
          if (UL) {
            f = 41;
            if (UR) {
              f = 28;
              if (DR) {
                f = 29;
                if (DL) f = 4;
              } else if (DL) f = 32;
            } else if (DR) {
              f = 45;
              if (DL) f = 30;
            } else if (DL) f = 26;
          } else if (UR) {
            f = 44;
            if (DR) {
              f = 25;
              if (DL) f = 31;
            } else if (DL) f = 46;
          } else if (DR) {
            f = 43;
            if (DL) f = 27;
          } else if (DL) f = 42;
        } else if (UL) {
          f = 35;
          if (UR) f = 7;
        } else if (UR) f = 39;
      } else if (D) {
        f = 20;
        if (DL) {
          f = 40;
          if (DR) f = 1;
        } else if (DR) f = 36;
      }
    } else if (U) {
      f = 23;
      if (D) {
        f = 18;
        if (UR) {
          f = 34;
          if (DR) f = 3;
        } else if (DR) f = 38;
      } else if (UR) f = 6;
    } else if (D) {
      f = 21;
      if (DR) f = 0;
    }
  } else if (L) {
    f = 11;
    if (U) {
      f = 24;
      if (D) {
        f = 17;
        if (UL) {
          f = 33;
          if (DL) f = 5;
        } else if (DL) f = 37;
      } else if (UL) f = 8;
    } else if (D) {
      f = 22;
      if (DL) f = 2;
    }
  } else if (U) {
    f = 14;
    if (D) f = 9;
  } else if (D) f = 13;
  return f;
}

/**
 * Compute the tileset index (0 = nothing) for every cell.
 * Stored map value v>0 -> tileset index v-1 (Background.as:312-322); we return
 * v (so 0 = nothing, tileset idx = result-1). Use tilesetIndex() to convert.
 * Terrain cells: 14+form (Map.as:2948,3170), road: 62+form, grass: 1 (Map.as:3348).
 * Finally the crosswalk pass (Map.as:566-665) is applied row-major.
 *
 * Returned values are the stored mMapData values (1-based); subtract 1 for the
 * tileset index. Value 0 never occurs for in-map cells (grass = 1) but the
 * convention is kept for the renderer.
 */
export function computeTileIndices(opts: TerrainOpts): Uint16Array {
  const { cols, rows } = opts;
  const n = cols * rows;
  const ground: Ground[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let g: Ground = "grass";
    if (has(opts.road, i)) g = "road";
    if (has(opts.terrain, i)) g = "terrain"; // terrain overrides, TileData.as:330
    ground[i] = g;
  }
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const g = ground[i];
    out[i] =
      g === "grass"
        ? GRASS_TILE
        : TILE_OFFSETS[g] + terrainForm(cols, rows, ground, i, g);
  }
  applyCrossWalk(out, cols, rows);
  return out;
}

/** Stored value -> 0-based tileset index (or -1 for nothing). Background.as:312-316. */
export const tilesetIndex = (v: number): number => (v > 0 ? v - 1 : -1);

/**
 * Map.as:566-665 checkCrossWalk. For road forms 16 (cross), 17 (T open right?
 * i.e. has L,U,D), 19 (L,R,U), 20 (L,R,D) the adjacent straight road tiles
 * (form 10 horizontal -> value 2, form 9 vertical -> value 3) become crosswalk
 * tiles (tileset idx 1 and 2). Row-major, in place; reads see earlier writes.
 */
export function applyCrossWalk(data: Uint16Array, cols: number, rows: number): void {
  const off = TILE_OFFSETS.road;
  const n = cols * rows;
  const f = (i: number) => (i >= 0 && i < n ? data[i] - off : -999);
  const setIf = (i: number, form: number, v: number) => {
    if (f(i) === form) data[i] = v;
  };
  for (let i = 0; i < n; i++) {
    const t = data[i] - off;
    if (t === 16) {
      setIf(i - 1, 10, 2); setIf(i + 1, 10, 2);
      setIf(i - cols, 9, 3); setIf(i + cols, 9, 3);
    } else if (t === 17) {
      setIf(i - 1, 10, 2); setIf(i - cols, 9, 3); setIf(i + cols, 9, 3);
    } else if (t === 19) {
      setIf(i + 1, 10, 2); setIf(i - 1, 10, 2); setIf(i - cols, 9, 3);
    } else if (t === 20) {
      setIf(i - 1, 10, 2); setIf(i + 1, 10, 2); setIf(i + cols, 9, 3);
    }
  }
}
