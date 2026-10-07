// PopupHireCrew (GUI/hireCrew/PopupHireCrew.as + CrewItemContent.as) and the crew counter above a club waiting for its crew
// (ItemObject mCrewIcon = crew_mechanics.swf friends_accepted "<n>/<total>", ItemObject.as:2269-2277 / updateCrew :2905).
// Flow: build a club -> state HIRE_CREW (mode HIRING) -> click -> popup with one box per job; each empty slot can be bought with
// gold (crewMechanicsDefinition goldPrice) or filled by a Facebook friend (TASK_CREW_REQUEST, not available offline);
// when every slot is filled the "Complete" button turns the club into a normal item (NotificationConstructionEnd.onAccept).
import { crewCaption, crewComplete, crewCompletePrice, crewSlots, STATE_HIRE_CREW, type CrewSlot } from "../../game/crew";
import { Button } from "../../gui/button";
import { getText } from "../../gui/i18n";
import { StandardPopup } from "../../gui/popups";
import { Widget } from "../../gui/widget";
import type { UiContext } from "../context";
import type { MapLayer } from "./map-layer";

let current: { sid: string; refresh: () => void } | undefined;

async function makeBox(ctx: UiContext, sid: string, slot: CrewSlot, workerTid: string, price: number): Promise<{ el: HTMLElement; destroy: () => void }> {
  const w = await Widget.create("crew_mechanics", "crew_box");
  const def = ctx.game.crewDefinition(sid)!;
  w.setText("caption", getText(slot.jobTid), { fit: true });
  const avatar = w.part("avatar");
  const footer = w.part("footer");
  const friend = w.part("friend_name");
  const extras: Button[] = [];
  if (slot.status === "free") {
    friend.hide();
    // silhouette avatar (FriendsManager.silhouette) + gold button in the footer slot
    const btn = new Button((await Widget.create("buttons", "button_gold_icon")).self);
    btn.setLabel(String(price));
    footer.hide();
    btn.moveTo(footer.x, footer.y);
    w.root.appendChild(btn.el);
    btn.onClick(() => {
      ctx.game.buyCrew(sid, [slot.index]);
    });
    extras.push(btn);
    // FriendsManager.silhouette: a neutral person outline in the avatar slot
    avatar.hide();
    const sil = document.createElement("div");
    sil.style.cssText = `position:absolute;left:${avatar.x}px;top:${avatar.y}px;width:50px;height:50px;pointer-events:none`;
    sil.innerHTML = '<svg viewBox="0 0 50 50" width="50" height="50"><circle cx="25" cy="16" r="10" fill="#b9c6d6"/><path d="M5 50 C5 34 15 29 25 29 C35 29 45 34 45 50 Z" fill="#b9c6d6"/></svg>';
    w.root.appendChild(sil);
  } else {
    footer.hide();
    friend.setText(slot.status === "bought" ? getText(workerTid) : slot.friend ?? "", { fit: true });
    friend.show();
    try {
      const pro = await Widget.create("crew_mechanics", "profesional");
      avatar.hide();
      pro.root.style.cssText += `;position:absolute;left:${avatar.x}px;top:${avatar.y}px;pointer-events:none`;
      w.root.appendChild(pro.root);
    } catch {
      /* art missing */
    }
  }
  void def;
  return { el: w.root, destroy: () => extras.forEach((b) => b.destroy?.()) };
}

/** PopupHireCrew: description + crew boxes (4 per row) + buy-all / hire-friends or Complete. */
export async function openHireCrew(ctx: UiContext, sid: string): Promise<void> {
  const { game } = ctx;
  const item = game.item(sid);
  const def = game.crewDefinition(sid);
  if (!item || !def || item.stateId !== STATE_HIRE_CREW || current) return;
  const body = document.createElement("div");
  body.style.cssText = "position:relative;font:800 14px 'Helvetica Rounded','Nunito',Arial,sans-serif;color:#013343;text-align:center";
  const desc = document.createElement("div");
  desc.style.cssText = "margin-bottom:10px;white-space:normal";
  const grid = document.createElement("div");
  grid.style.cssText = "position:relative";
  const footer = document.createElement("div");
  footer.style.cssText = "position:relative;height:56px";
  body.append(desc, grid, footer);
  const BOX_W = 129;
  const BOX_H = 156;
  const MARGIN = 10;
  const perRow = Math.min(4, def.jobs.length);
  const rows = Math.ceil(def.jobs.length / 4);
  const gridW = perRow * (BOX_W + MARGIN);
  desc.style.width = `${gridW}px`;
  grid.style.width = `${gridW}px`;
  grid.style.height = `${rows * (BOX_H + MARGIN)}px`;

  const popup = await StandardPopup.create(getText("TID_BUILDING_CLUB_01"), body, { w: Math.max(gridW, 340), h: 40 + 56 + rows * (BOX_H + MARGIN) });
  footer.style.width = `${Math.max(gridW, 340)}px`;
  desc.style.width = `${Math.max(gridW, 340)}px`;
  // PopupExtended.updateButtonsPosition: footer buttons evenly spread (max width 150)
  const addButton = (btn: Button, onClick?: () => void): void => {
    footerButtons.push(btn);
    footer.append(btn.el);
    if (onClick) btn.onClick(onClick);
    const n = footerButtons.length;
    const W = Math.max(gridW, 340);
    footerButtons.forEach((b, i) => {
      b.moveTo((W / (n + 1)) * (i + 1), 28);
    });
  };
  const footerButtons: Button[] = [];
  const destroyers: Array<() => void> = [];
  let rendering = 0;

  const render = async (): Promise<void> => {
    const it = game.item(sid);
    if (!it || it.stateId !== STATE_HIRE_CREW) {
      popup.close();
      return;
    }
    const ticket = ++rendering;
    const crew = it.crew ?? { invited: [], paid: [] };
    const done = crewComplete(def, crew);
    desc.textContent = getText(done ? "TID_CREW_01_HIRE_ACHIEVED" : "TID_CREW_01_HIRE_DESCRIPTION");
    destroyers.splice(0).forEach((d) => d());
    const boxes = await Promise.all(
      crewSlots(def, crew).map(async (slot) => ({ slot, box: await makeBox(ctx, sid, slot, def.workerTid, def.goldPrice) }))
    );
    if (ticket !== rendering) return;
    grid.replaceChildren();
    boxes.forEach(({ slot, box }) => {
      const col = slot.index % 4;
      const row = Math.floor(slot.index / 4);
      box.el.style.position = "absolute";
      box.el.style.left = `${BOX_W / 2 + (BOX_W + MARGIN) * col}px`;
      box.el.style.top = `${BOX_H / 2 + 8 + (BOX_H + MARGIN) * row}px`;
      grid.append(box.el);
      destroyers.push(box.destroy);
    });
    // footer buttons (drawButtons)
    for (const b of footerButtons.splice(0)) b.el.remove();
    if (done) {
      const completeBtn = new Button((await Widget.create("buttons", "button_possitive")).self);
      completeBtn.setLabel(getText("TID_COMPLETE"));
      addButton(completeBtn, () => {
        if (game.completeCrew(sid)) popup.close();
      });
    } else {
      const buyBtn = new Button((await Widget.create("buttons", "button_gold_icon")).self);
      buyBtn.setLabel(String(crewCompletePrice(def, crew)));
      addButton(buyBtn, () => game.buyCrew(sid));
      const hireBtn = new Button((await Widget.create("buttons", "button_possitive")).self);
      hireBtn.setLabel(getText("TID_HIRE_FRIENDS"));
      // TASK_CREW_REQUEST is a Facebook task (not available offline)
      hireBtn.disable();
      addButton(hireBtn);
    }
  };
  current = { sid, refresh: () => void render() };
  const off = game.on("item-changed", (it) => it.sid === sid && void render());
  const offProfile = game.on("profile", () => void render());
  popup.on("close", () => {
    off();
    offProfile();
    destroyers.splice(0).forEach((d) => d());
    current = undefined;
  });
  await render();
  popup.show();
}

/** Crew counter icon over clubs in HIRE_CREW state. */
export class CrewIcons {
  private readonly icons = new Map<string, { holder: HTMLElement; text: string; w?: Widget }>();

  constructor(private readonly ctx: UiContext, private readonly layer: MapLayer) {
    layer.onFrame(() => this.update());
  }

  private update(): void {
    const { game } = this.ctx;
    const live = new Set<string>();
    for (const it of game.items()) {
      if (it.stateId !== STATE_HIRE_CREW) continue;
      const def = game.crewDefinition(it.sid);
      if (!def) continue;
      live.add(it.sid);
      let ic = this.icons.get(it.sid);
      if (!ic) {
        const holder = document.createElement("div");
        holder.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none";
        this.layer.el.append(holder);
        ic = { holder, text: "" };
        this.icons.set(it.sid, ic);
        const made = ic;
        void Widget.create("crew_mechanics", "friends_accepted").then((w) => {
          made.w = w;
          made.holder.append(w.root);
          made.text = "";
        });
      }
      const text = crewCaption(def, it.crew ?? { invited: [], paid: [] });
      if (ic.w && ic.text !== text) {
        ic.text = text;
        ic.w.find("caption")?.setText(text, { fit: true, rich: false });
      }
      // ItemObject.as:2276: x = baseWidth/2, y = -baseHeight (above the building)
      this.layer.placePoint(ic.holder, it.tileX + it.cols / 2, it.tileY - it.rows / 2);
    }
    for (const [sid, ic] of this.icons) {
      if (!live.has(sid)) {
        ic.holder.remove();
        this.icons.delete(sid);
      }
    }
  }
}
