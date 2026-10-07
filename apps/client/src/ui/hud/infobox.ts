/**
 * Item hover info boxes, port of GUI/InfoBox*.as / BuildingsPopup + StateOnRent.doInfoBoxGetBox (StateOnRent.as:1008-1031) on
 * houses_info.swf: house/commerce while renting (name, income, XP, tenants, time left + fill bar), "wonder" box for a house
 * waiting for a contract, "empty" box for abandoned houses, construction box (time left), decoration box (houses bonus).
 * Shown on mouse over (zoom 0.75 -> 1 at 0.15/frame, BuildingsPopup.zoomIn), flipped to the left box near the screen edge.
 */
import { getIncomeValue, getIncomeXP } from "@mcity/rules";
import { convertNumberToString, convertTimeToString, TRUNCATE_THOUSAND } from "../../gui/format";
import { getText, t } from "../../gui/i18n";
import { ProgressBar } from "../../gui/progress";
import { Widget } from "../../gui/widget";
import { TILE } from "../../game/geometry";
import type { GameItem } from "../../game/game";
import { RENT_MODE, STATE_ID } from "../../net/commands";
import type { UiContext } from "../context";
import type { PointerTracker } from "./cursor";

export type InfoKind = "rivalCommerce" | "rivalWonder" | "house" | "commerce" | "wonder" | "abandoned" | "construction" | "decoration" | "none";

/** Which box applies (StateOnRent.isInfoBoxAllowed / doInfoBoxGetBox, StateOnConstructionOwner). */
export function infoKindFor(item: Pick<GameItem, "stateId" | "mode" | "isCommerce"> & { kind?: string; suspended?: boolean }): InfoKind {
  if (item.kind === "decoration") return "decoration";
  // StateOnIA.doInfoBoxGetBox (:309-326): commerce -> InfoBoxCommerceRival, otherwise InfoBoxWonder (MODE_IN_SALE only).
  if (item.stateId === STATE_ID.IA && item.suspended && item.mode === 2) return "abandoned"; // StateOnIA.doInfoBoxGetBox: InfoBoxAbandoned (disconnected)
  if (item.stateId === STATE_ID.IA) return item.mode === 2 ? (item.isCommerce ? "rivalCommerce" : "rivalWonder") : "none";
  // StateOnRent.doInfoBoxGetBox (:1125): a suspended (not HQ-connected) item shows InfoBoxAbandoned with the disconnected texts.
  if (item.suspended && item.stateId === STATE_ID.RENT && (item.mode === RENT_MODE.WAITING_FOR_CONTRACT || item.mode === RENT_MODE.RENTING)) return "abandoned";
  if (item.stateId === STATE_ID.CONSTRUCTION) return "construction";
  if (item.stateId !== STATE_ID.RENT) return "none";
  if (item.mode === RENT_MODE.WAITING_FOR_CONTRACT) return item.isCommerce ? "commerce" : "wonder";
  if (item.mode === RENT_MODE.ABANDONED) return "abandoned";
  if (item.mode === RENT_MODE.RENTING || item.mode === RENT_MODE.GET_RENT) return item.isCommerce ? "commerce" : "house";
  return "none";
}

const CLASS: Record<Exclude<InfoKind, "none">, string> = {
  house: "popup_info_house",
  commerce: "popup_info_commerce",
  wonder: "popup_info_wonder",
  rivalCommerce: "popup_info_commerce",
  rivalWonder: "popup_info_wonder",
  abandoned: "popup_info_house",
  construction: "popup_info_building",
  decoration: "popup_info_decorations",
};
const SUFFIX: Record<string, string> = { abandoned: "_empty", rivalCommerce: "_sell" };

/** Fill fraction numerator: elapsed time out of the total (InfoBox.setTimer: setValueWithoutBarAnimation(time2 - time)). */
export function elapsed(total: number, left: number): number {
  return Math.max(0, Math.min(total, total - left));
}

export class InfoBox {
  readonly el: HTMLElement;
  private cache = new Map<string, Widget>();
  private current?: { w: Widget; kind: InfoKind; sid: string; side: "left" | "right"; bar?: ProgressBar };
  private shownSince = 0;
  private timer = 0;

  constructor(private readonly ctx: UiContext, pointer: PointerTracker) {
    this.el = document.createElement("div");
    this.el.className = "mc-infobox";
    this.el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:50";
    pointer.onChange((i) => void this.onPointer(i.item, i.onMap));
    ctx.game.on("item-changed", (it) => {
      if (this.current?.sid === it.sid) void this.show(it);
    });
    ctx.game.on("item-removed", () => this.hide());
    this.timer = window.setInterval(() => this.refresh(), 250);
    ctx.game.on("tool", () => this.hide());
  }

  private async onPointer(item: GameItem | undefined, onMap: boolean): Promise<void> {
    if (!onMap || !item || this.ctx.game.tool.kind !== "select" && this.ctx.game.tool.kind !== "move") return this.hide();
    if (this.current?.sid === item.sid && this.infoKind(item) === this.current.kind) return;
    await this.show(item);
  }

  private infoKind(item: GameItem): InfoKind {
    return infoKindFor({ ...item, kind: item.def?.rules.kind });
  }

  private async widgetFor(kind: Exclude<InfoKind, "none">, side: "left" | "right"): Promise<Widget> {
    const cls = `${CLASS[kind]}_${side}${SUFFIX[kind] ?? ""}`;
    let w = this.cache.get(cls);
    if (!w) {
      w = await Widget.create("houses_info", cls);
      this.cache.set(cls, w);
    }
    return w;
  }

  async show(item: GameItem): Promise<void> {
    const kind = this.infoKind(item);
    if (kind === "none") return this.hide();
    // Right box unless it would leave the screen (BuildingsPopup.show: boxX + width > stageWidth -> left box at boxX - boxW).
    const k = this.ctx.city.world.scale.x;
    const sx = this.ctx.city.world.x + item.tileX * TILE * k;
    const sy = this.ctx.city.world.y + item.tileY * TILE * k;
    const iw = item.cols * TILE * k;
    const rightX = sx + iw;
    const side: "left" | "right" = rightX + 235 > window.innerWidth ? "left" : "right";
    const w = await this.widgetFor(kind, side);
    this.el.replaceChildren(w.root);
    const bar = w.find("FillBar") ? new ProgressBar(w.part("FillBar"), 0, 1) : undefined;
    this.current = { w, kind, sid: item.sid, side, bar };
    this.fill(item);
    // InfoBox.show :137-141: left box -> x = param2 - param4 (= the item's left edge); the left clip's origin is its tail tip (oracle rival-hover).
    const x = side === "right" ? rightX : sx;
    this.el.style.transform = `translate(${Math.round(x)}px,${Math.round(sy + (item.rows * TILE * k) / 2)}px)`;
    this.el.style.display = "";
    this.shownSince = performance.now();
    this.zoomIn();
  }

  hide(): void {
    this.current = undefined;
    this.el.style.display = "none";
  }

  private zoomIn(): void {
    // 0.75 -> 1 in 0.15 steps per frame
    let s = 0.75;
    const step = (): void => {
      s = Math.min(1, s + 0.15);
      this.el.firstElementChild && ((this.el.firstElementChild as HTMLElement).style.scale = String(s));
      if (s < 1) requestAnimationFrame(step);
    };
    const root = this.el.firstElementChild as HTMLElement | null;
    if (root) root.style.transformOrigin = "0 0";
    step();
  }

  /** Static + live fields (InfoBox.updateInfo / setExp / setIncome / setAttendance / setTimer). */
  private fill(item: GameItem): void {
    const c = this.current;
    if (!c) return;
    const { w, kind } = c;
    const rules = this.ctx.game.rules;
    const def = item.def;
    const name = def.attrs.tid ? getText(def.attrs.tid) : item.sku;
    const set = (n: string, s: string) => w.find(n)?.setText(s, { rich: false });
    set("TopText", name);
    const contract = item.contractSku !== undefined ? rules.contracts.get(String(item.contractSku)) : undefined;
    const money = (v: number) => getText("TID_COIN_SYMBOL") + convertNumberToString(v, TRUNCATE_THOUSAND, 6);
    switch (kind) {
      case "house": {
        set("Status", getText("TID_CURRENT_STATUS"));
        // ItemObject.getIncomeValue includes the influence of the decorations/wonders (economy model).
        const income = getIncomeValue({ def: def.rules, contract, influenceValue: this.ctx.game.economy.influencePercent(item.sid) });
        const xp = getIncomeXP(def.rules, contract);
        set("DailyIncomeMoney", money(income));
        set("DailyXP", t("TID_POINTS_XP", [String(xp)]));
        w.find("DailyXP")?.setTextColor(xp === 0 ? "#ff0000" : "");
        set("attendance_number", String(def.attrs.tenants ?? 0));
        break;
      }
      case "commerce": {
        set("Income_Bonus", getText("TID_SHOP_RENT"));
        set("attendance", getText("TID_ATTENDANCE"));
        // StateOnRent.as:1330-1340: setIncome(getIncomeValue(true)) and setAttendance(getPopulation()).
        const eco = this.ctx.game.economy;
        set("DailyIncomeMoney", money(eco.commerceInfoIncome(item)));
        set("attendance_number", String(eco.population(item.sid)));
        break;
      }
      case "rivalCommerce": {
        // InfoBoxCommerceRival.updateInfo/setUpBox/setIncome/setAttendance (:35-118): a rival has no contract/customers -> $0 and 0 in red.
        set("Income_Bonus", getText("TID_SHOP_RENT"));
        set("Income_Time", getText("TID_SHOP_RENT_TIME"));
        set("attendance", getText("TID_ATTENDANCE"));
        set("DailyIncomeMoney", money(0));
        w.find("DailyIncomeMoney")?.setTextColor("#ff0000");
        set("attendance_number", "0");
        w.find("attendance_number")?.setTextColor("#ff0000");
        set("IncomeIn", convertTimeToString(def.rules.incomeTimeMs, true));
        break;
      }
      case "rivalWonder":
      case "wonder": {
        // InfoBoxWonder.setUpBox (:35-70): TopText = item name, Text = TextIDs[getTidDescription()] (<tid>_DESCRIPTION). The oracle (build-flow
        // 09) shows the Bungalow description for a house waiting for a contract, not "Select Contract" (that is a setCustomText case).
        const descKey = def.attrs.tid ? `${def.attrs.tid}_DESCRIPTION` : "";
        set("Text", descKey && getText(descKey) !== descKey ? getText(descKey) : getText("TID_CONTRACT_POPUP_TITLE"));
        break;
      }
      case "abandoned":
        if (item.suspended) set("Text", `${getText("TID_DISCONNECTED_HOUSE")}\n${getText("TID_DISCONNECTED_SOLUTION")}`);
        else set("Text", `${getText("TID_ABANDONED_HOUSE")}\n${getText("TID_ABANDONED_HOUSE_RESET")}`);
        break;
      case "decoration": {
        const pct = `+${convertNumberToString(def.rules.influenceValue ?? 0, 0, 0)}`;
        set("DailyIncome", getText("TID_DECORATION_INFO_HOUSES_BONUS"));
        set("DailyIncomeMoney", t("TID_GEN_PERCENTAGE", [pct]));
        break;
      }
      default:
        break;
    }
    this.refresh();
  }

  /** Live timer + fill bar (setTimer is called every logic update while the mouse is over). */
  private refresh(): void {
    const c = this.current;
    if (!c) return;
    if (c.kind === "rivalCommerce" || c.kind === "rivalWonder") return; // static box; the rival is not a game item
    const item = this.ctx.game.item(c.sid);
    if (!item) return this.hide();
    const newKind = this.infoKind(item);
    if (newKind !== c.kind) {
      void this.show(item);
      return;
    }
    if (c.kind === "commerce") {
      // the population (and so the income) changes while the box is open (StateOnRent.as:1337-1340)
      const eco = this.ctx.game.economy;
      c.w.find("attendance_number")?.setText(String(eco.population(item.sid)), { rich: false });
      c.w.find("DailyIncomeMoney")?.setText(getText("TID_COIN_SYMBOL") + convertNumberToString(eco.commerceInfoIncome(item), TRUNCATE_THOUSAND, 6), { rich: false });
    }
    if (c.kind === "construction" || c.kind === "house" || c.kind === "commerce") {
      const total = c.kind === "construction" ? Number(item.def.attrs.constructionTime ?? 0) * 60000 : item.incomeMs || item.def.rules.incomeTimeMs;
      const left = item.mode === RENT_MODE.GET_RENT && c.kind !== "construction" ? 0 : item.time;
      c.w.find("IncomeIn")?.setText(convertTimeToString(left, false, true), { rich: false });
      if (c.bar && total > 0) c.bar.setRange(0, total).setValue(elapsed(total, left), false);
    }
  }

  destroy(): void {
    window.clearInterval(this.timer);
    this.el.remove();
  }
}
