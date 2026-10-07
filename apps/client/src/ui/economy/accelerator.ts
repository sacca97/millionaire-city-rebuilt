// Rent accelerator tool (map/tools/ToolRentAccelerator.as): a stored accelerator (giftDefinitions.xml fgift_* with
// action="rentAccelerator", value = percent) turns the pointer into the RentAcceleratorCursor with the "<percent>%" label; a click on a
// house that is renting (StateOnRent.canBeAccelerated) shortens its remaining rent time by that percentage of the contract time
// (Game.accelerate -> update_money rentAccelerator {sku,itemSid}). Houses that cannot be accelerated show the NoAction cursor.
// The tool ends when the stack is used up, on Escape / right click, or when another map tool is chosen (setToolToSelect).
import { getText } from "../../gui/i18n";
import { Widget } from "../../gui/widget";
import type { UiContext } from "../context";
import { uiBus } from "../bus";

const CLS = "com.dchoc.framework.utils.AssetManager_";

export interface AcceleratorOrder {
  /** Storage entry (the gift type, e.g. rentAcc30; fgift_NNN is looked up in giftDefinitions.xml). */
  sku: string;
  /** Percent of the contract time removed (giftDefinitions value). */
  percent: number;
  /** Stored units (the tool ends when they are used). */
  amount: number;
}

/** "rentAcc30" -> 30. */
export const percentFromGiftType = (type: string): number => Number(/\d+/.exec(type)?.[0] ?? 0);

/** giftDefinitions.xml: storage sku (giftType) -> definition sku + percent (FreeGiftDefinition value). */
export function parseAcceleratorGifts(xml: string): Map<string, { giftSku: string; percent: number }> {
  const out = new Map<string, { giftSku: string; percent: number }>();
  for (const m of xml.matchAll(/<Definition\s+([^>]*?)\/?>/g)) {
    const attr = (k: string): string | undefined => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1])?.[1];
    if (attr("action") === "rentAccelerator" && attr("sku") && attr("giftType")) out.set(attr("giftType") as string, { giftSku: attr("sku") as string, percent: Number(attr("value") ?? 0) });
  }
  return out;
}

export class AcceleratorTool {
  private order: (AcceleratorOrder & { left: number; giftSku: string }) | undefined;
  private gifts: Promise<Map<string, { giftSku: string; percent: number }>> | undefined;
  private readonly cursor = document.createElement("div");
  private widgets = new Map<"ok" | "no", Widget>();
  private shown: "ok" | "no" | undefined;
  private pos = { x: 0, y: 0, onMap: false };

  constructor(private readonly ctx: UiContext) {
    this.cursor.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:99998;display:none";
    ctx.root.append(this.cursor);
    uiBus.on("startAccelerator", (o) => this.start(o));
    window.addEventListener("pointermove", (e) => {
      this.pos = { x: e.clientX, y: e.clientY, onMap: e.target instanceof HTMLCanvasElement };
      this.updateCursor();
    });
    window.addEventListener(
      "pointerup",
      (e) => {
        if (!this.order || !(e.target instanceof HTMLCanvasElement)) return;
        if (e.button === 2) return this.stop();
        const tile = ctx.city.pointerToTile(e.clientX, e.clientY);
        const item = ctx.game.itemAtTile(tile.x, tile.y);
        if (item) this.apply(item.sid);
      },
      true
    );
    window.addEventListener("contextmenu", (e) => {
      if (this.order) {
        e.preventDefault();
        this.stop();
      }
    });
    window.addEventListener("keydown", (e) => e.key === "Escape" && this.stop());
    ctx.game.on("tool", (t) => t.kind !== "select" && this.stop());
  }

  get active(): AcceleratorOrder | undefined {
    return this.order && { sku: this.order.sku, percent: this.order.percent, amount: this.order.left };
  }

  start(o: AcceleratorOrder): void {
    if (o.amount <= 0) return;
    this.gifts ??= fetch("/mcity/0.501/Datas/rules/giftDefinitions.xml").then((r) => r.text()).then(parseAcceleratorGifts);
    void this.gifts.then((g) => {
      const gift = g.get(o.sku);
      const percent = gift?.percent || o.percent;
      if (percent <= 0) return;
      this.ctx.game.setTool({ kind: "select" });
      this.order = { ...o, percent, giftSku: gift?.giftSku ?? o.sku, left: o.amount };
      this.shown = undefined;
      document.querySelector("canvas")?.style.setProperty("cursor", "none");
      this.updateCursor();
    });
  }

  stop(): void {
    this.order = undefined;
    this.cursor.style.display = "none";
    document.querySelector("canvas")?.style.removeProperty("cursor");
  }

  /** ToolRentAccelerator.doReportMouseUp. Returns whether the accelerator was used. */
  apply(sid: string): boolean {
    const o = this.order;
    if (!o || !this.ctx.game.canAccelerate(sid)) return false;
    if (!this.ctx.game.accelerate(sid, o.giftSku, o.percent, o.sku)) return false;
    o.left -= 1;
    if (o.left <= 0) this.stop(); // StorageManager.getItem(sku) == null -> setToolToSelect
    else this.updateCursor();
    return true;
  }

  private async widget(kind: "ok" | "no"): Promise<Widget> {
    let w = this.widgets.get(kind);
    if (!w) {
      w = await Widget.create("Dollars", CLS + (kind === "ok" ? "RentAcceleratorCursor" : "RentAcceleratorNoActionCursor"));
      this.widgets.set(kind, w);
    }
    return w;
  }

  private updateCursor(): void {
    const o = this.order;
    if (!o || !this.pos.onMap) {
      this.cursor.style.display = "none";
      return;
    }
    this.cursor.style.display = "";
    this.cursor.style.transform = `translate(${this.pos.x}px,${this.pos.y}px)`;
    // reportMouseMove (:64-80): NoAction cursor over an item that cannot be accelerated
    const tile = this.ctx.city.pointerToTile(this.pos.x, this.pos.y);
    const item = this.ctx.game.itemAtTile(tile.x, tile.y);
    const kind: "ok" | "no" = item && !this.ctx.game.canAccelerate(item.sid) ? "no" : "ok";
    if (kind !== this.shown) {
      this.shown = kind;
      void this.widget(kind).then((w) => {
        if (this.shown !== kind || !this.order) return;
        w.find("label")?.setText(`${o.percent}%`, { rich: false });
        this.cursor.replaceChildren(w.root);
      });
    }
  }

  /** Tooltip text of the tool (Cursor label). */
  get label(): string {
    return this.order ? `${this.order.percent}%` : getText("TID_HINT_VALUE");
  }
}
