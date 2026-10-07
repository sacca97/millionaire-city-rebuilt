/** Toasts for game.on('toast') (info/error/coins/xp/levelUp), stacked under the HUD, fading after a few seconds. */
import { fontCss, fontSpecFor } from "../../gui/fontmap";
import type { ToastEvent } from "../../game/game";
import { uiBus } from "../bus";
import type { UiContext } from "../context";

const COLORS: Record<ToastEvent["kind"], { bg: string; fg: string; border: string }> = {
  info: { bg: "#fff08d", fg: "#4b1400", border: "#992f00" },
  error: { bg: "#ffd2c8", fg: "#8a0000", border: "#b21e00" },
  coins: { bg: "#e6ffc2", fg: "#1f4b00", border: "#4d8a00" },
  xp: { bg: "#d6ecff", fg: "#00304b", border: "#2f6e99" },
  levelUp: { bg: "#ffe27a", fg: "#4b1400", border: "#d17a00" },
};

export class Toasts {
  readonly el: HTMLElement;
  constructor(ctx: UiContext) {
    this.el = document.createElement("div");
    this.el.className = "mc-toasts";
    this.el.style.cssText = "position:absolute;left:0;right:0;top:110px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none;z-index:60";
    ctx.game.on("toast", (e) => this.push(e));
    // Level-up: the full popup is the popups area's job; the HUD only forwards the event.
    ctx.game.on("levelUp", (e) => uiBus.emit("levelUp", e));
  }

  push(e: ToastEvent, ms = 3500): void {
    const c = COLORS[e.kind];
    const d = document.createElement("div");
    d.textContent = e.text;
    d.style.cssText = `padding:5px 12px;border-radius:10px;border:3px solid ${c.border};background:${c.bg};color:${c.fg};${fontCss(fontSpecFor("HelveticaRounded LT Std Bd"), 14)};transition:opacity .5s,transform .5s;opacity:0;transform:translateY(-8px)`;
    this.el.appendChild(d);
    requestAnimationFrame(() => {
      d.style.opacity = "1";
      d.style.transform = "none";
    });
    window.setTimeout(() => {
      d.style.opacity = "0";
      window.setTimeout(() => d.remove(), 500);
    }, ms);
    while (this.el.childElementCount > 4) this.el.firstElementChild?.remove();
  }
}
