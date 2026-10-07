// Income feedback: floating "+coins" over the collected item (StateOnRent.giveDCCoins -> PointsAnimation, :1592-1611), one per
// affected house for commerces (the per-house particle), and the houses_info "Duplicate" badge when the double-rent prize applied
// (ParticleAnimation(mDoubleRentDO)). The original draws these in the map layer; here they ride the camera like the other overlays.
import { getText, t } from "../../gui/i18n";
import { Widget } from "../../gui/widget";
import type { UiContext } from "../context";
import type { MapLayer } from "./map-layer";

export class RentFx {
  constructor(private readonly ctx: UiContext, private readonly layer: MapLayer) {
    ctx.game.on("rent-collected", (e) => void this.show(e));
  }

  private async show(e: { sid: string; coins: number; exp: number; doubled: boolean; houses: Array<{ sid: string; coins: number }> }): Promise<void> {
    const { game } = this.ctx;
    const item = game.item(e.sid);
    if (!item) return;
    const targets = e.houses.length > 0 && item.isCommerce ? e.houses.map((h) => ({ sid: h.sid, coins: h.coins })) : [{ sid: e.sid, coins: e.coins }];
    for (const tg of targets) {
      const it = game.item(tg.sid);
      if (!it || tg.coins <= 0) continue;
      this.float(it.tileX, it.tileY, t("TID_POINTS_COINS", [`+${getText("TID_COIN_SYMBOL")}${tg.coins}`]), "#ffffff", "#249400", 0);
      if (e.doubled) void this.badge(it.tileX + it.cols / 2, it.tileY + it.rows / 2);
    }
    // StateOnRent.giveXP (:1020): PointsAnimation TYPE_XP at the item; the oracle (build-flow 14) shows it ~0.8 s after the coins.
    if (e.exp > 0) this.float(item.tileX, item.tileY, t("TID_POINTS_XP", [`+${e.exp}`]), "#ffffea", "#de8000", 800);
  }

  /**
   * PointsAnimation (utils/particles/PointsAnimation.as): HelveticaRounded 18, white (coins, green glow 0x249400) / 0xFFFFEA (xp, glow
   * 0xDE8000); starts at the item's L0 position and tweens y - 60 and alpha -> 0.5 over 2 s (linear), then disappears.
   */
  private float(tx: number, ty: number, text: string, color: string, glow: string, delayMs: number): void {
    const el = document.createElement("div");
    el.textContent = text;
    const outline = Array.from({ length: 4 }, () => `drop-shadow(0 0 0.7px ${glow})`).join(" ");
    el.style.cssText =
      `position:absolute;left:0;top:0;transform-origin:0 0;font-family:'MC Helvetica Rounded Bd','Nunito',sans-serif;font-size:18px;color:${color};` +
      `filter:${outline};white-space:nowrap;pointer-events:none;display:none`;
    this.layer.el.append(el);
    setTimeout(() => {
      el.style.display = "";
      const t0 = performance.now();
      const stop = this.layer.onFrame(() => {
        const f = Math.min(1, (performance.now() - t0) / 2000);
        this.layer.placePoint(el, tx, ty, -60 * f);
        el.style.opacity = String(1 - 0.5 * f);
      });
      setTimeout(() => {
        stop();
        el.remove();
      }, 2000);
    }, delayMs);
  }

  private async badge(tx: number, ty: number): Promise<void> {
    const w = await Widget.create("houses_info", "Duplicate").catch(() => undefined);
    if (!w) return;
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;transition:opacity .5s";
    holder.append(w.root);
    this.layer.el.append(holder);
    const stop = this.layer.onFrame(() => this.layer.placePoint(holder, tx, ty, -20));
    setTimeout(() => (holder.style.opacity = "0"), 1100);
    setTimeout(() => {
      stop();
      holder.remove();
    }, 1700);
  }
}
