// Pure helpers of the missions UI (texts, list layout, scrolling). Unit tested in logic.test.ts.
import { convertNumberToString, getPercentageText } from "../../gui/format";
import { getText, replaceParams, tidIndex } from "../../gui/i18n";
import { STATE_LOCKED, STATE_REACHED, STATE_UNLOCKED, type MissionDef, type MissionObject, type MissionReward } from "../../game/missions";

export const SKU = "Missions"; // MissionsBox.SKU ("missions" resource -> Missions.swf)
export const MISSION_ICON_URL = "/mcity/0.501/Datas/Assets/missions/icons/";
export const REWARD_ART_URL = "/mcity/0.501/Datas/popups/common/";
export const MISSION_IMAGE_SWF = (d: MissionDef): string => `${d.eventType}_${d.eventType === "beat" ? d.beatIndex ?? d.eventCondition : d.eventParameter}`;

/** MissionsBox geometry (MissionsBox.as constants): item i sits at (XINIT, YINIT + i * YOFFSET); 4 items per page. */
export const XINIT = -194.4;
export const YINIT = -109.3;
export const XOFFSET = 20;
export const YOFFSET = 57;
export const ITEMS_PER_PAGE = 4;
export const SCROLL_STEP = 15; // mScrollOffset px per frame

/** Colours of the item title (MissionItem.mTextColor: 12866 / 13056). */
export const TITLE_COLOR = { unlocked: "#003242", locked: "#003242", reached: "#003300" } as const;

/** Item frame (1-based AS gotoAndStop: 1 locked, 2 unlocked, 3 reached) -> 0-based index. */
export function itemFrame(state: number): number {
  return state === STATE_REACHED ? 2 : state === STATE_UNLOCKED ? 1 : 0;
}

/** MissionDefinition.getTextTitle: TextIDs[tid + "_TITLE"]. */
export function missionTitle(def: MissionDef): string {
  return getText(`${def.tid}_TITLE`);
}

/** MissionDefinition.getTextDescription: `_DESC` (+ `_DESC_TIP` when requested and present), %U0 = amount. */
export function missionDescription(def: MissionDef, withTip = false): string {
  let s = getText(`${def.tid}_DESC`);
  if (withTip && tidIndex(`${def.tid}_DESC_TIP`) >= 0) s += getText(`${def.tid}_DESC_TIP`);
  return replaceParams(s, [String(def.eventAmount)]);
}

/** Title as shown by MissionItem.setUpInfo (:206-269): numbered for unlocked missions. */
export function itemTitle(obj: MissionObject, ordinal: number, rtl = false): string {
  const title = missionTitle(obj.def);
  if (obj.state === STATE_UNLOCKED) return rtl ? `${title} .${ordinal}` : `${ordinal}. ${title}`;
  return title;
}

/** Text of the "locked" ribbon: "Mission %U0 required" / "Level %U0". */
export function lockedText(obj: MissionObject, givenCount: number): string {
  if (obj.def.unlockSku !== "") return replaceParams(getText("TID_DEFINITION_MISSION"), [String(givenCount + obj.unlockMissionId + 1)]);
  return replaceParams(getText("TID_DEFINITION_LEVEL"), [String(obj.def.unlockLevel)]);
}

/** RewardCoins.getText / RewardExp.getText */
export function rewardLabel(r: MissionReward): string {
  if (r.kind === "coins") return getText("TID_COIN_SYMBOL") + convertNumberToString(r.amount, 0, 0);
  if (r.kind === "exp") return convertNumberToString(r.amount, 0, 0);
  return String(r.amount);
}

/** MissionDefinition.build image text: bonus -> percentage, else the condition. */
export function imageText(def: MissionDef): string {
  return def.eventType === "bonus" ? getPercentageText(def.eventCondition) : String(def.eventCondition);
}

/** Number of scroll pages (MissionsBox.getItems: items / 4 rounded up). */
export function pageCount(items: number): number {
  return Math.max(1, Math.ceil(items / ITEMS_PER_PAGE));
}

/** Which popup variant MissionObjectManager.openDescription picks. */
export type DescriptionKind = "name" | "email" | "upgrades" | "plain";
export function descriptionKind(def: MissionDef): DescriptionKind {
  switch (def.eventType) {
    case "nameCity":
      return "name";
    case "giveEmail":
      return "email";
    case "collectUpgraded":
    case "checkToolbar":
      return "upgrades";
    default:
      return "plain";
  }
}

export { STATE_LOCKED };
