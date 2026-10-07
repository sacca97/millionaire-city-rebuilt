/**
 * Mouse cursor art, port of utils/Cursor.as: the original hides the OS cursor over the map and draws a sprite from
 * Dollars.swf (AssetManager_*Cursor) at the pointer; CURSOR_SELECT/HAND show the normal OS cursor.
 * Also hosts the PointerTracker (map pointer -> hovered tile/item) shared with the info box.
 */
import { RENT_MODE, STATE_ID } from "../../net/commands";
import { Widget } from "../../gui/widget";
import type { GameItem } from "../../game/game";
import type { ToolState } from "../../game/tools";
import type { UiContext } from "../context";
import type { MultiTool } from "./toolsbar";

/** Cursor.as constants -> AssetManager class names (Cursor.load). */
export type CursorId = "demolition" | "road" | "collect" | "terrain" | "build" | "move" | "collector" | "contractSignator" | "signContract" | "abandoned" | "buyArea" | "instantBuild" | "wonder" | "buy";
const CLASS: Record<CursorId, string> = {
  demolition: "DemolitionCursor",
  road: "RoadCursor",
  collect: "IncomeButtonCollect",
  terrain: "TerrainCursor",
  build: "BuildCursor",
  move: "MoveCursor",
  collector: "CollectorCursor",
  contractSignator: "ContractSignatorCursor",
  signContract: "SignContractCursor",
  abandoned: "AbandonedCursor",
  buyArea: "BuyAreaCursor",
  instantBuild: "InstantBuildCursor",
  wonder: "WonderCursor",
  buy: "BuyCursor",
};
/** settings.xml helpConstructionMinTime (15 min): StateOnConstructionOwner.doDoMouseOver picks WonderCursor from this construction time up. */
const HELP_CONSTRUCTION_MIN_MS = 15 * 60_000;

/** Pure: which cursor a tool (and optionally the hovered item) asks for. null = OS cursor (CURSOR_SELECT / CURSOR_HAND). */
export function cursorFor(tool: ToolState, multi: MultiTool | null, hovered?: (Pick<GameItem, "stateId" | "mode"> & { time?: number; def?: { rules: { constructionTimeMs: number } } }) | null): CursorId | null {
  if (multi === "collector") return "collector"; // ToolMoneyCollector -> CURSOR_MONEY_COLLECTOR
  if (multi === "contract") return "contractSignator"; // CURSOR_CONTRACT_SIGNATOR
  if (multi === "move") return "move";
  switch (tool.kind) {
    case "destroy":
      return "demolition"; // ToolDestroy.getDefaultCursorID
    case "road":
      return "road";
    case "terrain":
      return "terrain";
    case "move":
      return "move"; // ToolMove.getDefaultCursorID
    case "build":
      return null; // ToolBuild.getDefaultCursorID = CURSOR_SELECT (the ghost follows the pointer)
    default:
      break;
  }
  if (hovered && hovered.stateId === STATE_ID.CONSTRUCTION && tool.kind === "select" && (hovered.time ?? 0) > 0) {
    // StateOnConstructionOwner.doDoMouseOver :44-54 (hourglass + people)
    return (hovered.def?.rules.constructionTimeMs ?? 0) >= HELP_CONSTRUCTION_MIN_MS ? "wonder" : "instantBuild";
  }
  if (hovered && hovered.stateId === STATE_ID.IA && tool.kind === "select" && hovered.mode === 2) return "buy"; // StateOnIA.doDoMouseOver :232
  if (hovered && hovered.stateId === STATE_ID.RENT) {
    if (hovered.mode === RENT_MODE.GET_RENT) return "collect";
    if (hovered.mode === RENT_MODE.WAITING_FOR_CONTRACT) return "signContract";
    if (hovered.mode === RENT_MODE.ABANDONED) return "abandoned";
  }
  return null;
}

/** Rival (StateOnIA) buildings are not game items; ui/extras/rivals.ts installs a resolver giving the hovered for-sale building as a pseudo item. */
export const rivalHit: { fn?: (tileX: number, tileY: number) => GameItem | undefined } = {};

export interface PointerInfo {
  /** Pointer is over the map canvas (not over a HUD element). */
  onMap: boolean;
  x: number;
  y: number;
  tile?: { x: number; y: number };
  item?: GameItem;
}

export class PointerTracker {
  info: PointerInfo = { onMap: false, x: 0, y: 0 };
  private subs = new Set<(i: PointerInfo) => void>();
  constructor(private readonly ctx: UiContext) {
    window.addEventListener("pointermove", (e) => this.update(e.clientX, e.clientY, e.target), { passive: true });
    document.addEventListener("pointerleave", () => this.update(-1, -1, null));
    ctx.game.on("item-changed", () => this.refresh());
    ctx.game.on("item-removed", () => this.refresh());
    ctx.game.on("item-added", () => this.refresh());
  }
  onChange(fn: (i: PointerInfo) => void): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
  private refresh(): void {
    // Flash re-dispatches mouse-over when an item appears/changes under a still pointer (oracle build-flow 06: the freshly placed building
    // shows its hover box at once). Deferred so the game finished updating its item model after emitting.
    window.setTimeout(() => this.update(this.info.x, this.info.y, this.info.onMap ? document.querySelector("canvas") : null), 30);
  }
  private update(x: number, y: number, target: EventTarget | null): void {
    const onMap = target instanceof HTMLCanvasElement;
    let tile: PointerInfo["tile"];
    let item: GameItem | undefined;
    if (onMap) {
      tile = this.ctx.city.pointerToTile(x, y);
      item = this.ctx.game.itemAtTile(tile.x, tile.y) ?? rivalHit.fn?.(tile.x, tile.y);
    }
    this.info = { onMap, x, y, tile, item };
    for (const s of [...this.subs]) s(this.info);
  }
}

export class CursorLayer {
  readonly el: HTMLElement;
  private widgets = new Map<CursorId, Widget>();
  private current: CursorId | null = null;
  private multi: MultiTool | null = null;
  private loading = new Set<CursorId>();

  constructor(private readonly ctx: UiContext, private readonly pointer: PointerTracker) {
    this.el = document.createElement("div");
    this.el.className = "mc-cursor";
    this.el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:99999;display:none";
    ctx.game.on("tool", () => this.update());
    ctx.game.on("selection", () => this.update());
    pointer.onChange((i) => {
      this.el.style.transform = `translate(${i.x}px,${i.y}px)`;
      this.update();
    });
  }

  setMulti(m: MultiTool | null): void {
    this.multi = m;
    this.update();
  }

  private update(): void {
    const i = this.pointer.info;
    const id = i.onMap ? cursorFor(this.ctx.game.tool, this.multi, i.item) : null;
    const canvas = document.querySelector("canvas");
    if (canvas) canvas.style.cursor = id ? "none" : "";
    if (id === this.current) {
      this.el.style.display = id && i.onMap ? "" : "none";
      return;
    }
    this.current = id;
    this.el.style.display = "none";
    if (!id) return;
    const ready = this.widgets.get(id);
    if (ready) return this.show(id, ready);
    if (this.loading.has(id)) return;
    this.loading.add(id);
    void Widget.create("Dollars", `com.dchoc.framework.utils.AssetManager_${CLASS[id]}`).then((w) => {
      this.widgets.set(id, w);
      this.loading.delete(id);
      if (this.current === id) this.show(id, w);
    }).catch(() => this.loading.delete(id));
  }

  private show(_id: CursorId, w: Widget): void {
    this.el.replaceChildren(w.root);
    this.el.style.display = this.pointer.info.onMap ? "" : "none";
  }
}
