import type { MapState, TileFlags } from "@mcity/rules";
import type { DefinitionTable } from "../model/definitions";
import type { PlacedItem, WorldState } from "../model/save";
import { MAP_COLS, MAP_ROWS, tileX, tileY } from "./geometry";
import type { Expansions } from "./expansions";

/** Logic tile type 0 = LOGIC_TILE_SOLID (Map.as:99): impassable scenery from rules/universe/map.xml. */
export function parseLogicTiles(xml: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of xml.matchAll(/<LogicTiles\s+chunk="([^"]*)"/g)) {
    for (const part of m[1].split(",")) {
      const t = /^0:(-?\d+):(-?\d+)$/.exec(part.trim());
      if (t) {
        out.push([Number(t[1]), Number(t[2])]);
      }
    }
  }
  return out;
}

/** Authoritative-on-client occupancy model of the player's city; implements the rules MapState. */
export class GameWorld implements MapState {
  readonly cols = MAP_COLS;
  readonly rows = MAP_ROWS;
  private terrainSet = new Set<number>();
  private roadSet = new Set<number>();
  private solidSet = new Set<number>();
  private occupied = new Map<number, string>();
  private items = new Map<string, PlacedItem>();

  constructor(
    state: WorldState,
    private defs: DefinitionTable,
    readonly expansions: Expansions,
    solid: Array<[number, number]> = []
  ) {
    for (const [x, y] of state.terrain) this.terrainSet.add(this.idx(tileX(x), tileY(y)));
    for (const [x, y] of state.roads) this.roadSet.add(this.idx(tileX(x), tileY(y)));
    for (const [x, y] of solid) this.solidSet.add(this.idx(tileX(x), tileY(y)));
    for (const item of state.mine?.items ?? []) this.addItem(item);
    // Rival companies' (for-sale, StateOnIA) buildings occupy their footprint (Map items) but are not part of the owner's city.
    for (const c of state.companies) {
      if (c === state.mine) continue;
      for (const item of c.items) {
        const f = this.footprint(item);
        for (let dx = 0; dx < f.cols; dx += 1) for (let dy = 0; dy < f.rows; dy += 1) this.occupied.set(this.idx(f.x + dx, f.y + dy), `rival:${item.sid}`);
      }
    }
  }

  private idx(x: number, y: number): number {
    return y * MAP_COLS + x;
  }

  /** Top-left footprint tile (absolute) of an item. */
  footprint(item: PlacedItem): { x: number; y: number; cols: number; rows: number } {
    const def = this.defs.get(item.sku);
    return { x: tileX(item.x), y: tileY(item.y), cols: def?.cols ?? 1, rows: def?.rows ?? 1 };
  }

  addItem(item: PlacedItem): void {
    this.items.set(item.sid, item);
    const f = this.footprint(item);
    for (let dx = 0; dx < f.cols; dx += 1) {
      for (let dy = 0; dy < f.rows; dy += 1) {
        this.occupied.set(this.idx(f.x + dx, f.y + dy), item.sid);
      }
    }
  }

  removeItem(sid: string): void {
    const item = this.items.get(sid);
    if (!item) {
      return;
    }
    const f = this.footprint(item);
    for (let dx = 0; dx < f.cols; dx += 1) {
      for (let dy = 0; dy < f.rows; dy += 1) {
        this.occupied.delete(this.idx(f.x + dx, f.y + dy));
      }
    }
    this.items.delete(sid);
  }

  itemAt(x: number, y: number): PlacedItem | undefined {
    const sid = this.occupied.get(this.idx(x, y));
    return sid === undefined ? undefined : this.items.get(sid);
  }

  allItems(): PlacedItem[] {
    return [...this.items.values()];
  }

  addTerrain(x: number, y: number): void {
    this.terrainSet.add(this.idx(x, y));
  }

  removeTerrain(x: number, y: number): void {
    this.terrainSet.delete(this.idx(x, y));
  }

  setRoad(x: number, y: number, on: boolean): void {
    if (on) this.roadSet.add(this.idx(x, y));
    else this.roadSet.delete(this.idx(x, y));
  }

  get terrain(): ReadonlySet<number> {
    return this.terrainSet;
  }

  get roads(): ReadonlySet<number> {
    return this.roadSet;
  }

  tile(x: number, y: number): TileFlags | undefined {
    if (x < 0 || y < 0 || x >= MAP_COLS || y >= MAP_ROWS) {
      return undefined;
    }
    const i = this.idx(x, y);
    return {
      buildable: true,
      road: this.roadSet.has(i),
      solid: this.solidSet.has(i),
      occupiedBy: this.occupied.get(i) ?? null,
      terrain: this.terrainSet.has(i)
    };
  }

  inAreaMine(x: number, y: number): boolean {
    return this.expansions.isMine(x, y);
  }
}
