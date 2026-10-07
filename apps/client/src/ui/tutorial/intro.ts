/**
 * RonaldsCity intro state (flow/RonaldsCity.as): a full-screen splash (splash.swf `Splash`, plays to its last frame), then
 * PopupSelectBoss (hud.swf `popup_select_advisor`: choose Ronald or Cindy; stores `boss_genre`), whose chosen advisor clip
 * `popup_select_advisor_boss_0N` plays before the state ends (PopupSelectBoss.checkAnim -> EVENT_CLOSE).
 *
 * The shipped splash.swf is a 587-byte recreation without art (apps/server/assets/splash.swf), so the splash is a plain
 * title card of the same duration class.
 */
import { Button } from "../../gui/button";
import { getText } from "../../gui/i18n";
import { Popup } from "../../gui/popup";
import { Widget, loadGui } from "../../gui/widget";

/** RonaldsCity.TIMER_INIT_INTRO. */
const SPLASH_MS = 1000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Plays a multi-frame clip once at the swf frame rate (centred in `host`). */
export async function playClip(host: HTMLElement, swf: string, cls: string): Promise<void> {
  const layout = await loadGui(swf);
  const sym = layout.symbols[String(layout.classes[cls])] as { frames?: unknown[] } | undefined;
  const frames = sym?.frames?.length ?? 1;
  const fps = layout.frameRate || 24;
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none";
  host.appendChild(holder);
  let current: Widget | undefined;
  for (let f = 0; f < frames; f += 1) {
    const w = new Widget(layout, cls, { swf, frame: f });
    holder.appendChild(w.root);
    current?.destroy();
    current = w;
    await sleep(1000 / fps);
  }
  current?.destroy();
  holder.remove();
}

/** Runs splash + advisor selection. Resolves with the chosen boss genre (0 = Ronald / male, 1 = Cindy / female). */
export async function runIntro(root: HTMLElement): Promise<0 | 1> {
  const overlay = document.createElement("div");
  overlay.className = "mc-tutorial-splash";
  overlay.style.cssText =
    "position:absolute;inset:0;z-index:900;pointer-events:auto;background:#fff;opacity:0;transition:opacity .5s";
  root.appendChild(overlay);
  requestAnimationFrame(() => (overlay.style.opacity = "1"));
  await sleep(SPLASH_MS);

  const w = await Widget.create("hud", "popup_select_advisor");
  w.setText("Caption", getText("TID_TUTORIAL_SELECT_ADVISOR"));
  const popup = new Popup(w);
  popup.closeOnEscape = false;
  popup.drawBackground = false;
  const boss1 = new Button(w.part("select_boss_01"));
  const boss2 = new Button(w.part("select_boss_02"));
  const genre = await new Promise<0 | 1>((resolve) => {
    boss1.onClick(() => resolve(0)); // PopupSelectBoss.onBossClick1: BOSS_MALE
    boss2.onClick(() => resolve(1)); // onBossClick2: BOSS_FEMALE
    popup.show();
  });
  popup.close();
  await playClip(overlay, "hud", genre === 0 ? "popup_select_advisor_boss_01" : "popup_select_advisor_boss_02");
  overlay.style.opacity = "0";
  await sleep(500);
  overlay.remove();
  return genre;
}

/**
 * PopupInviteNeighbors (GUI/PopupInviteNeighbors.as): shown by Tutorial.onStep11 right after the final tutorial popup
 * (houses_info `popup_invite_neighbor_1/2`: Title, TextInfo, actionButton "Invite Neighbors", skipButton = the X). Resolves when it closes.
 */
export async function showInviteNeighbors(genre: 0 | 1): Promise<void> {
  const w = await Widget.create("houses_info", genre === 1 ? "popup_invite_neighbor_2" : "popup_invite_neighbor_1");
  w.setText("Title", getText("TID_INVITATION_POPUP_NEWUSERS_TITLE"));
  w.setText("TextInfo", getText("TID_INVITATION_POPUP_NEWUSERS_TITLE_BODY"));
  const popup = new Popup(w);
  popup.closeOnEscape = false;
  const act = new Button(w.part("actionButton"));
  act.setLabel(getText("TID_INVITATION_POPUP_BUTTON"));
  act.onClick(() => popup.close()); // PopupInviteNeighbors.onInvite: close + TASK_NEIGHBOR_REQUEST (Facebook invite: no-op here)
  const skip = new Button(w.part("skipButton"));
  skip.onClick(() => popup.close());
  await new Promise<void>((resolve) => {
    popup.on("close", () => resolve());
    popup.show();
  });
}
