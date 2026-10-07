/** First-session tutorial (feature-inventory section 1): `game.tutorial` (game/tutorial.ts) is set by Game.boot on a fresh save. */
import { uiBus } from "../bus";
import type { UiContext } from "../context";
import { getHud } from "../hud";
import { JUST_ENDED_KEY, TutorialController } from "./controller";

let controller: TutorialController | undefined;
export const getTutorial = (): TutorialController | undefined => controller;

export async function mount(ctx: UiContext): Promise<void> {
  const machine = ctx.game.tutorial;
  if (!machine) {
    let just = false;
    try {
      just = sessionStorage.getItem(JUST_ENDED_KEY) === "1";
      sessionStorage.removeItem(JUST_ENDED_KEY);
    } catch {
      /* ignore */
    }
    if (just) {
      // Tutorial.onStep11/onStep12: invite-neighbours popup, missions button blinks.
      setTimeout(() => {
        uiBus.emit("openInvite");
        getHud()?.tools.setBossAlert("newMission");
      }, 1500);
    } else ctx.audio.setMusic("Main_Music");
    return;
  }
  controller = new TutorialController(ctx, machine);
  (window as unknown as { __tutorial?: unknown }).__tutorial = controller;
  void controller.start();
}
