// Tool state machine, ported from map/tools/*.as (Tool, ToolSelect, ToolBuild, ToolMove, ToolDestroy, ToolRoad, ToolTerrain).
// A tool turns pointer positions (world pixels) into a ghost preview and, on click, into a Game action. Tools hold no
// game state; everything they need is behind ToolHost, which Game implements.
import { TILE } from "./geometry";
import { cursorToFootprint } from "./placement";

export type ToolKind = "select" | "build" | "move" | "destroy" | "road" | "terrain";

export interface ToolState {
  kind: ToolKind;
  /** build: item sku being placed. */
  sku?: string;
  /** move: sid of the item being moved. */
  sid?: string;
  /** build: placing an item taken from storage (ToolBuild.mFromStorage): free, consumes the stored item. */
  fromStorage?: boolean;
  /**
   * build: a free reward item (ToolBuild.mFreeItem / collectible reward). `extra` is added to the new_item payload
   * (collectibles: {key:"collectible", value: groupSku}, cmdCreateNewItemFromCollectibleReward); `ref` is echoed to hooks.giftPlaced.
   */
  gift?: { extra?: { key: string; value: string }; ref?: string };
}

/** Cursor-following preview: footprint in ABSOLUTE tiles, validity colours it green/red. */
export interface Ghost {
  kind: "item" | "tile";
  x: number;
  y: number;
  cols: number;
  rows: number;
  valid: boolean;
  /** Human-readable reason when invalid (also used for toasts). */
  reason?: string;
  sku?: string;
  /** Terrain tool cursor art (Map.mTerrainShape / mTerrainShapeRed with the Grill / GrillBad grid). */
  art?: "terrain";
}

export interface Check {
  ok: boolean;
  reason?: string;
}

export interface ToolHost {
  footprintOf(sku: string): { cols: number; rows: number } | undefined;
  footprintOfItem(sid: string): { cols: number; rows: number; sku: string } | undefined;
  checkBuild(sku: string, tx: number, ty: number): Check;
  build(sku: string, tx: number, ty: number): boolean;
  isDecorationSku(sku: string): boolean;
  checkMove(sid: string, tx: number, ty: number): Check;
  moveItem(sid: string, tx: number, ty: number): boolean;
  checkRoad(tx: number, ty: number): Check;
  buildRoad(tx: number, ty: number): boolean;
  checkTerrain(tx: number, ty: number): Check;
  buyTerrain(tx: number, ty: number): boolean;
  checkDestroy(tx: number, ty: number): Check;
  destroyAt(tx: number, ty: number): boolean;
  /** Select-tool click on an item tile (or empty ground when no item). */
  activateTile(tx: number, ty: number): void;
  toast(text: string): void;
  setTool(state: ToolState): void;
  /** Optional: adjust the footprint position under the cursor (the tutorial snaps near its forced tile). */
  snapBuild?(sku: string, tx: number, ty: number): { x: number; y: number };
}

export interface Tool {
  readonly state: ToolState;
  ghost(host: ToolHost, wx: number, wy: number): Ghost | null;
  click(host: ToolHost, wx: number, wy: number): void;
}

const tileOf = (w: number): number => Math.floor(w / TILE);

function tileGhost(tx: number, ty: number, c: Check): Ghost {
  return { kind: "tile", x: tx, y: ty, cols: 1, rows: 1, valid: c.ok, reason: c.reason };
}

class SelectTool implements Tool {
  readonly state: ToolState = { kind: "select" };
  ghost(): Ghost | null {
    return null;
  }
  click(host: ToolHost, wx: number, wy: number): void {
    host.activateTile(tileOf(wx), tileOf(wy));
  }
}

class BuildTool implements Tool {
  constructor(readonly state: ToolState) {}
  ghost(host: ToolHost, wx: number, wy: number): Ghost | null {
    const fp = this.state.sku ? host.footprintOf(this.state.sku) : undefined;
    if (!fp || !this.state.sku) {
      return null;
    }
    const raw = cursorToFootprint(wx, wy, fp.cols, fp.rows);
    const at = host.snapBuild?.(this.state.sku, raw.x, raw.y) ?? raw;
    const c = host.checkBuild(this.state.sku, at.x, at.y);
    return { kind: "item", x: at.x, y: at.y, cols: fp.cols, rows: fp.rows, valid: c.ok, reason: c.reason, sku: this.state.sku };
  }
  click(host: ToolHost, wx: number, wy: number): void {
    const g = this.ghost(host, wx, wy);
    if (!g || !this.state.sku) {
      return;
    }
    if (!g.valid) {
      if (g.reason) host.toast(g.reason);
      return;
    }
    if (host.build(this.state.sku, g.x, g.y) && !host.isDecorationSku(this.state.sku)) {
      // ToolBuild.startBuildingItem: buildings return to the select tool, decorations stay armed (ToolBuild.as:~278).
      host.setTool({ kind: "select" });
    }
  }
}

class MoveTool implements Tool {
  constructor(readonly state: ToolState) {}
  ghost(host: ToolHost, wx: number, wy: number): Ghost | null {
    const fp = this.state.sid ? host.footprintOfItem(this.state.sid) : undefined;
    if (!fp || !this.state.sid) {
      return null;
    }
    const at = cursorToFootprint(wx, wy, fp.cols, fp.rows);
    const c = host.checkMove(this.state.sid, at.x, at.y);
    return { kind: "item", x: at.x, y: at.y, cols: fp.cols, rows: fp.rows, valid: c.ok, reason: c.reason, sku: fp.sku };
  }
  click(host: ToolHost, wx: number, wy: number): void {
    const g = this.ghost(host, wx, wy);
    if (!g || !this.state.sid) {
      return;
    }
    if (!g.valid) {
      if (g.reason) host.toast(g.reason);
      return;
    }
    if (host.moveItem(this.state.sid, g.x, g.y)) {
      host.setTool({ kind: "select" });
    }
  }
}

class DestroyTool implements Tool {
  readonly state: ToolState = { kind: "destroy" };
  ghost(host: ToolHost, wx: number, wy: number): Ghost | null {
    const tx = tileOf(wx);
    const ty = tileOf(wy);
    return tileGhost(tx, ty, host.checkDestroy(tx, ty));
  }
  click(host: ToolHost, wx: number, wy: number): void {
    host.destroyAt(tileOf(wx), tileOf(wy));
  }
}

class RoadTool implements Tool {
  readonly state: ToolState = { kind: "road" };
  ghost(host: ToolHost, wx: number, wy: number): Ghost | null {
    const tx = tileOf(wx);
    const ty = tileOf(wy);
    return { ...tileGhost(tx, ty, host.checkRoad(tx, ty)), art: "terrain" }; // oracle ui-tour 05: same green tile + grid art as the terrain tool
  }
  click(host: ToolHost, wx: number, wy: number): void {
    host.buildRoad(tileOf(wx), tileOf(wy));
  }
}

class TerrainTool implements Tool {
  readonly state: ToolState = { kind: "terrain" };
  ghost(host: ToolHost, wx: number, wy: number): Ghost | null {
    const tx = tileOf(wx);
    const ty = tileOf(wy);
    return { ...tileGhost(tx, ty, host.checkTerrain(tx, ty)), art: "terrain" };
  }
  click(host: ToolHost, wx: number, wy: number): void {
    const tx = tileOf(wx);
    const ty = tileOf(wy);
    const c = host.checkTerrain(tx, ty);
    if (!c.ok) {
      if (c.reason) host.toast(c.reason);
      return;
    }
    host.buyTerrain(tx, ty);
  }
}

export function createTool(state: ToolState): Tool {
  switch (state.kind) {
    case "build":
      return new BuildTool(state);
    case "move":
      return new MoveTool(state);
    case "destroy":
      return new DestroyTool();
    case "road":
      return new RoadTool();
    case "terrain":
      return new TerrainTool();
    default:
      return new SelectTool();
  }
}
