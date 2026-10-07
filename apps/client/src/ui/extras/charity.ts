import type { Popup } from "../../gui/popup";
import { createConfirmPopup } from "../../gui/popups";
import { CHARITY } from "./charity.config";

/**
 * Replacement for the give-your-email popup (PopupEmail): an optional, local-only "give back" message with two choices. Both complete the
 * mission (the player is trusted, nothing is checked); the X just closes it and the mission stays available. No link, nothing stored or sent.
 */
export async function openCharityPopup(hooks: { onConfirmed?: () => void; onClose?: () => void } = {}): Promise<Popup> {
  const p = await createConfirmPopup({
    title: CHARITY.title,
    body: CHARITY.body,
    buttons: [
      { slot: 1, kind: "green", label: CHARITY.donatedLabel, onClick: () => hooks.onConfirmed?.() },
      { slot: 2, kind: "green", label: CHARITY.skipLabel, onClick: () => hooks.onConfirmed?.() }
    ]
  });
  p.on("close", () => hooks.onClose?.());
  p.show();
  return p;
}
