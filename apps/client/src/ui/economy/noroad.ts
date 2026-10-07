// "Not connected to the HQ" icons (ItemObject.mDisplayObjectNotConnectedToHQ = AssetManager.ItemNoRoadIcon, ItemObject.as:2645,
// applyHQConnection :1915-1965) and the "connected" bubble (viewAttach(VIEW_CONNECTED_TO_ROAD_ID): houses_info Event_Start_Income +
// TID_HOUSE_CONNECTED, :2162-2186). The icon sits at the item's centre (:1930) and disappears when a road reaches the HQ.
import { getText } from "../../gui/i18n";
import { Widget } from "../../gui/widget";
import type { UiContext } from "../context";
import type { MapLayer } from "./map-layer";

const ICON_CLASS = "com.dchoc.framework.utils.AssetManager_ItemNoRoadIcon";

export class NoRoadIcons {
  private readonly icons = new Map<string, HTMLElement>();
  private readonly loading = new Set<string>();
  private known = new Set<string>();
  private first = true;

  constructor(private readonly ctx: UiContext, private readonly layer: MapLayer) {
    layer.onFrame(() => this.update());
  }

  /** Items whose icon is currently shown. */
  get shown(): string[] {
    return [...this.icons.keys()];
  }

  private update(): void {
    const { game } = this.ctx;
    const off = game.economy.disconnectedSids();
    for (const sid of off) {
      const item = game.item(sid);
      if (!item) continue;
      const el = this.icons.get(sid);
      if (!el) {
        void this.create(sid);
        continue;
      }
      this.layer.placePoint(el, item.tileX + item.cols / 2, item.tileY + item.rows / 2);
    }
    for (const [sid, el] of this.icons) {
      if (!off.has(sid) || !game.item(sid)) {
        el.remove();
        this.icons.delete(sid);
      }
    }
    // reconnections after the initial load get the "house connected" bubble
    if (!this.first) {
      for (const sid of this.known) if (!off.has(sid) && game.item(sid)) void this.connected(sid);
    }
    this.known = new Set(off);
    this.first = false;
  }

  private async create(sid: string): Promise<void> {
    if (this.loading.has(sid)) return;
    this.loading.add(sid);
    try {
      const w = await Widget.create("Dollars", ICON_CLASS);
      if (!this.ctx.game.economy.disconnectedSids().has(sid)) return;
      const holder = document.createElement("div");
      holder.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none";
      holder.append(w.root);
      this.layer.el.append(holder);
      this.icons.set(sid, holder);
    } finally {
      this.loading.delete(sid);
    }
  }

  /** ItemObject.viewAttach(VIEW_CONNECTED_TO_ROAD_ID): a short bubble above the freshly connected item. */
  private async connected(sid: string): Promise<void> {
    const item = this.ctx.game.item(sid);
    if (!item) return;
    const w = await Widget.create("houses_info", "Event_Start_Income").catch(() => undefined);
    if (!w) return;
    w.find("Caption")?.setText(getText("TID_HOUSE_CONNECTED"), { fit: true });
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;transition:opacity .6s";
    holder.append(w.root);
    this.layer.el.append(holder);
    const stop = this.layer.onFrame(() => this.layer.placePoint(holder, item.tileX + item.cols / 2, item.tileY + item.rows / 2));
    setTimeout(() => (holder.style.opacity = "0"), 1800);
    setTimeout(() => {
      stop();
      holder.remove();
    }, 2500);
  }
}
