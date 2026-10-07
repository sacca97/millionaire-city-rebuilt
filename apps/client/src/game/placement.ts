// Cursor -> tile snapping and validity for item placement.
// Tool.reportMouseMove (Tool.as:282-340), getXFromMouse/getYFromMouse (Tool.as:535,624),
// TopDownView.getScreenToWorldX with snapping (view/TopDownView.as).
import { isBuildable, type ItemDefinition, type PlaceOptions } from "@mcity/rules";
import type { GameWorld } from "./world";

const TILE = 32;

/** TopDownView snapping: floor to a tile, round up when more than half a tile in. */
export function snapToTile(v: number): number {
  const base = Math.floor(v / TILE);
  return v - base * TILE > TILE >> 1 ? base + 1 : base;
}

/** Item is centred on the cursor, then its top-left snaps to the nearest tile boundary. */
export function cursorToFootprint(worldX: number, worldY: number, cols: number, rows: number): { x: number; y: number } {
  return { x: snapToTile(worldX - (cols * TILE) / 2), y: snapToTile(worldY - (rows * TILE) / 2) };
}

export function canPlace(world: GameWorld, def: ItemDefinition, x: number, y: number, opts: PlaceOptions = {}): boolean {
  return isBuildable(world, x, y, def, opts);
}
