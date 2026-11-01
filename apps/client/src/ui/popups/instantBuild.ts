// Instant build (speed up construction). Port of StateOnConstructionOwner.doDoClick/instantBuildStart/instantBuildCash
// (:153-251): price = Profile.getTimePrice(timeLeft) * instantBuildFactor (RulesFacade.getInstantBuildPrice :331), paid in coins;
// not enough coins -> exchange gold (PopupConfirm.startAskForHelpFBCredits), else PopupTradeBox(TYPE_INSTANT_BUILD).
import { getText, t } from '../../gui/i18n';
import { createInstantBuildHelp, createTradeBox } from '../../gui/popups';
import { STATE_ID } from '../../net/commands';
import type { UiContext } from '../context';
import { ensureCoins, showMessage } from './flows';
import { helpPopupText, instantBuildButton, opensHelpPopup } from './logic';

const busy = new Set<string>(); // help popup open
const paying = new Set<string>(); // cash flow in progress

export async function openInstantBuild(ctx: UiContext, sid: string): Promise<void> {
  const { game } = ctx;
  const item = game.item(sid);
  // isInstantBuildAllowed: mTime < mMaxTime (the timer is running) and not suspended.
  if (!item || item.stateId !== STATE_ID.CONSTRUCTION || item.time <= 0 || busy.has(sid)) return;
  // StateOnConstructionOwner.doDoClick (:288-300): A4H types open PopupInstantBuild (mPopupWonders); the cash button there is instantBuildStart.
  const type = item.def.rules.instantBuildType;
  if (!opensHelpPopup(type)) return payInstantBuild(ctx, sid);
  busy.add(sid);
  const helpers: string[] = []; // FriendsManager.getBuildingHelp(sid): nobody helps offline (NPC friends never answer)
  const { tid, params } = helpPopupText(helpers.length);
  const p = await createInstantBuildHelp({
    name: item.def.attrs.tid ? getText(item.def.attrs.tid) : item.sku,
    text: t(tid, params),
    button: instantBuildButton(type),
    fbc: item.def.rules.instantBuildFBC,
    helpers,
    onAskHelp: () => void askForHelp(ctx, sid),
    onPay: () => void payInstantBuild(ctx, sid),
  });
  p.on('close', () => busy.delete(sid));
  p.show();
}

/** StateOnConstructionOwner.onAskHelp (:366-382) + UserDataFacadeOnline TASK_ASK_FOR_HELP (:467-472) and its answer (:1286-1315). */
async function askForHelp(ctx: UiContext, sid: string): Promise<void> {
  const { game } = ctx;
  game.sendCommand(game.commands.askForHelp(sid)); // sendQuery: forces the flush
  game.poll('askForHelp'); // PollManager.registerEvent(MISSION_EVENT_ASK_FOR_HELP), at once, before the answer
  const res = await game.flush();
  const dat = res.find((c) => c._cmd === 'ask_for_help')?._dat as Record<string, unknown> | undefined;
  // help_id "null" -> REQ_SHOW_POPUP_INFO (ShowPopup POPUP_MSG_SMALL) with TID_A4H_REQUEST. A real id would post to the Facebook feed: not offline.
  if (String(dat?.help_id) === 'null') await showMessage(getText('TID_A4H_REQUEST'));
}

/** instantBuildStart / instantBuildCash (the popup's cash button, or CASH-only items). */
async function payInstantBuild(ctx: UiContext, sid: string): Promise<void> {
  const { game } = ctx;
  const item = game.item(sid);
  if (!item || item.stateId !== STATE_ID.CONSTRUCTION || item.time <= 0) return;
  const price = game.instantBuildPrice(item);
  if (paying.has(sid)) return;
  paying.add(sid);
  const done = () => paying.delete(sid);
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
