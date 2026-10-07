// Mission popups: PopupReward ("Well done"), PopupMission (+ Name / Upgrades variants) and the small message popup.
// Ported from GUI/PopupReward.as, GUI/PopupMission.as, GUI/PopupName.as, GUI/PopupMissionUpgrades.as,
// MissionObjectManager.openDescription (:240-275).
import { Button } from "../../gui/button";
import { getText } from "../../gui/i18n";
import { Popup } from "../../gui/popup";
import { createConfirmPopup } from "../../gui/popups";
import { Widget } from "../../gui/widget";
import { findByName } from "../../gui/layout";
import type { MissionObject } from "../../game/missions";
import type { UiContext } from "../context";
import { openEmailPopup } from "../extras/email";
import { fillRewardContainer } from "./art";
import { startNoteRain, stopNoteRain } from "../extras/noterain";
import { MISSION_IMAGE_SWF, SKU, descriptionKind, imageText, missionDescription, missionTitle } from "./logic";

const bossIndex = (ctx: UiContext): 1 | 2 => (Number(ctx.game.state.profile.raw.bossGenre ?? 0) === 1 ? 2 : 1);

/** PopupReward: "Well Done!" + mission title + the reward, Done closes (Share is a Facebook post: hidden). */
export async function openRewardPopup(ctx: UiContext, obj: MissionObject, onClose?: () => void): Promise<Popup> {
  const w = await Widget.create(SKU, "popup_well_done");
  const p = new Popup(w);
  w.setText("Caption", getText("TID_MISSION_COMPLETED"));
  w.setText("TextInfo", missionTitle(obj.def));
  const hasItem = obj.def.rewards.some((r) => r.kind === "item");
  if (hasItem) w.setText("TextInfo2", getText("TID_MISSION_REWARD_ITEM"));
  else w.hide("TextInfo2");
  // NewsFeedViewManager.setupNewsFeedPrePopup(:46): the `new_feed` block shows TextInfo_02 (newsFeeds missionReward has a reward) and the
  // original shows it, the placeholder `image` and the ShareSuccess button (PopupReward.as:39). Share = onClose + Facebook feed post,
  // which does not exist offline, so it only closes.
  const share = new Button(w.part("ShareSuccess"));
  share.setLabel(getText("TID_BUTTON_SHARE"));
  w.find("new_feed.TextInfo_02")?.setText(getText("TID_NEWSFEED_REWARD_PRE_POPUP_MISSION_REWARD"));
  p.wireClose(new Button(w.part("Done")));
  p.wireClose(share);
  await fillRewardContainer(w, obj.def.rewards);
  p.on("close", () => {
    stopNoteRain(); // MissionObjectManager.closeReward :496
    onClose?.();
  });
  p.show();
  startNoteRain(); // MissionObjectManager.openReward :166
  ctx.game.emitSound("reward_click");
  return p;
}

/**
 * MissionObjectManager.openDescription -> PopupMission / PopupName / PopupMissionUpgrades.
 * `onNamed(name)` is called by the Name popup after "Done" (PopupName.saveName).
 */
export async function openDescriptionPopup(ctx: UiContext, obj: MissionObject, hooks: { onNamed?: (name: string) => void; onEmail?: (email: string) => void; onClose?: () => void } = {}): Promise<Popup> {
  const def = obj.def;
  const kind = descriptionKind(def);
  // PopupEmail: offline-safe version in ui/extras/email.ts (no CRM; confirmation is immediate)
  if (kind === "email") return openEmailPopup(ctx, obj, { onConfirmed: hooks.onEmail, onClose: hooks.onClose });
  const boss = bossIndex(ctx);
  const base = kind === "name" ? "Name" : kind === "upgrades" ? "upgrades" : "background";
  const withImage = def.imageIsRequired && kind === "plain";
  const cls = kind === "name" ? `popup_mission_Name_0${boss}` : kind === "upgrades" ? `popup_mission_upgrades_0${boss}` : `popup_mission_${base}_0${boss}${withImage ? "_image_01" : ""}`;
  const w = await Widget.create(SKU, cls);
  const p = new Popup(w);
  w.setText("Reward", getText("TID_GEN_REWARD") + getText("TID_ESPACIO2PUNTOS"));
  w.setText("Title", missionTitle(def));
  w.setText("TextInfo", missionDescription(def, true), { fit: true });
  await fillRewardContainer(w, def.rewards);
  if (withImage) await fillMissionImage(w, obj);

  const done = w.part("Done");
  if (kind === "name") {
    const input = nameInput(w, ctx.game.state.profile.cityName);
    const ok = new Button(done);
    ok.disable();
    input.addEventListener("input", () => {
      const v = input.value.trim();
      // PopupName.checkName: enabled when it differs from the current name and is not blank.
      if (v !== "" && v !== ctx.game.state.profile.cityName) ok.enable();
      else ok.disable();
    });
    ok.onClick(() => {
      const v = input.value.trim();
      if (v === "" || v === ctx.game.state.profile.cityName) return;
      hooks.onNamed?.(v);
      p.accept();
    });
    p.wireClose(new Button(w.part("mClose")));
  } else {
    if (kind === "upgrades") {
      // HelpButton posts to the Facebook feed / opens the toolbar installer: not applicable offline.
      w.find("HelpButton")?.hide();
    }
    p.wireClose(new Button(done));
  }
  p.on("close", () => hooks.onClose?.());
  p.show();
  return p;
}

/** PopupMission mission image: the per-mission SWF class `image` (beat_2, build_Decorations_tree, ...) with TextInfo = condition. */
async function fillMissionImage(w: Widget, obj: MissionObject): Promise<void> {
  const holder = w.find("image_01");
  if (!holder) return;
  try {
    const img = await Widget.create(MISSION_IMAGE_SWF(obj.def), "image");
    const info = findByName(img.node, "TextInfo");
    if (info) img.setText("TextInfo", imageText(obj.def));
    holder.append(img);
  } catch {
    // Resource not loaded and required (MissionDefinition.build: debug trace only).
  }
}

/**
 * PopupName: the `NameUser` text field becomes an input (restrict "A-Z a-z 0-9 ' À-ü", cleared on first click).
 */
function nameInput(w: Widget, current: string): HTMLInputElement {
  const part = w.part("NameUser");
  const b = part.node.text?.bounds ?? [-125, -54, 125, -24];
  const input = document.createElement("input");
  input.type = "text";
  input.value = current;
  input.maxLength = 20;
  input.className = "g-input";
  input.style.cssText = `position:absolute;left:${part.x + b[0]}px;top:${part.y + b[1]}px;width:${b[2] - b[0]}px;height:${b[3] - b[1]}px;box-sizing:border-box;pointer-events:auto;font:${part.node.text?.size ?? 20}px "Lilita One","Challenge Bold LET",sans-serif;color:${part.node.text?.color ?? "#003242"};background:transparent;border:0;outline:0;padding:0 4px;text-align:${part.node.text?.align ?? "left"}`;
  part.hide();
  w.root.appendChild(input);
  input.addEventListener("click", () => {
    if (input.dataset.cleared !== "1") {
      input.dataset.cleared = "1";
      input.value = ""; // PopupName.onNameClick
    }
  }, { once: true });
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^A-Za-z0-9 'À-ü]/g, "");
  });
  return input;
}

/** PopupMsgSmall (MORE_MISSIONS_SOON): small information box. */
export async function showMessage(title: string, body: string): Promise<void> {
  const p = await createConfirmPopup({ title, body, buttons: [] });
  p.show();
}
