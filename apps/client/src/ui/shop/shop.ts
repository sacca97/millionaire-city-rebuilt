/**
 * BuyBox (containers/BuyBox.as): the shop popup. hud.swf `shop` frame with the tab buttons, a 4x2 page of item cards
 * (shop.swf shop_box*), page arrows, the featured/new-items side areas and the close button.
 * Buying arms the build tool (BuyBox.placeItem -> toolsBar.setToolBuild) and closes the shop (BuyBox.onClose).
 */
import { Button } from '../../gui/button';
import { getText } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { Widget, type Part } from '../../gui/widget';
import type { UiContext } from '../context';
import { createCard, type CardHandlers, type CardView } from './card';
import {
  ITEMS_PER_PAGE, GRID, locateItem, pageCount, slotOf, tabIndexOf, TAB_FEATURED, TAB_NEW_ITEMS, TYPE_DECORATIONS, TYPE_HOUSES, TYPE_COMMERCES,
  TYPE_WONDERS, type ShopCard,
} from './catalog';
import type { ShopData } from './data';
import { setItemIcon } from './icons';
import { probe } from './measure';
import { openUnlockPopup } from './unlock';

/** hud.swf instance names of the four main tab buttons (ShopTabDefinition sku == instance name). */
const TAB_PARTS: Array<[number, string, string]> = [
  [TYPE_HOUSES, 'Houses', 'TID_BUTTON_HOUSES'],
  [TYPE_COMMERCES, 'Commerces', 'TID_BUTTON_COMMERCES'],
  [TYPE_DECORATIONS, 'Decorations', 'TID_BUTTON_DECORATIONS'],
  [TYPE_WONDERS, 'Wonders', 'TID_BUTTON_WONDERS'],
];

const PAGE_W = GRID.xOffset * 4;
const PAGE_H = GRID.yOffset * 2;
/** 60 px per frame at 30 fps over 540 px (BuyBox.mScrollOffset). */
const SCROLL_MS = 300;

interface Tab {
  index: number;
  button: Button;
  area?: Part;
}

export class Shop {
  private popup: Popup | undefined;
  private widget: Widget | undefined;
  private views: CardView[] = [];
  private tabs: Tab[] = [];
  private selected = -1;
  private page = 0;
  private maxPages = 1;
  private inner: HTMLElement | undefined;
  private arrows: { left: Button; right: Button } | undefined;
  private off: Array<() => void> = [];
  private busy = false;
  private closingForBuy = false;
  private signature = '';
  private featuredTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private ctx: UiContext, private data: ShopData) {}

  get isOpen(): boolean {
    return !!this.popup;
  }

  /** DollarsGame.showBuyBox: opens on the given tab (default Houses). */
  async open(tab?: string | number): Promise<void> {
    if (this.popup || this.busy) {
      if (this.popup && tab !== undefined) await this.selectTab(tabIndexOf(tab));
      return;
    }
    this.busy = true;
    try {
      const w = await Widget.create('hud', 'shop');
      this.widget = w;
      const popup = new Popup(w);
      this.popup = popup;
      this.closingForBuy = false;
      probe().appendChild(popup.boxEl); // attached while texts are fitted; Popup.show moves it to the host

      w.hide('counter_fbc'); // Config.FACEBOOK_CREDITS_AS_CURRENCY is off
      w.hide('offer_day'); // CRM offers: BuyBox.mOffersEnabled stays false without offers
      w.setText('Caption', getText('TID_HINT_MENU_BUTTON_HOUSES'));

      const close = new Button(w.part('mClose'));
      close.onClick(() => popup.close());
      // BuyBox.show: the cancel button stays disabled during the tutorial (BuyBox.as:488-492)
      if (this.ctx.game.tutorial?.active) {
        close.disable();
        popup.closeOnEscape = false;
      }
      this.arrows = { left: new Button(w.part('mArrowLeft')), right: new Button(w.part('mArrowRight')) };
      this.arrows.left.onClick(() => this.pageTo(this.page - 1));
      this.arrows.right.onClick(() => this.pageTo(this.page + 1));

      this.setupTabs(w);

      const viewport = document.createElement('div');
      viewport.className = 'shop-viewport';
      viewport.style.cssText = `position:absolute;left:${GRID.xInit}px;top:${GRID.yInit}px;width:${PAGE_W}px;height:${PAGE_H}px;overflow:hidden;pointer-events:none`;
      this.inner = document.createElement('div');
      this.inner.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;transition:transform ${SCROLL_MS}ms linear;pointer-events:none`;
      viewport.appendChild(this.inner);
      w.root.appendChild(viewport);

      popup.on('close', () => this.onClosed());
      // card states depend on the level, money, unlocks and built wonders (BuyBox.logicUpdate re-checks every frame)
      this.off.push(this.ctx.game.on('profile', () => void this.refresh()));
      this.off.push(this.data.onChange(() => void this.refresh()));

      const first = tab === undefined ? TYPE_HOUSES : tabIndexOf(tab);
      await this.selectTab(first);
      popup.show();
      this.startFeatured();
    } finally {
      this.busy = false;
    }
  }

  private setupTabs(w: Widget): void {
    this.tabs = [];
    for (const [index, part, tid] of TAB_PARTS) {
      const button = new Button(w.part(part));
      button.setLabel(getText(tid));
      const n = this.data.cards(index).length;
      const tut = this.ctx.game.tutorial;
      if (n === 0 || (tut?.active && !tut.shopTabAllowed(index))) button.disable(); // BuyBox.as:458-465
      else button.onClick(() => void this.selectTab(index));
      this.tabs.push({ index, button });
    }
    // BuyBox constructor: tabs outside the main row live in `area_<sku>` clips (new_items, featured)
    const newArea = w.find('area_new_items');
    if (newArea) {
      const b = new Button(newArea.get('new_items'));
      b.setLabel(getText('TID_SHOP_TAB_NEW_ITEM'));
      const n = this.data.cards(TAB_NEW_ITEMS).length;
      if (n === 0 || this.ctx.game.tutorial?.active) {
        // BuyBox.start: empty new-items tab shows `area_comming_soon` and stays disabled
        b.disable();
        void this.showComingSoon(newArea);
      } else b.onClick(() => void this.selectTab(TAB_NEW_ITEMS));
      // BuyBox.setImage (:336): the tab definition's feed image (newitemimage.png) is added into the area's `image` clip
      const holder = newArea.find('image');
      if (holder) {
        const img = new Image();
        img.src = '/gui/feed/newitemimage.png';
        img.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
        holder.el.appendChild(img);
      }
      this.tabs.push({ index: TAB_NEW_ITEMS, button: b, area: newArea });
    }
    const featArea = w.find('area_featured');
    if (featArea) {
      const b = new Button(featArea.get('featured'));
      b.setLabel(getText('TID_SHOP_TAB_FEATURED_ITEM'));
      const n = this.data.cards(TAB_FEATURED).length;
      if (n === 0 || this.ctx.game.tutorial?.active) {
        featArea.hide(); // BuyBox.areasSetAreaEnable(false)
        b.disable();
      } else b.onClick(() => void this.selectTab(TAB_FEATURED));
      this.tabs.push({ index: TAB_FEATURED, button: b, area: featArea });
    }
  }

  /** BuyBox.start: area_comming_soon replaces the first child of area_new_items. */
  private async showComingSoon(area: Part): Promise<void> {
    const cs = await Widget.create('hud', 'area_comming_soon');
    // removeChildAt(0): only the first display-list child (the plate) goes; `image` (skyscraper art) stays
    (area.el.firstElementChild as HTMLElement | null)?.style.setProperty('display', 'none');
    area.el.appendChild(cs.root);
    cs.root.style.transform = 'translate(0px,0px)';
  }

  private styleTabs(): void {
    for (const t of this.tabs) {
      const hit = t.button.el.querySelector<HTMLElement>(':scope > .g-btnhit');
      const down = t.index === this.selected;
      // TabButton.select -> DownState; the selected tab ignores hover
      for (const h of Array.from(t.button.el.querySelectorAll<HTMLElement>(':scope > .g-state'))) {
        const want = down ? 'down' : 'up';
        if (down || h.dataset.state === 'up' || h.dataset.state === 'down') h.style.display = h.dataset.state === want ? '' : 'none';
      }
      if (hit) hit.style.pointerEvents = down ? 'none' : '';
    }
  }

  private handlers: CardHandlers = {
    buy: (card) => this.buy(card),
    unlock: (card) => void openUnlockPopup(this.ctx, this.data, card),
    fan: () => this.ctx.game.toast(getText('TID_FAN_TEXT_1')),
  };

  /** BuyBox.buyItem/placeItem: arm the build tool, drop the grid and close the shop without resetting the tool. */
  private buy(card: ShopCard): void {
    this.closingForBuy = true;
    this.ctx.game.setTool({ kind: 'build', sku: card.item.sku });
    this.popup?.close();
  }

  private async selectTab(tab: number, page = 0): Promise<void> {
    if (!this.widget) return;
    const tut = this.ctx.game.tutorial;
    if (tut?.active && !tut.shopTabAllowed(tab)) return; // BuyBox.changeTab (:960-971)
    const cards = this.data.cards(tab);
    this.selected = tab;
    this.signature = this.sig(tab, cards);
    await this.renderCards(cards, page);
    this.styleTabs();
  }

  private sig(tab: number, cards: ShopCard[]): string {
    return `${tab}|${cards.map((c) => `${c.item.sku}:${c.kind}:${c.unlockGold}:${c.unitsLeft ?? ''}:${c.buyDisabled ? 1 : 0}`).join(',')}`;
  }

  /** BuyBox.logicUpdate: rebuild cards whose state changed (level up unlocks, early unlock, wonder built). */
  private async refresh(): Promise<void> {
    if (!this.popup || this.selected < 0) return;
    const cards = this.data.cards(this.selected);
    const s = this.sig(this.selected, cards);
    if (s === this.signature) return;
    this.signature = s;
    await this.renderCards(cards, this.page);
  }

  private async renderCards(cards: ShopCard[], page: number): Promise<void> {
    const gen = ++this.renderGen;
    const views = await Promise.all(cards.map((c) => createCard(c, this.handlers)));
    if (gen !== this.renderGen || !this.inner) {
      views.forEach((v) => v.destroy());
      return;
    }
    this.views.forEach((v) => v.destroy());
    this.views = views;
    // ItemContentUnlocked.start (:96-103): during the tutorial only the Bungalow / first decoration can be bought
    const tut = this.ctx.game.tutorial;
    if (tut?.active) for (const v of views) if (v.button && !tut.shopBuyAllowed(v.card.item.sku)) v.button.disable();
    this.inner.textContent = '';
    views.forEach((v, i) => {
      const s = slotOf(i);
      // viewport origin == slot 0 (scrollRect starts at XINIT/YINIT)
      v.widget.root.style.transform = `translate(${s.x - GRID.xInit}px,${s.y - GRID.yInit}px)`;
      this.inner!.appendChild(v.widget.root);
    });
    this.maxPages = pageCount(cards.length);
    this.page = Math.min(page, this.maxPages - 1);
    this.inner.style.transition = 'none';
    this.inner.style.transform = `translateX(${-this.page * PAGE_W}px)`;
    void this.inner.offsetWidth;
    this.inner.style.transition = `transform ${SCROLL_MS}ms linear`;
    this.updateArrows();
  }
  private renderGen = 0;

  /** BuyBox.pageLeft/pageRight + checkScrollEnable. */
  private pageTo(p: number): void {
    if (!this.inner || p < 0 || p >= this.maxPages) return;
    this.page = p;
    this.inner.style.transform = `translateX(${-p * PAGE_W}px)`;
    this.updateArrows();
  }

  private updateArrows(): void {
    if (!this.arrows) return;
    this.arrows.left.setEnabled(this.page > 0);
    this.arrows.right.setEnabled(this.page < this.maxPages - 1);
  }

  /**
   * Featured box (FeaturedItemsBox/DynamicItem/FeaturedItemContent): hud.swf `featured_box` at (6.5, 54) inside `area_featured`,
   * showing one featured item (icon + name) and rotating to the next every shopNewItemsTimer ms (10 s). The Specials tab
   * button above it lists all featured items.
   */
  private startFeatured(): void {
    const area = this.tabs.find((t) => t.index === TAB_FEATURED)?.area;
    if (!area || !area.visible) return;
    const list = this.data.cards(TAB_FEATURED);
    if (!list.length) return;
    let i = Math.floor(Math.random() * list.length);
    let current: Widget | undefined;
    const show = async (): Promise<void> => {
      const card = list[i++ % list.length];
      const fw = await Widget.create('hud', 'featured_box');
      probe().appendChild(fw.root);
      fw.setText('Text_info', getText(card.item.tid));
      void setItemIcon(fw.part('container'), card.item.sku).then((ok) => ok && fw.find('loading')?.hide());
      if (!this.popup) {
        fw.destroy();
        return;
      }
      current?.destroy();
      current = fw;
      fw.root.style.transform = 'translate(6.5px,54px)';
      area.el.appendChild(fw.root);
    };
    void show();
    if (list.length > 1) this.featuredTimer = setInterval(() => void show(), 10_000);
    this.off.push(() => {
      clearInterval(this.featuredTimer);
      current?.destroy();
    });
  }

  /** Open at the page/tab where an item lives (BuyBox.searchItem). */
  async search(sku: string): Promise<void> {
    const def = this.data.defs.find((d) => d.sku === sku);
    if (!def) return;
    const loc = locateItem(this.data.defs, sku, this.data.state(), this.data.settings);
    if (!loc) return;
    if (!this.popup) await this.open(loc.tab);
    await this.selectTab(loc.tab, loc.page);
  }

  private onClosed(): void {
    for (const f of this.off.splice(0)) f();
    this.views.forEach((v) => v.destroy());
    this.views = [];
    this.tabs = [];
    this.widget = undefined;
    this.popup = undefined;
    this.inner = undefined;
    this.selected = -1;
    // BuyBox.closeBox: closing without buying returns to the select tool
    if (!this.closingForBuy) this.ctx.game.setTool({ kind: 'select' });
  }

  /** Tutorial arrows: DOM rect of a tab button (`tab`, index) or of the enabled buy button (`buy`, sku). */
  targetRect(kind: 'tab' | 'buy', arg: number | string): DOMRect | undefined {
    const el = kind === 'tab' ? this.tabs.find((t) => t.index === arg)?.button.el : this.views.find((v) => v.card.item.sku === arg)?.button?.el;
    return (el?.querySelector<HTMLElement>(':scope > .g-btnhit') ?? el)?.getBoundingClientRect();
  }
  /** Index of the selected tab (-1 when closed). */
  get selectedTab(): number {
    return this.selected;
  }

  /** Close without touching the tool (e.g. another area took over). */
  close(): void {
    this.popup?.close();
  }

  static get itemsPerPage(): number {
    return ITEMS_PER_PAGE;
  }
}
