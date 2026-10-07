/**
 * PopupUnlockItem (GUI/PopupUnlockItem.as): "Architect's Studio" early-unlock confirmation for a level-locked item,
 * houses_info.swf popup_Unlock. Accept pays getUnlockPrice(false) gold (UnlockedListManager.unlockItem -> update_money
 * "unlockItem"); without enough gold the "Not Enough Gold" dialog (PopupConfirm.startNoEnoughGold) opens instead.
 */
import { Button } from '../../gui/button';
import { coins as coinSym, convertNumberToString, TRUNCATE_MILLIONS } from '../../gui/format';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget } from '../../gui/widget';
import type { UiContext } from '../context';
import type { ShopCard } from './catalog';
import type { ShopData } from './data';
import { ICON_URL, setItemIcon } from './icons';
import { probe } from './measure';
import { showNotEnoughGold } from './money';

export async function openUnlockPopup(ctx: UiContext, data: ShopData, card: ShopCard): Promise<void> {
  const w = await Widget.create('houses_info', 'popup_Unlock');
  const p = new Popup(w);
  probe().appendChild(p.boxEl);
  const gold = card.unlockGold;
  const name = getText(card.item.tid);
  // no Facebook credits: the FCButton variant is removed, `actionButton` is "Unlock"
  w.hide('FCButton');
  const ok = new Button(w.part('actionButton'));
  ok.setLabel(getText('TID_PLAY_MMA'));
  const skip = new Button(w.part('skipButton'));
  p.wireClose(skip);
  w.setText('Title', t('TID_POPUP_EARLY_UNLOCK_TITLE', [name]));
  w.setText('TextInfo', t('TID_POPUP_EARLY_UNLOCK_BODY', [name, String(gold)]), { fit: true });

  // setupItem (:100-160): the item card inside the popup
  const item = w.part('mItem');
  item.get('mTitle').setText(name);
  const prize = item.find('mPrize');
  const price = card.price;
  if (prize) {
    prize.setText(price.currency === 'cash' ? String(price.amount) : coinSym(price.amount, TRUNCATE_MILLIONS, 7), { fit: true });
  }
  item.find('gold')?.setImage(price.currency === 'cash' ? ICON_URL.gold : ICON_URL.coins, { x: 0, y: 0, w: 0, h: 0 }, 'natural');
  const xp = item.find('Xp');
  if (xp) xp.setText(t('TID_POINTS_XP', [convertNumberToString(card.exp, 0, 0)]), { fit: false });
  item.find('timeLeft')?.hide();
  const img = item.find('image');
  if (img) void setItemIcon(img, card.item.sku);

  ok.onClick(() => {
    p.accept();
  });
  p.on('accept', () => {
    if (ctx.game.profile.cash >= gold) {
      if (ctx.game.unlockItem(card.item.sku, gold)) data.emit();
    } else {
      void showNotEnoughGold(ctx, { missingGold: gold });
    }
  });
  p.show();
}
