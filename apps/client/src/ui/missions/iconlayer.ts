// Left column of mission icons + advisor ("Click me!"), port of missions/iconLayer/MissionsIconLayerManager.as + MissionsIconLayerDisplay.as
// + MissionIcon.as. Icons are 64x64 PNGs (Assets/missions/icons/<eventType>.png, boss: cindy/ronald) added to the HUD layer at
// x = 5 (tween from 100, alpha 0 -> 1 in 0.8 s), y = 70 + slot * 64. At most 4 unlocked missions are shown (ICON_LIST_SIZE), the advisor
// icon sits in the slot below the last mission (moveIcon(null, listSize)); clicking a mission opens its description, the advisor opens
// the missions box (ToolsBar.setToolMissions). Labels (missions_layout `new` / `progress` / `clickme`) slide in next to the icon.
import { getText } from "../../gui/i18n";
import { popups } from "../../gui/popup";
import { Widget } from "../../gui/widget";
import { STATE_LOCKED, STATE_UNLOCKED, type MissionObject } from "../../game/missions";
import { uiBus } from "../bus";
import type { UiContext } from "../context";
import { MISSION_ICON_URL, missionTitle } from "./logic";
import type { MissionSystem } from "./system";

/** TextField.autoSize = LEFT + wordWrap = false: one line, as wide as the text. */
function noWrap(part: { el: HTMLElement }): void {
  const box = part.el.querySelector<HTMLElement>(":scope > .g-text");
  if (!box) return;
  box.style.width = "auto";
  box.style.whiteSpace = "nowrap";
  box.style.overflow = "visible";
  const span = box.firstElementChild as HTMLElement | null;
  if (span) {
    span.style.whiteSpace = "nowrap";
    span.style.width = "auto";
  }
}

const ICON_SIZE = 64;
const ICON_LIST_SIZE = 4;
const SLOT_Y = 70;
const LABEL_OFFSET = 15;
const HEURISTIC_STATE_WEIGHT = 100000000; // MissionObject.as:16
const STATE_COUNT = 4;

/**
 * MissionObject.calculateHeuristic (:192-206): lower sorts first. The decompiled switch shows `case STATE_LOCKED: h *= STATE_COUNT; break;`
 * but the oracle (hud-tour 01-hud) displays LOCKED missions (askForHelp #3, buyExpansion #4, the two "Pimp the House" bonus missions with
 * progress) ahead of the unlocked ones, i.e. the locked weight is 4 * STATE_LOCKED(0) = 0 (fall-through into `h *= state`).
 */
export function heuristic(obj: { state: number; progressAsPercentage(): number; def: { sku: string } }): number {
  let h = HEURISTIC_STATE_WEIGHT;
  h *= obj.state === STATE_LOCKED ? STATE_COUNT * STATE_LOCKED : obj.state;
  h += (99 - Math.trunc((obj.progressAsPercentage() * 99) / 100)) * 1000000;
  h += parseInt(obj.def.sku, 10) || 0;
  return h;
}

/** MissionsIconLayerManager.updateIconList as a pure function: the new `current` slot array and the size of the shown list. */
export function planIcons<T extends { state: number }>(
  all: T[],
  sortKey: (m: T) => number,
  prevSize: number
): { list: T[]; size: number } {
  const list = [...all].sort((a, b) => sortKey(a) - sortKey(b));
  let unlocked = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].state > STATE_UNLOCKED) {
      list.splice(i, 1);
      i -= 1;
    } else if (list[i].state === STATE_UNLOCKED) unlocked += 1;
  }
  let size = prevSize;
  if (size !== unlocked && unlocked <= ICON_LIST_SIZE) size = Math.min(unlocked, list.length);
  return { list, size };
}

interface Icon {
  mission: MissionObject | null;
  el: HTMLElement;
  img: HTMLImageElement;
  slot: number;
  progress: number;
  label?: { el: HTMLElement; timers: number[] };
  arrow?: HTMLElement;
  tip?: Widget;
}

export async function mountIconLayer(ctx: UiContext, sys: MissionSystem, describe: (m: MissionObject) => Promise<void> | void): Promise<void> {
  const layer = document.createElement("div");
  layer.className = "mc-mission-icons";
  layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:4";
  // The original adds the icons to the HUD at x = 5 of a 760 px stage; on a wider window the virtual stage is centred like the rest of the HUD.
  const place = (): void => void (layer.style.transform = `translateX(${Math.max(0, Math.round((window.innerWidth - 760) / 2))}px)`);
  place();
  window.addEventListener("resize", place);
  ctx.root.appendChild(layer);
  uiBus.on("visitorChrome", ({ on }) => void (layer.style.display = on ? "none" : "")); // RoleVisitor: no mission icons (oracle compare4 visit)
  const mgr = sys.manager;
  const icons: Icon[] = [];
  let current: Array<MissionObject | null> = new Array(8).fill(null);
  let size = ICON_LIST_SIZE;
  const lastHeur = new Map<MissionObject, number>();
  let showClickMe = false;
  let boss: Icon | undefined;

  const move = (icon: Icon, slot: number): void => {
    icon.slot = slot;
    icon.el.style.transition = "top 0.8s linear, left 0.8s linear, opacity 0.8s linear";
    icon.el.style.top = `${SLOT_Y + slot * ICON_SIZE}px`;
  };

  const makeLabel = async (icon: Icon, cls: "new" | "progress" | "clickme", tid: string, holdMs: number, pauseMs = 0): Promise<void> => {
    removeLabel(icon);
    const w = await Widget.create("missions_layout", cls);
    const cap = w.part("caption");
    cap.setText(getText(tid), { rich: false, fit: false });
    noWrap(cap);
    const box = cap.el.querySelector<HTMLElement>(":scope > .g-text");
    const holder = document.createElement("div");
    holder.style.cssText = `position:absolute;left:${(ICON_SIZE + LABEL_OFFSET) * 2}px;top:${ICON_SIZE / 2}px;opacity:0;transition:left .3s linear,opacity .3s linear;pointer-events:none`;
    holder.appendChild(w.root);
    icon.el.appendChild(holder);
    const timers: number[] = [];
    icon.label = { el: holder, timers };
    // base.width = caption.width + 30 (MissionsIconLayerDisplay.getLabel)
    requestAnimationFrame(() => {
      const tw = (box?.firstElementChild as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
      const base = w.find("base");
      if (base && tw) base.setWidth(tw + 30);
    });
    const slideIn = (): void => {
      holder.style.transition = "left .3s linear, opacity .3s linear";
      holder.style.left = `${ICON_SIZE + LABEL_OFFSET}px`;
      holder.style.opacity = "1";
      // MissionIcon.setLabel: bob between x=79 and x=59 every 0.5 s for holdMs
      const bob = window.setTimeout(() => {
        holder.style.transition = "left .5s ease-in";
        let out = true;
        const iv = window.setInterval(() => {
          holder.style.left = `${out ? ICON_SIZE - 5 : ICON_SIZE + LABEL_OFFSET}px`;
          out = !out;
        }, 500);
        timers.push(iv);
        timers.push(window.setTimeout(() => { window.clearInterval(iv); if (pauseMs > 0) { holder.style.transition = "opacity .2s linear"; holder.style.opacity = "0"; timers.push(window.setTimeout(() => { holder.style.left = `${(ICON_SIZE + LABEL_OFFSET) * 2}px`; slideIn(); }, pauseMs)); } else removeLabel(icon); }, holdMs));
      }, 300);
      timers.push(bob);
    };
    requestAnimationFrame(() => requestAnimationFrame(slideIn));
  };
  const removeLabel = (icon: Icon): void => {
    const l = icon.label;
    if (!l) return;
    for (const t of l.timers) { window.clearTimeout(t); window.clearInterval(t); }
    l.el.style.transition = "opacity .2s linear";
    l.el.style.opacity = "0";
    window.setTimeout(() => l.el.remove(), 200);
    icon.label = undefined;
  };

  const showTip = async (icon: Icon): Promise<void> => {
    if (!icon.tip) {
      const w = await Widget.create("missions_layout", "tooltip");
      icon.tip = w;
      w.root.style.cssText += ";position:absolute;pointer-events:none";
      icon.el.appendChild(w.root);
    }
    const w = icon.tip;
    const title = icon.mission ? missionTitle(icon.mission.def) : getText("TID_HINT_MENU_BUTTON_MISSIONS");
    const prog = icon.mission ? icon.mission.progressAsString() : "";
    const c1 = w.part("caption");
    const c2 = w.part("caption2");
    c1.setText(title, { rich: false, fit: false });
    c2.setText(prog, { rich: false, fit: false });
    noWrap(c1);
    noWrap(c2);
    w.root.style.left = `${ICON_SIZE + 10}px`;
    w.root.style.top = `${ICON_SIZE / 2}px`;
    w.root.style.display = "";
    requestAnimationFrame(() => {
      const w1 = (c1.el.querySelector(".g-text")?.firstElementChild as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
      const w2 = (c2.el.querySelector(".g-text")?.firstElementChild as HTMLElement | null)?.getBoundingClientRect().width ?? 0;
      let bw = w1 + 14;
      if (prog) { c2.moveTo(c1.x + w1 + 5, c2.y); bw += w2 + 5; }
      w.find("base")?.setWidth(bw);
    });
  };

  const addIcon = (m: MissionObject | null, slot: number): Icon => {
    const el = document.createElement("div");
    el.style.cssText = `position:absolute;left:100px;top:${SLOT_Y + slot * ICON_SIZE}px;width:${ICON_SIZE}px;height:${ICON_SIZE}px;opacity:0;cursor:pointer;pointer-events:auto;transition:left .8s linear,opacity .8s linear,top .8s linear`;
    const img = document.createElement("img");
    const bossName = Number(ctx.game.state.profile.raw.bossGenre ?? 0) === 0 ? "ronald" : "cindy"; // Profile.bossName
    img.src = `${MISSION_ICON_URL}${m ? m.def.eventType : bossName}.png`;
    img.draggable = false;
    img.style.cssText = `width:${ICON_SIZE}px;height:${ICON_SIZE}px;display:block;transition:transform .1s linear,filter .1s linear`;
    el.appendChild(img);
    const icon: Icon = { mission: m, el, img, slot, progress: m ? m.progressAsPercentage() : 0 };
    el.addEventListener("pointerenter", () => {
      img.style.transform = "scale(1.05)";
      img.style.filter = "brightness(1.2)";
      if (icon.label) icon.label.el.style.visibility = "hidden";
      void showTip(icon);
    });
    el.addEventListener("pointerleave", () => {
      img.style.transform = "";
      img.style.filter = "";
      if (icon.label) icon.label.el.style.visibility = "";
      if (icon.tip) icon.tip.root.style.display = "none";
    });
    el.addEventListener("click", () => {
      if (!icon.mission) {
        for (const i of icons) removeLabel(i);
        uiBus.emit("openMissions");
      } else {
        removeLabel(icon);
        icon.arrow?.remove();
        void describe(icon.mission);
      }
    });
    layer.appendChild(el);
    icons.push(icon);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.left = "5px"; el.style.opacity = "1"; }));
    return icon;
  };

  const removeIcon = (m: MissionObject): void => {
    const icon = icons.find((i) => i.mission === m);
    if (!icon) return;
    removeLabel(icon);
    icon.el.style.transition = "transform .8s linear";
    icon.el.style.transformOrigin = "0 0";
    icon.el.style.transform = "scale(0)";
    window.setTimeout(() => {
      icon.el.remove();
      icons.splice(icons.indexOf(icon), 1);
    }, 800);
  };

  const refreshList = (): void => {
    const all = mgr.getMissionsAll();
    const heur = (m: MissionObject): number => heuristic(m);
    const plan = planIcons(all, heur, size);
    const prevSize = size;
    size = plan.size;
    if (prevSize !== size && boss) move(boss, size);
    for (let i = 0; i < size; i += 1) {
      const m = plan.list[i];
      const prev = current[i];
      const at = current.indexOf(m);
      if (at >= 0) {
        if (at !== i) move(icons.find((x) => x.mission === m)!, i);
      } else addIcon(m, i);
      if (prev) {
        const j = plan.list.indexOf(prev);
        if (j >= ICON_LIST_SIZE || j === -1) removeIcon(prev);
      }
    }
    current = new Array(8).fill(null);
    for (let i = 0; i < size; i += 1) current[i] = plan.list[i];
  };

  /** MissionsIconLayerDisplay.update: "new" / "progress" labels. */
  const updateLabels = (): void => {
    for (const icon of icons) {
      const m = icon.mission;
      if (!m) continue;
      if (m.isNew && icon.progress === 0) {
        m.isNew = false;
        void makeLabel(icon, "new", "TID_GEN_NEW", 6000, 5000);
      } else if (icon.progress !== m.progressAsPercentage()) {
        const p = m.progressAsPercentage();
        const o = icon.progress;
        if ((o === 0 && p > 0) || (o <= 50 && p >= 50) || (o <= 85 && p >= 85) || (o <= 95 && p >= 95)) void makeLabel(icon, "progress", "TID_GEN_PROGRESS", 7000);
        icon.progress = p;
      }
    }
    if (showClickMe && boss) {
      showClickMe = false;
      if (!boss.label) void makeLabel(boss, "clickme", "TID_GEN_CLICKME", 4000);
    }
  };

  let first = true;
  // The startup popups (daily prizes ...) open asynchronously after the UI mounted; give them time so the layer starts after them.
  const startAt = Date.now() + 2500;
  const tick = (): void => {
    if (Date.now() < startAt) return;
    // DollarsGame.as:1901-1945: world logic (incl. the icon layer) is paused while a popup is shown, and the layer only runs after the tutorial.
    if (ctx.game.tutorial || popups.isAnyOpen) return;
    // MissionsIconLayerManager.build(): the advisor icon first, at slot listSize.
    // Oracle (post-tutorial boot): no "New!" labels appear for the missions loaded with the save, so the load-time flags are cleared.
    if (!boss) mgr.markSeen(mgr.getMissionsAll());
    boss ??= addIcon(null, size);
    let changed = false;
    for (const m of mgr.getMissionsAll()) {
      const h = heuristic(m);
      if (lastHeur.get(m) !== h) changed = true;
      lastHeur.set(m, h);
    }
    if (changed) {
      refreshList();
      if (first) showClickMe = mgr.getMissionsAll().length > size; // load-time hasChanged() of missions beyond the shown list
      first = false;
    }
    updateLabels();
  };
  tick();
  window.setInterval(tick, 200);
}
