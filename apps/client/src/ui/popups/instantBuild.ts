// Instant build (speed up construction). Port of StateOnConstructionOwner.doDoClick/instantBuildStart/instantBuildCash
// (:153-251): price = Profile.getTimePrice(timeLeft) * instantBuildFactor (RulesFacade.getInstantBuildPrice :331), paid in coins;
// not enough coins -> exchange gold (PopupConfirm.startAskForHelpFBCredits), else PopupTradeBox(TYPE_INSTANT_BUILD).
import { createTradeBox } from '../../gui/popups';
import { STATE_ID } from '../../net/commands';
import type { UiContext } from '../context';
import { ensureCoins } from './flows';

const busy = new Set<string>();

export async function openInstantBuild(ctx: UiContext, sid: string): Promise<void> {
  const { game } = ctx;
  const item = game.item(sid);
  // isInstantBuildAllowed: mTime < mMaxTime (the timer is running) and not suspended.
  if (!item || item.stateId !== STATE_ID.CONSTRUCTION || item.time <= 0 || busy.has(sid)) return;
  const price = game.instantBuildPrice(item);
  busy.add(sid);
  const done = () => busy.delete(sid);
  if (price <= 0) {
    game.instantBuild(sid);
    done();
    return;
  }
  if (game.profile.coins < price) {
    await ensureCoins(ctx, price, () => game.instantBuild(sid));
    done();
    return;
  }
  const p = await createTradeBox({ price, instantBuild: true, affordable: true, onAccept: () => game.instantBuild(sid) });
  p.on('close', done);
  p.show();
}
