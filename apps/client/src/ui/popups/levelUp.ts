// Level-up popup. Port of GUI/PopupLevel.as (hud.swf popup_next_level / popup_box_new_building / popup_next_level_information).
// Sound (Level_Sound) is played by the game's 'level_up' sound event. Share button / feed image are Facebook features and are hidden.
// Unlocked-item cards show the item name only (item thumbnails are the shop area's art pipeline).
import { Button } from '../../gui/button';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { localBounds, Widget } from '../../gui/widget';
import type { UiContext } from '../context';
import { setItemIcon } from '../shop/icons';
import { startNoteRain, stopNoteRain } from '../extras/noterain';

const ITEMS_PER_PAGE = 3;
let showing = 0;

/** ItemDefinitionManager.getItemsByLevel(level, -1, isAllowedToBeInLevelUp): shop items unlocked exactly at this level. */
export function unlockedAtLevel(ctx: UiContext, level: number): string[] {
  return unlockedSkusAtLevel(ctx, level).map((s) => ctx.defs.get(s)?.attrs.tid ?? s);
}

export function unlockedSkusAtLevel(ctx: UiContext, level: number): string[] {
  const out: string[] = [];
  for (const d of ctx.defs.values()) {
    if (d.sku === 'HeadQuarter' || d.rules.level !== level || d.attrs.unlockCondition === 'fan') continue;
    if (d.attrs.hidden === '1' || d.attrs.inShop === '0') continue;
    out.push(d.sku);
  }
  return out;
}

export async function openLevelUp(ctx: UiContext, level: number): Promise<void> {
  if (showing === level) return; // game event + bus event for the same level
  showing = level;
  const w = await Widget.create('hud', 'popup_next_level');
  const p = new Popup(w);
  p.on('close', () => {
    showing = 0;
    stopNoteRain(); // PopupLevel.close :446
  });
  w.setText('title_text', getText('TID_POPUP_LEVEL_TITLE'), { fit: true });
  w.part('level').get('level_text').setText(t('TID_POPUP_LEVEL_TEXT', [String(level)]), { fit: true });
  p.wireClose(new Button(w.part('close_button')));
  // PopupLevel ctor (:96-105): Share button (TID_BUTTON_SHARE), feed_image (visible once showPopup loads level_N.jpg; the jpgs are
  // not shipped so the clip's own "Houses Upgraded" art shows, as in the oracle) and feed_text (newsFeeds levelUp text). Share needs
  // Facebook, so it only closes the popup like PopupLevel.onShare's onClose.
  const share = new Button(w.part('share_button'));
  share.setLabel(getText('TID_BUTTON_SHARE'));
  p.wireClose(share);
  w.part('background').get('feed_text').get('TextInfo_02').setText(getText('TID_NEWSFEED_REWARD_PRE_POPUP_LEVEL_UP'));
  const left = new Button(w.part('left_arrow'));
  const right = new Button(w.part('right_arrow'));
  left.part.hide();
  right.part.hide();
  const skus = unlockedSkusAtLevel(ctx, level);
  const items = skus.map((sk) => ctx.defs.get(sk)?.attrs.tid ?? sk);
  const container = w.part('container');
  if (items.length === 0) {
    w.part('unlock_text').hide();
    const info = await Widget.create('hud', 'popup_next_level_information');
    const pick = level === 2 ? ['TID_LEVELUP_HELP1', '05'] : level === 4 ? ['TID_LEVELUP_HELP2', ctx.game.state.profile.raw?.boss_genre === 'female' ? '03' : '02'] : level === 5 ? ['TID_LEVELUP_HELP3', '01'] : [['TID_LEVELUP_HELP1', '05'], ['TID_LEVELUP_HELP4', '04'], ['TID_LEVELUP_HELP3', '01']][level % 3];
    info.setText('info_text', getText(pick[0]), { fit: true });
    try {
      info.part('box_info').append(await Widget.create('hud', `popup_next_level_information_image_${pick[1]}`));
    } catch {
      /* image class missing */
    }
    w.root.appendChild(info.root);
  } else {
    w.setText('unlock_text', t('TID_LEVELUP_NEW_BUILDINGS', [String(items.length)]), { fit: true });
    const cb = localBounds(container.node, true) ?? [0, 0, 330, 140];
    const cw = cb[2] - cb[0];
    const ch = cb[3] - cb[1];
    let page = 0;
    const pages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:0;top:0';
    container.el.appendChild(holder);
    const render = async () => {
      holder.replaceChildren();
      const slice = items.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE);
      const cards: Widget[] = [];
      for (const tid of slice) {
        const c = await Widget.create('hud', 'popup_box_new_building');
        c.setText('title', getText(tid), { fit: true });
        const sku = skus[items.indexOf(tid)];
        void setItemIcon(c.part('container'), sku).then((ok) => ok && c.hide('loading'));
        cards.push(c);
      }
      // PopupLevel.getItems: increment = ceil((containerWidth - n * itemWidth) / (n + 1)); y centred in the container.
      const ib = localBounds(cards[0].node, true) ?? [0, 0, 100, 120];
      const bw = ib[2] - ib[0];
      const gap = Math.ceil((cw - bw * cards.length) / (cards.length + 1));
      cards.forEach((c, i) => {
        c.root.style.transform = `translate(${cb[0] - ib[0] + gap * (i + 1) + bw * i}px,${cb[1] - ib[1] + (ch - (ib[3] - ib[1])) / 2}px)`;
        holder.appendChild(c.root);
      });
      left.setEnabled(page > 0);
      right.setEnabled(page < pages - 1);
    };
    if (pages > 1) {
      left.part.show();
      right.part.show();
      left.onClick(() => {
        page = Math.max(0, page - 1);
        void render();
      });
      right.onClick(() => {
        page = Math.min(pages - 1, page + 1);
        void render();
      });
    }
    await render();
  }
  p.show();
  startNoteRain(); // PopupLevel.showPopup :218
}
