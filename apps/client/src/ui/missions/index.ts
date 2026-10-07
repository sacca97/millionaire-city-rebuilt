/**
 * Missions area (feature-inventory 6.x): mission model binding, panel, reward/description popups, toolbar alert, newspaper and the
 * returning-session popup chain.
 * API for other areas: `getMissions()` -> MissionSystem; `getMissions().register(type, parameter?)` for events they own
 * (investment, investmentDone, visitPartner, upgrade, collectUpgraded, askForHelp...) or `game.poll(type, sku?)`.
 */
import { getText } from "../../gui/i18n";
import { STATE_REACHED, STATE_UNLOCKED, type MissionObject } from "../../game/missions";
import { uiBus } from "../bus";
import type { UiContext } from "../context";
import { getHud } from "../hud";
import { mountIconLayer } from "./iconlayer";
import { MissionsPanel } from "./panel";
import { openDescriptionPopup, openRewardPopup, showMessage } from "./popups";
import { MissionSystem, loadMissionRules } from "./system";

let system: MissionSystem | undefined;
/** The running mission system (undefined before mount). */
export const getMissions = (): MissionSystem | undefined => system;

export async function mount(ctx: UiContext): Promise<MissionSystem> {
  const rules = await loadMissionRules();
  const sys = new MissionSystem(ctx.game, rules);
  system = sys;
  (window as unknown as { __missions?: MissionSystem }).__missions = sys; // dev aid (main.ts overwrites window.__mcity after the UI mounts)

  let panel: MissionsPanel | undefined;
  let opening = false;

  // Toolbar boss marker (ToolsBar.bossAlertOnChange).
  const applyAlert = (kind: "none" | "newMission" | "missionReached"): void => getHud()?.tools.setBossAlert(kind);
  uiBus.on("missionAlert", ({ kind }) => applyAlert(kind));
  applyAlert(sys.manager.alert());

  // MissionObjectManager.openReward: PopupReward when a mission reaches its goal (once at a time).
  sys.manager.on("reached", (obj) => {
    sys.manager.rewardPopupOpen = true;
    void openRewardPopup(ctx, obj, () => {
      sys.manager.rewardPopupOpen = false;
      void panel?.render();
    });
  });
  sys.manager.on("change", () => void panel?.render());

  const describe = async (obj: MissionObject): Promise<void> => {
    await openDescriptionPopup(ctx, obj, {
      onEmail: () => {
        // CheckConfirmEmail.checkStatus: confirmed address -> mission 64 REACHED
        sys.manager.forceReached(obj);
        sys.update();
      },
      onNamed: (name) => {
        // PopupName.saveName: new city name, HUD update, mission -> REACHED.
        ctx.game.state.profile.cityName = name;
        ctx.game.sendCommand(ctx.game.commands.cityName(name));
        getHud()?.hud.setCityName(name);
        sys.manager.forceReached(obj);
        sys.update();
      }
    });
    // MissionsBox.showDescription: informative missions become REACHED when read.
    if (obj.def.eventType === "informative" && obj.state === STATE_UNLOCKED) {
      obj.changeState(STATE_REACHED);
      sys.update();
    }
    sys.manager.clearAlerts([obj]);
  };

  const open = async (sku?: string): Promise<void> => {
    if (opening || (panel && !panel.isClosed)) return;
    opening = true;
    try {
      if (sys.manager.getMissions().length === 0) {
        // MissionsBox.showPopup: nothing to show -> "More missions soon".
        await showMessage(getText("TID_HINT_MENU_BUTTON_MISSIONS"), getText("TID_MORE_MISSIONS_SOON"));
        return;
      }
      panel = await MissionsPanel.open(ctx, sys, {
        onDescription: describe,
        onClaim: async (obj) => {
          // MissionsBox.applyReward: apply (delayed payment + GIVEN), then PopupReward; the list refreshes on close.
          sys.manager.claim(obj);
          sys.pushAlert();
          sys.manager.rewardPopupOpen = true;
          await openRewardPopup(ctx, obj, () => {
            sys.manager.rewardPopupOpen = false;
            void panel?.render();
          });
        }
      });
      if (sku) panel?.showSku(sku);
    } finally {
      opening = false;
    }
  };
  uiBus.on("openMissions", () => void open());
  void mountIconLayer(ctx, sys, describe);

  return sys;
}
