// Shared payment / confirmation flows (PopupConfirm.startAskForHelpFBCredits / startExchangeGold / startNoEnoughGold,
// PopupConfirmDestroy, PopupConfirmMove). Facebook-credit and help-request branches are omitted (offline build).
import { Button } from '../../gui/button';
import { coins, convertNumberToString, TRUNCATE_THOUSAND } from '../../gui/format';
import { getText, replaceParams, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { createConfirmPopup, createExchange, createExchangeGoldConfirm } from '../../gui/popups';
import { Widget } from '../../gui/widget';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { goldForCoins } from './logic';

/** PopupConfirm.startNoEnoughGold: not enough gold either -> "Add gold" (gold button) which opens the gold shop. */
export async function showNoGold(ctx: UiContext, neededCoins: number): Promise<void> {
  const k = ctx.game.rules.settings.cashToCoins;
  const missingGold = goldForCoins(neededCoins - ctx.game.profile.coins, k);
  const body =
    neededCoins > 0 && missingGold > 0
      ? t('TID_NOT_ENOUGH_CASH_AND_GOLD', [coins(missingGold * k), String(missingGold), String(ctx.game.profile.cash)])
      : t('TID_NOT_ENOUGH_GOLD', [0, String(Math.max(1, missingGold - ctx.game.profile.cash))]);
  const p = await createConfirmPopup({
    title: getText('TID_NO_GOLD_TITLE'),
    body,
    buttons: [{ slot: 2, kind: 'gold', label: getText('TID_BUTTON_TEXT_ADDCASH'), onClick: () => uiBus.emit('openAddGold') }],
  });
  p.show();
}

/**
 * Pay `price` coins: runs `then` at once when affordable, otherwise offers to exchange gold for the missing coins
 * (PopupConfirm.startExchangeGold) and runs `then` after the exchange; if gold is short too the no-gold dialog opens.
 */
export async function ensureCoins(ctx: UiContext, price: number, then: () => void): Promise<void> {
  const { game } = ctx;
  if (game.profile.coins >= price) {
    then();
    return;
  }
  const k = game.rules.settings.cashToCoins;
  const gold = goldForCoins(price - game.profile.coins, k);
  if (game.profile.cash < gold) {
    await showNoGold(ctx, price);
    return;
  }
  const p = await createExchangeGoldConfirm(gold, k, () => {
    if (game.exchangeGold(gold)) then();
  });
  p.show();
}

/** HUD "add coins" -> PopupExchange (houses_info exchange_01/02): trade gold bars for coins one at a time. */
export async function openExchange(ctx: UiContext): Promise<void> {
  const { game } = ctx;
  const k = game.rules.settings.cashToCoins;
  const p = await createExchange({
    gold: game.profile.cash,
    coins: game.profile.coins,
    coinsPerGold: k,
    female: String(game.state.profile.raw.bossGenre ?? '0') === '1',
    onAddGold: () => uiBus.emit('openAddGold'),
    onDone: (goldLeft) => {
      const spent = game.profile.cash - goldLeft;
      if (spent > 0) game.exchangeGold(spent);
    },
  });
  p.show();
}

/** popup_confirm_destroy.swf: question text + Yes/No (PopupConfirmDestroy.as). `text` may carry a %U value. */
export async function confirmDestroy(text: string, value: number, onYes: () => void): Promise<Popup> {
  const w = await Widget.create('houses_info', 'popup_confirm_destroy');
  const p = new Popup(w);
  const yes = new Button(w.part('OkButton')).setLabel(getText('TID_BUTTON_YES'));
  const no = new Button(w.part('CancelButton')).setLabel(getText('TID_BUTTON_NO'));
  w.setText('TextInfo', value > 0 ? replaceParams(text, [getText('TID_COIN_SYMBOL') + convertNumberToString(value, TRUNCATE_THOUSAND, 7)]) : text, { fit: true });
  yes.onClick(() => {
    onYes();
    p.accept();
  });
  no.onClick(() => p.close());
  return p;
}

/** popup_confirm_buy_crane_operator (PopupConfirmMove.as): "Are you sure to move here, for...?" + price/"Free". */
export async function confirmMove(price: number, onYes: () => void): Promise<Popup> {
  const w = await Widget.create('houses_info', 'popup_confirm_buy_crane_operator');
  const p = new Popup(w);
  const ok = new Button(w.part('OkButton')).setLabel(getText('TID_BUTTON_YES'));
  const close = new Button(w.part('mClose'));
  w.setText('TextInfo', getText('TID_MOVE_TEXT1'), { fit: true });
  w.setText('freemove', price > 0 ? coins(price, TRUNCATE_THOUSAND, 7) : getText('TID_GEN_FREE'));
  ok.onClick(() => {
    onYes();
    p.accept();
  });
  p.wireClose(close);
  return p;
}

/**
 * PopupPayMove (GUI/PopupPayMove.as, houses_info popup_confirm_buy_rent_crane_operator): ToolMove asks for the move price (coins) or
 * lets the player rent the crane operator for a day with gold (service "move", ServiceDefinition priceCash).
 */
export async function confirmPayMove(price: number, rentGold: number, onYes: () => void, onRent: () => void): Promise<Popup> {
  const w = await Widget.create('houses_info', 'popup_confirm_buy_rent_crane_operator');
  const p = new Popup(w);
  const ok = new Button(w.part('OkButton'));
  const rent = new Button(w.part('RentButton')).setLabel('Rent');
  w.find('unlock_fc')?.hide();
  w.setText('Expand', getText('TID_MOVE_TITLE'), { fit: true });
  w.setText('TextInfo_01', getText('TID_MOVE_TEXT1'), { fit: true });
  w.setText('TextInfo_02', getText('TID_MOVE_TEXT2'), { fit: true });
  w.setText('mPrize', getText('TID_COIN_SYMBOL') + convertNumberToString(price, TRUNCATE_THOUSAND, 7), { fit: true });
  w.setText('DCCash', convertNumberToString(rentGold, TRUNCATE_THOUSAND, 7), { fit: true });
  ok.onClick(() => { onYes(); p.accept(); });
  rent.onClick(() => { onRent(); p.accept(); });
  p.wireClose(new Button(w.part('mClose')));
  return p;
}

/**
 * PopupMessage.showPopupParams (GUI/PopupMessage.as:38-68, houses_info popup_confirm_buy_manager): text centred in the field, one OK button,
 * `plots_info` (ICON_TERRAIN) or `locked` (ICON_LOCK) visible. Tool.itemAttachedProcessNotAbleToPlace (Tool.as:511-529) shows it with
 * TID_PLACE_IN_TERRAIN ("%U" = baseCols x baseRows) for items that need own terrain, else TID_CANT_BUILD_DECORATION.
 */
export async function showMessage(text: string, icon: 'terrain' | 'lock' | null = null, small = true): Promise<void> {
  // mPopupMsgSmall = PopupMessageSmall (popup_missage), the big variant is popup_confirm_buy_manager.
  const w = await Widget.create('houses_info', small ? 'popup_missage' : 'popup_confirm_buy_manager');
  const p = new Popup(w);
  w.find('plots_info')?.setVisible(icon === 'terrain');
  w.find('locked')?.setVisible(icon === 'lock');
  w.setText('TextInfo_01', text, { rich: false });
  const ok = new Button(w.part('OkButton'));
  ok.setLabel(getText('TID_BUTTON_OK'), { fit: true });
  p.wireClose(ok);
  p.show();
}
