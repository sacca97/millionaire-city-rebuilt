/**
 * Selected-item context actions. The original opens the contract popup straight from a click on an item waiting for a contract
 * (StateOnRent MODE_WAITING_FOR_CONTRACT) and collects ready rent on click (Game.activateTile does the latter). This bar adds
 * explicit entry points: Collect, Sign contract (-> uiBus 'openContract'), Move (Game.startMove) and Sell (two-step confirm).
 */
import { fontCss, fontSpecFor } from "../../gui/fontmap";
import { getText } from "../../gui/i18n";
import { TILE } from "../../game/geometry";
import type { GameItem } from "../../game/game";
import { RENT_MODE, STATE_ID } from "../../net/commands";
import { uiBus } from "../bus";
import type { UiContext } from "../context";

export type ActionId = "collect" | "contract" | "move" | "sell";

/** Pure: which actions an item offers. */
export function actionsFor(item: Pick<GameItem, "stateId" | "mode" | "isCommerce">, destroyable: boolean): ActionId[] {
  const out: ActionId[] = [];
  if (item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.GET_RENT && !item.isCommerce) out.push("collect");
  if (item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.WAITING_FOR_CONTRACT) out.push("contract");
  if (item.stateId === STATE_ID.RENT || item.stateId === STATE_ID.CONSTRUCTION || item.stateId === STATE_ID.BUILT) out.push("move");
  if (destroyable) out.push("sell");
  return out;
}

const BTN = `pointer-events:auto;cursor:pointer;box-sizing:border-box;padding:4px 9px;margin:0 2px;background:#fff08d;border:3px solid #992f00;border-radius:10px;color:#4b1400;${fontCss(fontSpecFor("HelveticaRounded LT Std Bd"), 12)}`;

/**
 * The original has no floating Collect/Contract/Move/Destroy bar: selecting an item only shows the yellow frame (+ the hover box); rent is collected
 * and contracts are signed by clicking the item, move/sell go through the toolbar tools (oracle build-flow 09/13/14). Kept behind a flag.
 */
const SHOW_ACTION_BAR = false;

export class ContextActions {
  readonly el: HTMLElement;
  private sid: string | null = null;
  private sellArmed = 0;
  private raf = 0;

  constructor(private readonly ctx: UiContext) {
    this.el = document.createElement("div");
    this.el.className = "mc-actions";
    this.el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;display:none;white-space:nowrap;z-index:40";
    ctx.game.on("selection", (it) => this.onSelect(it));
    ctx.game.on("item-changed", (it) => it.sid === this.sid && this.render());
    ctx.game.on("item-removed", ({ sid }) => sid === this.sid && this.clear());
    ctx.game.on("tool", (t) => t.kind !== "select" && this.clear());
  }

  private onSelect(it: GameItem | null): void {
    if (!it) return this.clear();
    this.sid = it.sid;
    this.sellArmed = 0;
    // Clicking a house waiting for a contract opens the contract popup (StateOnRent click handler).
    if (it.stateId === STATE_ID.RENT && it.mode === RENT_MODE.WAITING_FOR_CONTRACT) uiBus.emit("openContract", { sid: it.sid });
    this.render();
    if (!this.raf) this.raf = requestAnimationFrame(() => this.follow());
  }

  private clear(): void {
    this.sid = null;
    this.el.style.display = "none";
    this.el.replaceChildren();
  }

  private render(): void {
    const { game } = this.ctx;
    const item = this.sid ? game.item(this.sid) : undefined;
    if (!item || !SHOW_ACTION_BAR) return this.clear();
    const acts = actionsFor(item, game.isDestroyable(item));
    if (acts.length === 0) return this.clear();
    const label: Record<ActionId, string> = {
      collect: getText("TID_HINT_BUTTON_COLLECT"),
      contract: getText("TID_BUTTON_CONTRACT"),
      move: getText("TID_HINT_BUTTON_MOVE"),
      sell: this.sellArmed ? `${getText("TID_HINT_MENU_BUTTON_DEMOLISH")}? +${game.sellPrice(item)}` : getText("TID_HINT_MENU_BUTTON_DEMOLISH"),
    };
    this.el.replaceChildren(
      ...acts.map((a) => {
        const b = document.createElement("button");
        b.style.cssText = BTN;
        b.textContent = label[a];
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.run(a, item);
        });
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        return b;
      }),
    );
    this.el.style.display = "";
    this.place(item);
  }

  private run(a: ActionId, item: GameItem): void {
    const { game } = this.ctx;
    switch (a) {
      case "collect":
        game.collectRent(item.sid);
        break;
      case "contract":
        uiBus.emit("openContract", { sid: item.sid });
        break;
      case "move":
        game.startMove(item.sid);
        break;
      case "sell":
        if (!this.sellArmed || performance.now() - this.sellArmed > 4000) {
          this.sellArmed = performance.now();
          this.render();
        } else {
          this.sellArmed = 0;
          game.sellItem(item.sid);
        }
        break;
    }
  }

  private place(item: GameItem): void {
    const w = this.ctx.city.world;
    const k = w.scale.x;
    const cx = w.x + (item.tileX + item.cols / 2) * TILE * k;
    const top = w.y + item.tileY * TILE * k;
    const width = this.el.offsetWidth;
    this.el.style.transform = `translate(${Math.round(Math.max(4, Math.min(window.innerWidth - width - 4, cx - width / 2)))}px,${Math.round(Math.max(4, top - 34))}px)`;
  }

  private follow(): void {
    this.raf = 0;
    const item = this.sid ? this.ctx.game.item(this.sid) : undefined;
    if (!item) return;
    this.place(item);
    this.raf = requestAnimationFrame(() => this.follow());
  }
}
