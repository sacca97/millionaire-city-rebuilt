/**
 * Not-enough-money flows of the shop (PopupConfirm.startNoEnoughGold / startExchangeGold, ToolBuild.itemAttachedCheckPrice):
 *  - coins short, gold enough -> "exchange gold for coins" confirm (TID_NOT_ENOUGH_CASH) -> Game.exchangeGold
 *  - gold short -> "Not Enough Gold" with an "Add gold" button (TID_NOT_ENOUGH_GOLD / _AND_GOLD) -> uiBus openAddGold
 */
import { coins as coinStr } from '../../gui/format';
import { getText, t } from '../../gui/i18n';
import { createConfirmPopup, createExchangeGoldConfirm } from '../../gui/popups';
import { uiBus } from '../bus';
import type { UiContext } from '../context';

/** PopupConfirm.convertToGold: gold bars needed to cover `missingCoins`. */
export function goldFor(missingCoins: number, cashToCoins: number): number {
  return Math.max(0, Math.ceil(missingCoins / cashToCoins));
}

/** PopupConfirm.startNoEnoughGold(coins, gold). */
export async function showNotEnoughGold(ctx: UiContext, o: { missingCoins?: number; missingGold?: number }): Promise<void> {
  const k = ctx.game.rules.settings.cashToCoins;
  const have = ctx.game.profile.cash;
  let body: string;
  if (o.missingCoins && o.missingCoins > 0) {
    const gold = goldFor(o.missingCoins, k);
    body = t('TID_NOT_ENOUGH_CASH_AND_GOLD', [coinStr(gold * k), String(gold), String(have)]);
  } else {
    body = t('TID_NOT_ENOUGH_GOLD', [0, String(Math.max(1, (o.missingGold ?? 1) - have))]);
  }
  const p = await createConfirmPopup({
    title: getText('TID_NO_GOLD_TITLE'),
    body,
    buttons: [{ slot: 2, kind: 'gold', label: getText('TID_BUTTON_TEXT_ADDCASH'), onClick: () => uiBus.emit('openAddGold') }],
  });
  p.show();
}

/** ToolBuild.itemAttachedCheckPrice failure path (the build was refused for lack of money). */
export async function handleNeedMoney(ctx: UiContext, need: { coins: number; cash: number }): Promise<void> {
  const k = ctx.game.rules.settings.cashToCoins;
  const { cash } = ctx.game.profile;
  if (need.cash > 0) {
    // cash price first: gold cannot be bought with coins
    await showNotEnoughGold(ctx, { missingGold: cash + need.cash });
    return;
  }
  if (need.coins <= 0) return;
  const gold = goldFor(need.coins, k);
  if (cash >= gold) {
    const p = await createExchangeGoldConfirm(gold, k, () => {
      ctx.game.exchangeGold(gold);
    });
    p.show();
  } else {
    await showNotEnoughGold(ctx, { missingCoins: need.coins });
  }
}
