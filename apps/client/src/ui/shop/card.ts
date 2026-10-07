/**
 * One shop item card, ItemContent and its variants (containers/ItemContent*.as) on top of shop.swf's shop_box classes.
 * Which clips are hidden/shown/filled per variant follows the AS (cited per branch).
 */
import { Button } from '../../gui/button';
import { coins as coinSym, convertNumberToString, TRUNCATE_MILLIONS } from '../../gui/format';
import { getText, t } from '../../gui/i18n';
import { attachTooltip } from '../../gui/tooltip';
import { Widget } from '../../gui/widget';
import { convertTimeToString } from '../../gui/format';
import { TYPE_COMMERCES, TYPE_DECORATIONS, TYPE_HOUSES, type ShopCard } from './catalog';
import { ICON_URL, setItemIcon } from './icons';
import { probe } from './measure';

export interface CardHandlers {
  /** BUY_ITEM */
  buy(card: ShopCard): void;
  /** ItemContentLockedByCash.onUnlock -> PopupUnlockItem */
  unlock(card: ShopCard): void;
  /** ItemContentLockedFan.onUnlock (become a fan) */
  fan(card: ShopCard): void;
}

export interface CardView {
  readonly card: ShopCard;
  readonly widget: Widget;
  readonly button?: Button;
  destroy(): void;
}

const hideIf = (w: Widget, name: string): void => {
  w.find(name)?.hide();
};

/** ItemContent.setupBox: title, icon, expire/limited counters (ItemContent.as:60-140). */
function setupCommon(w: Widget, card: ShopCard): void {
  w.setText('mTitle', getText(card.item.tid));
  const counter = w.find('counter');
  if (counter) {
    // limited edition: "N left" (hidden at 0), everything else hides the counter
    if (card.unitsLeft !== undefined) {
      if (card.unitsLeft > 0) counter.get('Items_left').setText(t('TID_ITEMS_LEFT', [String(card.unitsLeft)]));
      else counter.get('Items_left').setText('');
    } else counter.hide();
  }
  const timeLeft = w.find('timeLeft');
  if (timeLeft) {
    if (card.timeLeftMs !== undefined) {
      const ms = card.timeLeftMs;
      const days = Math.floor(ms / 86_400_000);
      let text: string;
      if (days === 0) text = `${Math.ceil(ms / 3_600_000)} ${getText('TID_INVEST_HOURS_LEFT')}`;
      else text = `${Math.ceil(ms / 86_400_000)} ${getText('TID_INVEST_DAYS_LEFT')}`;
      timeLeft.get('Time_left').setText(text);
    } else timeLeft.hide();
  }
}

/** Tooltip standing in for ShopMenuInfo*: size, build time and income. */
function infoText(card: ShopCard): string {
  const it = card.item;
  const lines = [getText(it.tid)];
  lines.push(`${getText('TID_INFO_SIZE')} ${it.cols}x${it.rows}`);
  if (it.type === TYPE_HOUSES || it.type === TYPE_COMMERCES) {
    if (it.constructionTimeMs > 0) lines.push(`${getText('TID_SHOP_BUILD_TIME')} ${convertTimeToString(it.constructionTimeMs, false, true)}`);
  }
  if (it.type === TYPE_COMMERCES && it.incomeValue > 0) lines.push(`${getText('TID_SHOP_RENT')}: ${coinSym(it.incomeValue)}`);
  if (it.type === TYPE_DECORATIONS && it.incomeValue > 0) lines.push(`${getText('TID_SHOPE_INFO_INFLUENCE')} ${it.incomeValue}`);
  return lines.join('\n');
}

/** Replace a button's `icon` placeholder with a resource bitmap (the `new Bitmap(get("gold"))` + removeChild(icon) in the AS). */
function swapIcon(btn: Button, url: string): void {
  for (const ic of btn.part.widget.partsNamed('icon')) ic.setImage(url, { x: 0, y: 0, w: 0, h: 0 }, 'natural');
}

export async function createCard(card: ShopCard, h: CardHandlers): Promise<CardView> {
  const w = await Widget.create('shop', card.box);
  probe().appendChild(w.root); // measured text fitting needs the widget in the document
  setupCommon(w, card);
  const holder = w.part('image');
  void setItemIcon(holder, card.item.sku).then((ok) => {
    if (ok) w.find('loading')?.hide();
  });
  let button: Button | undefined;
  // the art holder has pointer-events:none; add a hit area for the hover info (ItemContentUnlocked.showInfoBox on mImage)
  const hb = holder.bounds() ?? [0, 0, 130, 130];
  const hit = document.createElement('div');
  hit.className = 'g-n g-hit';
  hit.style.cssText = `left:${hb[0]}px;top:${hb[1]}px;width:${hb[2] - hb[0]}px;height:${hb[3] - hb[1]}px`;
  holder.el.appendChild(hit);
  const tip = attachTooltip(hit, infoText(card));
  const kind = card.kind;

  if (kind === 'unlocked' || kind === 'offer' || kind === 'bundle') {
    // ItemContentUnlocked.setupBox (:117-170)
    button = new Button(w.part('unlock_FC'));
    const { price } = card;
    if (price.currency === 'cash') {
      button.setLabel(String(card.offer?.offerType === 'discount' && price.oldAmount !== undefined ? price.oldAmount : price.amount));
      swapIcon(button, ICON_URL.gold);
    } else {
      button.setLabel(price.currency === 'free' ? getText('TID_GEN_FREE') : convertNumberToString(price.amount, TRUNCATE_MILLIONS, 7));
      swapIcon(button, ICON_URL.coins);
    }
    const xp = w.find('Xp');
    if (xp) {
      if (card.exp > 0) xp.setText(t('TID_POINTS_XP', [convertNumberToString(card.exp, 0, 0)]), { fit: false });
      else {
        xp.hide();
        hideIf(w, 'icon_XP');
      }
    }
    // offer/old_prize/bundle badges are hidden unless this is a discount/bundle offer (ItemContentUnlockedOffer.setupBox)
    for (const n of ['offer', 'old_prize']) for (const p of w.partsNamed(n)) p.hide();
    hideIf(w, 'bundle');
    hideIf(w, 'amount');
    if (kind === 'offer' && card.offer?.offerType === 'discount' && price.currency === 'cash') {
      for (const p of w.partsNamed('offer')) {
        p.show();
        p.find('text')?.setText(String(price.amount), { rich: false });
      }
      for (const p of w.partsNamed('old_prize')) p.show();
    }
    if (kind === 'bundle') w.find('bundle')?.show();
    if (card.buyDisabled) button.disable();
    else button.onClick(() => h.buy(card));
  } else {
    // ItemContentLocked.setupBox (:58-80) and subclasses
    hideIf(w, 'sold_out_box');
    const locked = w.find('locked');
    locked?.get('Locked').setText(t('TID_POPUP_LEVEL_TEXT', [String(card.item.level)]));
    if (kind === 'lockedByCash') {
      // ItemContentLockedByCash: `fan` slot becomes the "Unlock" button, unlock_FC removed (:79-107)
      hideIf(w, 'unlock_FC');
      button = new Button(w.part('fan'));
      button.setLabel(getText('TID_PLAY_MMA'));
      button.onClick(() => h.unlock(card));
    } else if (kind === 'lockedFan') {
      hideIf(w, 'unlock_FC');
      locked?.hide();
      button = new Button(w.part('fan'));
      button.setLabel(getText('TID_FAN_TITLE'), { fit: true });
      button.onClick(() => h.fan(card));
    } else if (kind === 'limEdSoldOut') {
      // ItemContentLimEdLocked.setupBox (:12-38)
      w.find('sold_out_box')?.show().get('sold_out').setText('Sold Out');
      for (const n of ['locked', 'counter', 'timeLeft', 'unlock_FC', 'fan']) hideIf(w, n);
    } else {
      // ItemContentLocked.start: unlock_FC removed, `fan` is a disabled "Locked" button
      hideIf(w, 'unlock_FC');
      button = new Button(w.part('fan'));
      button.setLabel(getText('TID_GEN_LOCKED'));
      button.disable();
    }
    holder.setOpacity(0.5); // ItemContentLocked.setupIcon: mImage.alpha = 0.5
  }
  return {
    card,
    widget: w,
    button,
    destroy() {
      tip.destroy();
      button?.destroy();
      w.destroy();
    },
  };
}
