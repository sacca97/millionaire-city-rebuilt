// The "give back" mission replaces the original's give-your-email mission (64 default / 94 alt, GUI/PopupEmail): nothing is collected,
// nothing is sent and no link is opened. The popup only mentions donating to a charity of the player's choice and offers two choices.
export const CHARITY = {
  title: "Give back",
  /** Popup body. Donating is entirely optional and never required for the reward. */
  body: "Even millionaires remember where they started. If you like, donate to a charity of your choice. It is entirely optional: the reward is yours either way.",
  donatedLabel: "I donated",
  skipLabel: "No thanks"
} as const;

/** Company value at which the mission appears (the "first million" moment). The original unlocked it by level (1 / 2). */
export { GIVE_BACK_UNLOCK_COMPANY_VALUE } from "../../game/missions";

/** TID overrides for the mission texts of 64 / 94 (they talked about email and the VIP club newsletter). */
export const GIVE_BACK_TEXTS: Record<string, string> = {
  TID_MISSION_064_TITLE: "Give Back",
  TID_MISSION_064_DESC: "Millionaires give back! Consider donating to a charity of your choice. It is entirely optional and the free VIP Club building is yours either way.",
  TID_MISSION_064_DESC_TIP: "\\n\\n Tip: Donating is optional; you get the reward whether you donate or not.",
  TID_MISSION_006A_TITLE: "Give back",
  TID_MISSION_006A_DESC: "Millionaires give back! Consider donating to a charity of your choice. It is entirely optional and the reward is yours either way.\\n Tip: Donating is optional."
};
