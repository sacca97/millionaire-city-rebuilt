import { loadLocale } from "../gui/i18n";
import { popups } from "../gui/popup";
import type { UiContext } from "./context";
import { mount as mountExtras } from "./extras";
import { mount as mountEconomy } from "./economy";
import { mount as mountHud } from "./hud";
import { mount as mountMissions } from "./missions";
import { mount as mountPopups } from "./popups";
import { mount as mountRewards } from "./rewards";
import { mount as mountShop } from "./shop";
import { mount as mountSocial } from "./social";
import { mount as mountTutorial } from "./tutorial";

/**
 * UI areas register themselves here: one `import` + one `await mount(ctx)` line per area.
 * Each area owns its own directory (ui/hud, ui/shop, ...) so agents do not collide.
 */
export async function initUI(ctx: UiContext): Promise<void> {
  await loadLocale("EN");
  popups.mount(ctx.root);
  // areas: add lines below
  await mountHud(ctx);
  await mountPopups(ctx);
  await mountRewards(ctx);
  await mountShop(ctx);
  await mountSocial(ctx);
  await mountTutorial(ctx);
  await mountMissions(ctx);
  await mountEconomy(ctx);
  await mountExtras(ctx);
}
