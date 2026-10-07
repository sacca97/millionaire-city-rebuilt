// Influence visuals: the influence area of a decoration/commerce/club (ItemObject.setInfluenceAreaVisibility :1689-1760,
// influenceAreaDraw :2583: rectangle colour 0x00FFF0 at alpha INFLUENCE_ALPHA 0.2 with border), the outline of the affected
// houses (setInfluenceAreaAffectedVisibility :997), the "+N%" badge of a house (InfluenceIconDecoration) and the population badge
// of a commerce (InfluenceIconCommerce, setItemsAffected :1772-1808). Shown while hovering an item (mouseOverShow :2878) and, with the
// simulated values, while a decoration/commerce is being placed (ToolBuild ghost: the checkInfluence mission needs it).
import { TILE } from "../../game/geometry";
import { influenceRect, TYPE_COMMERCES, TYPE_CLUBS, TYPE_DECORATIONS, type Rect } from "../../game/influence";
import { itemTypeOf } from "../../game/economy";
import type { Ghost } from "../../game/tools";
import { getPercentageText } from "../../gui/format";
import { popups } from "../../gui/popup";
import { Widget } from "../../gui/widget";
import type { PointerInfo, PointerTracker } from "../hud/cursor";
import type { UiContext } from "../context";
import type { MapLayer } from "./map-layer";

const CLS = "com.dchoc.framework.utils.AssetManager_";
export const INFLUENCE_COLOR = "#00fff0"; // ItemObject.INFLUENCE_COLOR = 65520

export interface InfluenceSpec {
  area: Rect;
  /** Houses to outline. */
  outline: string[];
  /** "+N%" badges on houses (sid -> text). */
  houseBadges: Array<{ sid: string; text: string }>;
  /** Population badge on a commerce/club (tile point + text). */
  commerceBadge?: { x: number; y: number; text: string };
}

/** Text of a percent badge (TextManager.getPercentageText). */
export const percentText = (v: number): string => getPercentageText(v);

/** Pure: what to show while hovering `sid` (null = nothing). */
export function hoverSpec(ctx: UiContext, sid: string): InfluenceSpec | null {
  const { game } = ctx;
  const item = game.item(sid);
  if (!item) return null;
  const eco = game.economy;
  const type = itemTypeOf(item.def.rules);
  if (item.def.rules.influenceRatio > 0 && (type === TYPE_DECORATIONS || type === TYPE_COMMERCES || type === TYPE_CLUBS)) {
    const area = influenceRect({ x: item.tileX, y: item.tileY, cols: item.cols, rows: item.rows, ratio: item.def.rules.influenceRatio });
    const commerce = type !== TYPE_DECORATIONS;
    const houses = commerce ? eco.affected(sid) : eco.covered(sid);
    return {
      area,
      outline: houses,
      houseBadges: [],
      commerceBadge: commerce ? { x: item.tileX + item.cols / 2, y: item.tileY, text: String(eco.population(sid)) } : undefined
    };
  }
  if (item.sku.startsWith("houses_") && item.stateId !== 4) {
    const pct = eco.influencePercent(sid);
    if (pct !== 0) return { area: { x0: 0, y0: 0, x1: 0, y1: 0 }, outline: [], houseBadges: [{ sid, text: percentText(pct) }] };
  }
  return null;
}

/** What the ghost of a decoration/commerce/club shows (ToolBuild with simulated influence). */
export function ghostSpec(ctx: UiContext, g: Ghost): InfluenceSpec | null {
  if (g.kind !== "item" || !g.sku) return null;
  const def = ctx.defs.get(g.sku);
  if (!def || def.rules.influenceRatio <= 0) return null;
  const type = itemTypeOf(def.rules);
  if (type !== TYPE_DECORATIONS && type !== TYPE_COMMERCES && type !== TYPE_CLUBS) return null;
  const eco = ctx.game.economy;
  const pv = eco.previewPlacement(def, g.x, g.y);
  if (type === TYPE_DECORATIONS) {
    return {
      area: pv.area,
      outline: pv.houses,
      houseBadges: pv.houses.map((sid) => ({ sid, text: percentText(eco.influencePercent(sid) + pv.housePercent) }))
    };
  }
  return { area: pv.area, outline: pv.affecting, houseBadges: [], commerceBadge: { x: g.x + g.cols / 2, y: g.y, text: String(pv.population) } };
}

interface Badge {
  holder: HTMLElement;
  widget?: Widget;
  text: string;
  kind: "percent" | "commerce";
}

export class InfluenceView {
  private spec: InfluenceSpec | null = null;
  private source: { kind: "hover"; sid: string } | { kind: "ghost"; g: Ghost } | null = null;
  private readonly area = document.createElement("div");
  private readonly outlines = new Map<string, HTMLElement>();
  private readonly badges = new Map<string, Badge>();

  constructor(private readonly ctx: UiContext, private readonly layer: MapLayer, pointer: PointerTracker) {
    this.area.style.cssText = `position:absolute;display:none;box-sizing:border-box;border:2px solid ${INFLUENCE_COLOR};background:${INFLUENCE_COLOR}33`;
    layer.el.append(this.area);
    ctx.game.on("ghost", (g) => this.setSource(g ? { kind: "ghost", g } : null));
    pointer.onChange((i) => this.onPointer(i));
    for (const ev of ["item-added", "item-removed", "item-changed"] as const) ctx.game.on(ev, () => this.recompute());
    ctx.game.on("tool", () => this.recompute());
    layer.onFrame(() => this.position());
  }

  /** Spec currently displayed (tests/debug). */
  get current(): InfluenceSpec | null {
    return this.spec;
  }

  private onPointer(i: PointerInfo): void {
    const tool = this.ctx.game.tool.kind;
    if (tool === "build") return; // the ghost drives the preview
    if (i.onMap && i.item && (tool === "select" || tool === "move")) this.setSource({ kind: "hover", sid: i.item.sid });
    else if (this.source?.kind === "hover") this.setSource(null);
  }

  private setSource(s: InfluenceView["source"]): void {
    this.source = s;
    this.recompute();
  }

  private recompute(): void {
    const s = this.source;
    const spec = !s ? null : s.kind === "hover" ? hoverSpec(this.ctx, s.sid) : ghostSpec(this.ctx, s.g);
    this.spec = spec;
    this.rebuild();
  }

  private rebuild(): void {
    const spec = this.spec;
    const wantOutline = new Set(spec?.outline ?? []);
    for (const [sid, el] of this.outlines) {
      if (!wantOutline.has(sid)) {
        el.remove();
        this.outlines.delete(sid);
      }
    }
    for (const sid of wantOutline) {
      if (this.outlines.has(sid)) continue;
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;box-sizing:border-box;border:2px solid ${INFLUENCE_COLOR};box-shadow:0 0 8px ${INFLUENCE_COLOR},inset 0 0 8px ${INFLUENCE_COLOR}66`;
      this.layer.el.append(el);
      this.outlines.set(sid, el);
    }
    const want = new Map<string, { kind: Badge["kind"]; text: string }>();
    for (const b of spec?.houseBadges ?? []) want.set(`h:${b.sid}`, { kind: "percent", text: b.text });
    if (spec?.commerceBadge) want.set("c", { kind: "commerce", text: spec.commerceBadge.text });
    for (const [key, b] of this.badges) {
      if (!want.has(key)) {
        b.holder.remove();
        this.badges.delete(key);
      }
    }
    for (const [key, w] of want) {
      let b = this.badges.get(key);
      if (!b) {
        b = { holder: document.createElement("div"), text: w.text, kind: w.kind };
        b.holder.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none";
        this.layer.el.append(b.holder);
        this.badges.set(key, b);
        void this.loadBadge(b);
      }
      b.text = w.text;
      b.widget?.part("TextInfo").setText(w.text, { fit: true, rich: false });
    }
  }

  private async loadBadge(b: Badge): Promise<void> {
    const w = await Widget.create("Dollars", CLS + (b.kind === "commerce" ? "InfluenceIconCommerce" : "InfluenceIconPositiveDecoration"));
    b.widget = w;
    b.holder.append(w.root);
    w.part("TextInfo").setText(b.text, { fit: true, rich: false });
  }

  private position(): void {
    const spec = this.spec;
    if (!spec || (this.source?.kind === "hover" && popups.isAnyOpen)) {
      this.area.style.display = "none";
      return;
    }
    const a = spec.area;
    const has = a.x1 > a.x0;
    this.area.style.display = has ? "" : "none";
    if (has) this.layer.placeRect(this.area, a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
    const { game } = this.ctx;
    for (const [sid, el] of this.outlines) {
      const it = game.item(sid);
      if (it) this.layer.placeRect(el, it.tileX, it.tileY, it.cols, it.rows);
    }
    for (const [key, b] of this.badges) {
      if (key === "c" && spec.commerceBadge) this.layer.placePoint(b.holder, spec.commerceBadge.x, spec.commerceBadge.y, -TILE / 2);
      else if (key.startsWith("h:")) {
        const it = game.item(key.slice(2));
        if (it) this.layer.placePoint(b.holder, it.tileX + it.cols / 2, it.tileY + it.rows / 2);
      }
    }
  }
}
