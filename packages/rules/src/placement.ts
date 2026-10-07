import { ItemDefinition, requiresTerrainMine } from "./definitions.js";

/** Per-tile flags mirroring TileData.as (mIsBuildable, mBaseItemObject, mIsRoad, mIsSolid, mIsHigh, isMyTerrain). */
export interface TileFlags {
  buildable: boolean;
  road: boolean;
  solid: boolean;
  /** sid of base item occupying the tile, or null */
  occupiedBy: string | null;
  /** TileData.mIsHigh: item that may be roaded over */
  high?: boolean;
  /** player owns the terrain (plot) */
  terrain: boolean;
}

export interface MapState {
  cols: number;
  rows: number;
  tile(x: number, y: number): TileFlags | undefined;
  /** Map.isTileInAreaMine (Map.as:3201): tile inside owned expansion area */
  inAreaMine(x: number, y: number): boolean;
}

/** TileData.getIsBuildable (TileData.as:127). */
export const tileIsBuildable = (t: TileFlags): boolean => t.buildable && t.occupiedBy === null && !t.road && !t.solid;
/** TileData.isBusy (TileData.as:195). */
export const tileIsBusy = (t: TileFlags): boolean => t.occupiedBy !== null || t.road || t.solid;
/** TileData.isRoadable (TileData.as:200). */
export const tileIsRoadable = (t: TileFlags): boolean => !t.road && (t.occupiedBy === null || !!t.high);

export interface PlaceOptions {
  /** ItemObject.getNoNeedPlot (ItemObject.as:2504) -> Map.isBuildable param3 = !noNeedPlot */
  noNeedPlot?: boolean;
  /** world.role.requiresTerrainMine() (Map.as:1553); true for the owner's own city */
  roleRequiresTerrainMine?: boolean;
  /** ToolMove: tiles currently occupied by the item being moved are treated as free */
  movingSid?: string;
}

/** Map.isBuildable (Map.as:1545-1600). (x,y) = top-left footprint tile. */
export function isBuildable(map: MapState, x: number, y: number, def: ItemDefinition, opts: PlaceOptions = {}): boolean {
  const needTerrain = requiresTerrainMine(def) && !opts.noNeedPlot && (opts.roleRequiresTerrainMine ?? true);
  if (x < 0 || y < 0 || x >= map.cols || y >= map.rows) return false;
  if (needTerrain && !map.tile(x, y)?.terrain) return false;
  if (!map.inAreaMine(x, y)) return false;
  if (x + def.baseCols > map.cols || y + def.baseRows > map.rows) return false;
  for (let dx = 0; dx < def.baseCols; dx++) {
    for (let dy = 0; dy < def.baseRows; dy++) {
      const t = map.tile(x + dx, y + dy);
      if (!t) return false;
      const free = tileIsBuildable(t) || (opts.movingSid !== undefined && t.occupiedBy === opts.movingSid && t.buildable && !t.road && !t.solid);
      if (!free) return false;
      if (needTerrain && !t.terrain) return false;
      if (!map.inAreaMine(x + dx, y + dy)) return false;
    }
  }
  return true;
}
