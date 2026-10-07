// Map geometry shared by logic and view (no Pixi imports). Verified in docs/client-logic-spec.md.
export const TILE = 32;
export const MAP_COLS = 90;
export const MAP_ROWS = 60;

/** Save-relative tile -> absolute tile (Map.getTileRelativeXToTile / getTileRelativeYToTile). */
export const tileX = (rel: number): number => rel + MAP_COLS / 2;
export const tileY = (rel: number): number => rel + MAP_ROWS / 2;
/** Absolute tile -> save-relative tile (Map.getTileToTileRelativeX/Y). */
export const relX = (tile: number): number => tile - MAP_COLS / 2;
export const relY = (tile: number): number => tile - MAP_ROWS / 2;
