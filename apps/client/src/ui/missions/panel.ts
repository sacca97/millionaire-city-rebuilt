// MissionsBox (containers/MissionsBox.as) + MissionItem (containers/MissionItem.as): the paged mission list.
// Layout constants and per-state visibility are ported from setUpInfo (:206-269); sorting/preview rules live in
// MissionManager.getMissions.
import { Button } from "../../gui/button";
import { getText } from "../../gui/i18n";
import { Popup } from "../../gui/popup";
import { Widget, type Part } from "../../gui/widget";
import { STATE_LOCKED, STATE_REACHED, STATE_UNLOCKED, showsProgress, type MissionObject } from "../../game/missions";
import type { UiContext } from "../context";
import { ClipPlayer } from "../extras/clip";
import { FrameClip } from "../hud/util";
import {
  ITEMS_PER_PAGE,
  MISSION_ICON_URL,
  SCROLL_STEP,
  SKU,
  TITLE_COLOR,
  XINIT,
  XOFFSET,
  YINIT,
  YOFFSET,
  itemFrame,
  itemTitle,
  lockedText,
  pageCount
} from "./logic";
import type { MissionSystem } from "./system";

export interface PanelHooks {
  /** ReadMore: open the description popup of an unlocked mission (MissionsBox.showDescription). */
  onDescription(obj: MissionObject): Promise<void> | void;
  /** GetReward on a REACHED mission: apply it and show PopupReward (MissionsBox.applyReward). */
  onClaim(obj: MissionObject): Promise<void> | void;
}

const VIEW_X = XINIT - XOFFSET; // mScrollRect.x
const VIEW_Y = YINIT - 5;
const VIEW_H = YOFFSET * ITEMS_PER_PAGE;

/** One list row. */
async function buildItem(ctx: UiContext, sys: MissionSystem, obj: MissionObject, ordinal: number, hooks: PanelHooks): Promise<HTMLElement> {
  const boss = Number(ctx.game.state.profile.raw.bossGenre ?? 0) === 1 ? 2 : 1;
  const w = await Widget.create(SKU, `Mission_menu_ok_0${boss}`);
  const sprite = w.part("item");
  const iconPos = { x: sprite.node.children.find((c) => c.name === "icon")?.x ?? 20.65, y: sprite.node.children.find((c) => c.name === "icon")?.y ?? 35 };
  const nw = new Widget(w.layout, sprite.node.symbolId as unknown as string, { swf: SKU, frame: itemFrame(obj.state) });
  nw.root.style.transform = sprite.el.style.transform;
  sprite.el.replaceWith(nw.root);
  // mItem["item"]["icon"] hidden; the mission type bitmap is drawn at 0.8 around the icon centre (MissionItem.as:~52-60).
  nw.part("icon").hide();
  const img = document.createElement("img");
  img.src = `${MISSION_ICON_URL}${obj.def.eventType}.png`;
  img.draggable = false;
  img.className = "g-tex";
  const SIZE = 64 * 0.8;
  img.style.cssText = `left:0;top:0;width:${SIZE}px;height:${SIZE}px;transform:translate(${iconPos.x - SIZE / 2}px,${iconPos.y - SIZE / 2 - 5}px);`;
  nw.root.appendChild(img);

  for (const n of ["alert", "alert_ok"]) w.part(n).hide();
  const alertName = obj.alert === "newMission" ? "alert" : obj.alert === "missionReached" ? "alert_ok" : undefined;
  if (alertName) {
    const part = w.part(alertName);
    part.show();
    new FrameClip(SKU, part).loop(15);
  }

  const reward = new Button(w.part("GetReward")).setLabel(getText("TID_BUTTON_GET_REWARD"));
  const read = new Button(w.part("ReadMore")).setLabel(getText("TID_BUTTON_READ_MORE"));
  reward.setVisible(false);
  read.setVisible(false);
  // MissionItem.as:111-130: the first mission ("Name It") gets the bobbing AssetManager.SuperupgradeArrow (rotated 180 deg, scale 0.7) at
  // ReadMore.x - 40 while Profile.firstMission is set (removed by Read More).
  let missionArrow: HTMLElement | undefined;
  if (obj.def.eventType === "nameCity" && (sys.firstMission || obj.state === STATE_REACHED)) {
    const rm = w.part("ReadMore");
    void ClipPlayer.create("Dollars", "com.dchoc.framework.utils.AssetManager_SuperupgradeArrow", { loop: true, fps: 12 }).then((cp) => {
      cp.host.style.cssText += `;position:absolute;left:0;top:0;transform:translate(${rm.x - 40}px,${rm.y - 5}px) rotate(180deg) scale(0.7)`;
      w.root.appendChild(cp.host);
      missionArrow = cp.host;
      void cp.play();
    });
  }
  w.hide("BoxPercent");
  const locked = w.part("locked");
  locked.hide();
  let title = itemTitle(obj, ordinal);
  let color: string = TITLE_COLOR.unlocked;
  if (obj.state === STATE_UNLOCKED) {
    if (showsProgress(obj.def)) {
      w.show("BoxPercent");
      w.part("BoxPercent").get("Numbers").setText(obj.progressAsString());
    }
    read.setVisible(true);
    read.onClick(() => {
      missionArrow?.remove();
      void hooks.onDescription(obj);
    });
  } else if (obj.state === STATE_REACHED) {
    color = TITLE_COLOR.reached;
    reward.setVisible(true);
    reward.onClick(() => {
      reward.disable();
      void hooks.onClaim(obj);
    });
  } else if (obj.state === STATE_LOCKED) {
    locked.show();
    locked.get("Locked").setText(lockedText(obj, sys.manager.getMissionsGivenCount()));
  }
  w.part("TextInfo").setText(title, { fit: true, rich: false }).setTextColor(color);
  title = "";
  return w.root;
}

/** The Missions popup. */
export class MissionsPanel {
  private popup!: Popup;
  private w!: Widget;
  private viewport!: HTMLElement;
  private strip!: HTMLElement;
  private page = 1;
  private pages = 1;
  private scrolling = false;
  private up!: Button;
  private down!: Button;
  private shown: MissionObject[] = [];
  private closed = false;
  private rendering = 0;

  private constructor(
    private readonly ctx: UiContext,
    private readonly sys: MissionSystem,
    private readonly hooks: PanelHooks
  ) {}

  static async open(ctx: UiContext, sys: MissionSystem, hooks: PanelHooks): Promise<MissionsPanel | undefined> {
    const p = new MissionsPanel(ctx, sys, hooks);
    await p.build();
    return p.closed ? undefined : p;
  }

  private async build(): Promise<void> {
    const { sys } = this;
    this.w = await Widget.create(SKU, "popup_missions_background_menu");
    const w = this.w;
    this.popup = new Popup(w);
    w.setText("Missions", getText("TID_HINT_MENU_BUTTON_MISSIONS"));
    this.popup.wireClose(new Button(w.part("mClose")));
    this.up = new Button(w.part("mArrowUp"));
    this.down = new Button(w.part("mArrowDown"));
    // AS wires mArrowUp -> scrollDown (previous page) and mArrowDown -> scrollUp (next page).
    this.up.onClick(() => this.scroll(-1));
    this.down.onClick(() => this.scroll(1));
    this.viewport = document.createElement("div");
    this.viewport.style.cssText = `position:absolute;left:0;top:0;transform:translate(${VIEW_X}px,${VIEW_Y}px);width:685px;height:${VIEW_H}px;overflow:hidden;pointer-events:none`;
    this.strip = document.createElement("div");
    this.strip.style.cssText = "position:absolute;left:0;top:0;transition:none;pointer-events:none";
    this.viewport.appendChild(this.strip);
    w.root.appendChild(this.viewport);
    await this.render();
    this.popup.on("close", () => {
      this.closed = true;
      // MissionItem.destroy -> setAlertID(-1): the "new" markers of the shown missions are cleared.
      sys.manager.clearAlerts(this.shown);
      sys.pushAlert();
      this.ctx.game.setTool({ kind: "select" });
    });
    this.popup.show();
  }

  /** MissionsBox.getItems: rebuild all rows from MissionObjectManager.getMissions(). */
  async render(): Promise<void> {
    const ticket = ++this.rendering;
    const list = this.sys.manager.getMissions();
    if (list.length === 0) {
      this.popup.close();
      return;
    }
    this.shown = list;
    this.sys.manager.markSeen(list);
    // ordinal of unlocked rows: counter over UNLOCKED + number of given missions + 1 (MissionsBox.getItems :~125).
    let ord = 0;
    const rows = await Promise.all(
      list.map(async (obj, i) => {
        const o = obj.state === STATE_UNLOCKED ? ord++ : 0;
        const el = await buildItem(this.ctx, this.sys, obj, o + this.sys.manager.getMissionsGivenCount() + 1, this.hooks);
        el.style.transform = `translate(${XOFFSET}px,${5 + i * YOFFSET}px)`;
        return el;
      })
    );
    if (ticket !== this.rendering) return;
    this.strip.replaceChildren(...rows);
    this.pages = pageCount(list.length);
    this.page = Math.min(this.page, this.pages);
    this.strip.style.transform = `translateY(${-(this.page - 1) * VIEW_H}px)`;
    this.updateArrows();
  }

  private updateArrows(): void {
    this.up.setEnabled(this.page > 1);
    this.down.setEnabled(this.page < this.pages);
  }

  /** scrollUp/scrollDown: one page (4 rows) with a SCROLL_STEP px/frame ease. */
  private scroll(dir: 1 | -1): void {
    if (this.scrolling) return;
    const target = this.page + dir;
    if (target < 1 || target > this.pages) return;
    this.scrolling = true;
    const from = -(this.page - 1) * VIEW_H;
    const to = -(target - 1) * VIEW_H;
    const frames = Math.ceil(VIEW_H / SCROLL_STEP);
    let f = 0;
    const tick = (): void => {
      f += 1;
      const y = f >= frames ? to : from + ((to - from) * f) / frames;
      this.strip.style.transform = `translateY(${y}px)`;
      if (f < frames) requestAnimationFrame(tick);
      else {
        this.page = target;
        this.scrolling = false;
        this.updateArrows();
      }
    };
    requestAnimationFrame(tick);
  }

  /** MissionsBox.searchMission: jump to the page holding `sku`. */
  showSku(sku: string): MissionObject | undefined {
    const i = this.shown.findIndex((m) => m.def.sku === sku);
    if (i < 0) return undefined;
    this.page = Math.floor(i / ITEMS_PER_PAGE) + 1;
    this.strip.style.transform = `translateY(${-(this.page - 1) * VIEW_H}px)`;
    this.updateArrows();
    return this.shown[i];
  }

  get isClosed(): boolean {
    return this.closed;
  }
  close(): void {
    this.popup.close();
  }
}

export type { Part };
