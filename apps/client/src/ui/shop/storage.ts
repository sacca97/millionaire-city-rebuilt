/**
 * Storage / vault popup (GUI/storage/PopupStorage.as, StorageItemContent.as, PopupBoxOpen.as): Storage.swf popup_storage
 * with storage_box cards, 4 per page. "Use": place -> build tool fromStorage (free, the server consumes the entry through
 * new_item `storage`); openBox -> next prize of the box sequence (update_money openBox) shown in popup_box_open.
 */
import { Button } from '../../gui/button';
import { coins as coinSym } from '../../gui/format';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget, localBounds, type Part } from '../../gui/widget';
import type { UiContext } from '../context';
import { uiBus } from '../bus';
import type { BoxPrize, ShopData, StoredItem } from './data';
import { putBitmap, setItemIcon } from './icons';
import { probe } from './measure';

export const STORAGE_ITEMS_PER_PAGE = 4;
const FREEGIFTS = '/mcity/0.501/Datas/freegifts/';
const SCROLL_MS = 300;

/** PopupStorage.setStorageItemPosition: even spacing, increment = ceil((area - n*w)/(n+1)) over at most one page. */
export function storageLayout(count: number, areaW: number, areaH: number, itemW: number, itemH: number): { increment: number; xs: number[]; y: number; pageW: number } {
  const n = Math.min(count, STORAGE_ITEMS_PER_PAGE);
  const increment = n > 0 ? Math.ceil((areaW - itemW * n) / (n + 1)) : 0;
  const xs = Array.from({ length: count }, (_, i) => (itemW + increment) * i + increment);
  return { increment, xs, y: (areaH - itemH) >> 1, pageW: (itemW + increment) * STORAGE_ITEMS_PER_PAGE };
}

/** FreeGiftPrize caption (PopupBoxOpen constructor :40-75). */
export function prizeCaption(p: BoxPrize, level: number, itemName: string): string {
  switch (p.type) {
    case 'cash':
      return `${getText(p.tid)}${(Number(p.value) * level).toLocaleString('en-US')}`;
    case 'gold':
      return `${p.value} ${getText(p.tid)}`;
    case 'move':
      return t(p.tid, [p.value]);
    case 'item':
      return itemName;
    default:
      return t(p.tid, [p.value]);
  }
}

export class StoragePopup {
  private popup: Popup | undefined;
  private busy = false;

  constructor(private ctx: UiContext, private data: ShopData) {}

  get isOpen(): boolean {
    return !!this.popup;
  }

  async open(): Promise<void> {
    if (this.popup || this.busy) return;
    this.busy = true;
    try {
      const { ctx, data } = this;
      const w = await Widget.create('Storage', 'popup_storage');
      const popup = new Popup(w);
      this.popup = popup;
      probe().appendChild(popup.boxEl);
      w.setText('Title', getText('TID_POPUP_STORAGE_TITLE'));
      w.part('text_info').get('text_info').setText(getText('TID_STORAGE_EMPTY'));
      const close = new Button(w.part('mClose'));
      close.onClick(() => popup.close());
      const left = new Button(w.part('arrow_left'));
      const right = new Button(w.part('arrow_right'));

      const area = w.part('popup_area');
      const ab = localBounds(area.node, true) ?? [0, 0, 570, 220];
      const aw = ab[2] - ab[0];
      const ah = ab[3] - ab[1];
      const viewport = document.createElement('div');
      viewport.style.cssText = `position:absolute;left:${ab[0]}px;top:${ab[1]}px;width:${aw}px;height:${ah}px;overflow:hidden;pointer-events:none`;
      const inner = document.createElement('div');
      inner.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;transition:transform ${SCROLL_MS}ms linear`;
      viewport.appendChild(inner);
      area.el.appendChild(viewport);

      let page = 0;
      let pageW = 0;
      let maxPage = 0;
      let boxes: Array<{ w: Widget; btn: Button }> = [];
      const arrows = (): void => {
        left.setEnabled(page > 0);
        right.setEnabled(page < maxPage);
      };
      const go = (p: number): void => {
        if (p < 0 || p > maxPage) return;
        page = p;
        inner.style.transform = `translateX(${-page * pageW}px)`;
        arrows();
      };
      left.onClick(() => go(page - 1));
      right.onClick(() => go(page + 1));

      const build = async (): Promise<void> => {
        for (const b of boxes) {
          b.btn.destroy();
          b.w.destroy();
        }
        boxes = [];
        inner.textContent = '';
        const items = data.storage();
        w.part('text_info').setVisible(items.length === 0);
        const made = await Promise.all(items.map((it) => this.makeBox(it, popup)));
        const first = made[0]?.w;
        const fb = first ? localBounds(first.node, true) : null;
        const iw = fb ? fb[2] - fb[0] : 132;
        const ih = fb ? fb[3] - fb[1] : 190;
        const lay = storageLayout(items.length, aw, ah, iw, ih);
        made.forEach((m, i) => {
          m.w.root.style.transform = `translate(${lay.xs[i]}px,${lay.y}px)`;
          inner.appendChild(m.w.root);
        });
        boxes = made;
        pageW = lay.pageW;
        maxPage = Math.max(0, Math.ceil(items.length / STORAGE_ITEMS_PER_PAGE) - 1);
        page = Math.min(page, maxPage);
        inner.style.transition = 'none';
        inner.style.transform = `translateX(${-page * pageW}px)`;
        void inner.offsetWidth;
        inner.style.transition = `transform ${SCROLL_MS}ms linear`;
        arrows();
      };
      await build();
      // StorageManager.hasChanged -> rebuild (logicUpdate)
      const off = data.onChange(() => void build());
      popup.on('close', () => {
        off();
        for (const b of boxes) {
          b.btn.destroy();
          b.w.destroy();
        }
        this.popup = undefined;
      });
      data.storageChanged = false; // vault alert cleared while the storage is open
      popup.show();
    } finally {
      this.busy = false;
    }
  }

  /** StorageItemContent. */
  private async makeBox(it: StoredItem, popup: Popup): Promise<{ w: Widget; btn: Button }> {
    const w = await Widget.create('Storage', 'storage_box');
    probe().appendChild(w.root);
    w.setText('title', t(it.tid) === it.tid ? it.sku : getText(it.tid));
    w.setText('counter', it.maxAmount > -1 ? `${it.amount}/${it.maxAmount}` : String(it.amount));
    const holder = w.part('instance');
    const hb = holder.bounds() ?? [0, 0, 125, 105];
    // DCResourceManager.get(mType): freegifts/<type>.png centred in the holder; placeable items add the item art on top
    const img = putBitmap(holder, `${FREEGIFTS}${it.type}.png`);
    img.onload = () => {
      img.style.left = `${hb[0] + (hb[2] - hb[0] - img.naturalWidth) / 2}px`;
      img.style.top = `${hb[1] + (hb[3] - hb[1] - img.naturalHeight) / 2}px`;
    };
    if (it.action === 'place') void setItemIcon(holder, it.sku);
    const btn = new Button(w.part('button_use'));
    btn.setLabel(getText('TID_STORAGE_USE_BUTTON'));
    if (it.action === 'place' || it.action === 'openBox' || it.action === 'rentAccelerator') btn.onClick(() => this.use(it, popup));
    else btn.disable(); // move needs an item target (ToolMove free): not ported yet
    return { w, btn };
  }

  /** PopupStorage.onCloseStorage / onOpenBox. */
  private use(it: StoredItem, popup: Popup): void {
    const { game } = this.ctx;
    if (it.action === 'place') {
      popup.close();
      // ToolsBar.setToolBuild(def, true, cmdCreateNewItemFromStorage, false, "storage")
      game.setTool({ kind: 'build', sku: it.sku, fromStorage: true });
    } else if (it.action === 'rentAccelerator') {
      // ToolsBar.setToolRentAccelerator: ui/economy turns the pointer into the accelerator (percent = giftDefinitions value, e.g. rentAcc30)
      popup.close();
      uiBus.emit('startAccelerator', { sku: it.sku, percent: Number(/\d+/.exec(it.type)?.[0] ?? 0), amount: it.amount });
    } else if (it.action === 'openBox') {
      const prize = this.data.nextPrize(it.type);
      if (!prize) return;
      game.applyBoxPrize({ sku: prize.sku, type: prize.type, value: prize.value });
      this.data.consume(it.sku);
      if (prize.type === 'move') this.data.add('move', Number(prize.value) || 0);
      else if (prize.type === 'item') this.data.add(prize.value, 1);
      void this.showPrize(prize);
    }
  }

  /** PopupBoxOpen. */
  private async showPrize(p: BoxPrize): Promise<void> {
    const w = await Widget.create('Storage', 'popup_box_open');
    const pop = new Popup(w);
    probe().appendChild(pop.boxEl);
    const holder = w.part('instance');
    const img = putBitmap(holder, `${FREEGIFTS}${p.resname}.png`);
    const hb = holder.bounds() ?? [0, 0, 198, 164];
    img.onload = () => {
      img.style.left = `${hb[0] + (hb[2] - hb[0] - img.naturalWidth) / 2}px`;
      img.style.top = `${hb[1] + (hb[3] - hb[1] - img.naturalHeight) / 2}px`;
    };
    if (p.type === 'item') void setItemIcon(holder, p.value);
    const def = this.ctx.defs.get(p.value);
    w.setText('Title', getText('TID_BRIEFCASE_POPUP_TITLE'));
    const name = def ? getText(def.attrs.tid ?? '') : '';
    w.setText('Caption', p.type === 'cash' ? `${coinSym(Number(p.value) * this.ctx.game.profile.level)}` : prizeCaption(p, this.ctx.game.profile.level, name));
    w.hide('publish'); // Facebook feed post
    pop.wireClose(new Button(w.part('mClose')));
    pop.show();
  }
}
