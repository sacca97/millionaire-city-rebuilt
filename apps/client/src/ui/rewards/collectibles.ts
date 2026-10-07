// Collectibles UI: GUI/Collectibles/* (PopupCollectables album, ItemGroupCollectible/ItemCollectibleUnit/ItemCollectibleReward,
// PopupCollectibleBuyAsk, PopupCollectibleConfirmSell, PopupCollectibleFound, PopupCollectibleGroupComplete/Celebrate,
// NewCollectibleBar), collectibles/CollectibleManager.as, art collectables.swf + houses_info.swf.
// Drops: the server awards a collectible when a house reaches GET_RENT and answers with `give_collectible` {sid, sku}
// (Server.as:697, CollectibleManager.addCollectibleToPendingList); the next rent collection leaves the house in mode
// COLLECTIBLE (14) and clicking it keeps the gift (COLLECTIBLE_AUTO_STORAGE_FEATURE) or, at 99 units, offers sell.
// Friend features (send/ask, pending list) are Facebook-only and omitted (ask/gift buttons hidden).
import { Button } from '../../gui/button';
import { coins as fmtCoins } from '../../gui/format';
import { getText, t } from '../../gui/i18n';
import { Popup } from '../../gui/popup';
import { createConfirmPopup } from '../../gui/popups';
import { Widget } from '../../gui/widget';
import { uiBus } from '../bus';
import type { UiContext } from '../context';
import { setItemIcon } from '../shop/icons';
import { probe } from '../shop/measure';
import {
  buildStore, GroupState, parseSetReward, type CollectibleDef, type CollectibleStore, type GroupDef,
} from './collectibles-logic';
import { parseFlags } from '../../game/missions';
import { loadRuleXml } from './rules-xml';
import { childAtFrame, inkFilter, place, playClip } from './util';

const SWF = 'collectables';
const YINIT = -112.05;
const YOFFSET = 179.95;
const XINIT = -289.3;
const VIEW_W = 598.95;

const tid = (s: string) => getText(s);

export class CollectiblesUI {
  store!: CollectibleStore;
  private album?: { popup: Popup; refresh(): void; setTab(commerce: boolean): void };
  private overlay: HTMLElement;
  private icons = new Map<string, HTMLElement>();

  constructor(readonly ctx: UiContext) {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
  }

  async init(): Promise<void> {
    const [c, g, r] = await Promise.all([
      loadRuleXml('collectiblesDefinitions.xml'),
      loadRuleXml('collectiblesGroupsDefinitions.xml'),
      loadRuleXml('collectiblesRewardDefinitions.xml'),
    ]);
    this.store = buildStore(c.children.map((x) => x.a), g.children.map((x) => x.a), r.children.map((x) => x.a));
    await this.reload();
    const { game } = this.ctx;
    game.queue.on((e) => {
      if (e.type === 'giveCollectible') {
        // REQ_GIVE_COLLECTIBLE: "House <sid> will have collectible <sku>"
        const sku = String(e.dat.sku ?? '');
        const sid = String(e.dat.sid ?? '');
        if (sku && sid && this.store.defs.has(sku)) {
          this.store.pending.set(sid, sku);
          game.pendingCollectibles.set(sid, sku);
        }
      }
    });
    game.hooks.collectibleFound = (sid) => void this.onHouseClick(sid);
    game.hooks.giftPlaced = (_sku, ref) => {
      if (ref?.startsWith('coll:')) {
        const group = ref.slice(5);
        this.store.claim(group);
        this.album?.refresh();
        void this.showCelebrate(group);
      }
    };
    uiBus.on('openCollectibles', () => void this.openAlbum());
    const st = document.createElement('style');
    st.textContent = '@keyframes mc-bob{0%,100%{translate:0 0}50%{translate:0 -6px}}';
    document.head.appendChild(st);
    this.ctx.root.appendChild(this.overlay);
    const loop = () => {
      this.updateIcons();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** get_collectibles_list -> store (+ pending map shared with the game). */
  async reload(): Promise<void> {
    const res = await this.ctx.conn.query('get_collectibles_list');
    const list = ((res?._dat as { collectiblesList?: Array<Record<string, unknown>> } | undefined)?.collectiblesList ?? []) as Array<Record<string, unknown>>;
    const attr = (key: string, a: string) => String(list.find((x) => key in x)?.[a] ?? '');
    this.store.load(attr('Objects', 'skus'), attr('Rewards', 'skus'), attr('Pending', 'tupla'));
    const m = this.ctx.game.pendingCollectibles;
    m.clear();
    for (const [sid, sku] of this.store.pending) m.set(sid, sku);
  }

  /** Profile flags (Profile.flagsSetValue -> update_profile {action:"flag"}): set once, mirrored into the raw profile. */
  private flagSet(name: string): boolean {
    const raw = this.ctx.game.state.profile.raw;
    if ((parseFlags(String(raw.flags ?? ''))[name] ?? 0) >= 1) return true;
    raw.flags = [String(raw.flags ?? ''), `${name}:1`].filter(Boolean).join(',');
    this.ctx.game.sendCommand(this.ctx.game.commands.flag(name, 1));
    return false;
  }
  private flagGet(name: string): boolean {
    return (parseFlags(String(this.ctx.game.state.profile.raw.flags ?? ''))[name] ?? 0) >= 1;
  }

  // ---- gift icon above houses showing a collectible (StateOnRent MODE_COLLECTIBLE "Event" clip) --------------------------

  private updateIcons(): void {
    const { game, city } = this.ctx;
    const live = new Set<string>();
    const k = city.world.scale.x;
    for (const it of game.items()) {
      if (it.mode !== 14 || !game.pendingCollectibles.has(it.sid)) continue;
      live.add(it.sid);
      let el = this.icons.get(it.sid);
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none';
        this.icons.set(it.sid, el);
        this.overlay.appendChild(el);
        void Widget.create(SWF, `coll_${game.pendingCollectibles.get(it.sid)}`).then((w) => {
          w.root.style.transform = 'scale(0.55)';
          w.root.style.animation = 'mc-bob 1.2s ease-in-out infinite';
          el!.appendChild(w.root);
        }).catch(() => undefined);
      }
      const cx = (it.tileX + it.cols / 2) * 32 * k + city.world.x;
      const cy = (it.tileY + it.rows / 2) * 32 * k + city.world.y - 20 * k;
      el.style.transform = `translate(${cx}px,${cy}px)`;
    }
    for (const [sid, el] of this.icons) {
      if (!live.has(sid)) {
        el.remove();
        this.icons.delete(sid);
      }
    }
  }

  // ---- click on a COLLECTIBLE house ---------------------------------------------------------------------------------------

  private async onHouseClick(sid: string): Promise<void> {
    const sku = this.ctx.game.pendingCollectibles.get(sid);
    if (!sku) return this.ctx.game.collectibleGotten(sid);
    if (this.store.canKeep(sku)) {
      await this.keepAnimated(sid, sku);
    } else {
      await this.showFound(sid, sku); // STATE_KEEP: cannot keep any more -> sell
    }
  }

  /** CollectibleManager.keepCollectibleTask */
  keep(sid: string, sku: string): void {
    const { game } = this.ctx;
    game.sendCommand(game.commands.collectible('KEEP', { sid, sku, gained: { exp: 0, coins: 0, cash: 0 } }));
    this.store.pending.delete(sid);
    game.collectibleGotten(sid);
    const { completedGroup } = this.store.keep(sku);
    this.album?.refresh();
    void this.showNewBar(sku);
    if (completedGroup) void this.showGroupComplete(completedGroup);
  }

  /** StateOnRent MODE_GIVING_COLLECTIBLE: the `new_<sku>` clip plays over the house, then the gift is kept. */
  private async keepAnimated(sid: string, sku: string): Promise<void> {
    const { game, city } = this.ctx;
    const it = game.item(sid);
    this.ctx.game.pendingCollectibles.delete(sid); // hide the floating icon while the clip plays
    if (it) {
      const k = city.world.scale.x;
      const cx = (it.tileX + it.cols / 2) * 32 * k + city.world.x;
      const cy = (it.tileY + it.rows / 2) * 32 * k + city.world.y;
      try {
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
        host.style.transform = `translate(${cx}px,${cy}px) scale(${Math.max(0.5, k)})`;
        this.overlay.appendChild(host);
        const clip = await playClip(host, SWF, `new_${sku}`, { x: 0, y: 0 }, { fps: 24 });
        await clip.done;
        host.remove();
      } catch {
        /* art missing: keep anyway */
      }
    }
    this.ctx.game.pendingCollectibles.set(sid, sku);
    this.keep(sid, sku);
  }

  // ---- NewCollectibleBar (hud.swf button_gifts) --------------------------------------------------------------------------

  private async showNewBar(sku: string): Promise<void> {
    const def = this.store.defs.get(sku);
    if (!def) return;
    try {
      const w = await Widget.create('hud', 'button_gifts');
      const group = this.store.group(def.collection);
      const rewardSku = group?.reward ?? '';
      const gi = w.part('giftimage');
      const gw = await Widget.create('hud', sku).catch(() => undefined);
      gi.hide();
      if (gw) place(w.root, gw, gi.x, gi.y);
      const ri = w.part('rewardimage');
      const rw = await Widget.create('hud', rewardSku).catch(() => undefined);
      ri.hide();
      if (rw) place(w.root, rw, ri.x, ri.y);
      else if (group?.rewardType === 'item') void setItemIcon(ri, rewardSku).then(() => ri.show());
      w.setText('gift_itemtxt', tid(def.tid), { fit: true });
      const rdef = this.store.rewards.get(rewardSku);
      w.setText('gift_collectiontxt', rdef ? tid(rdef.tid) : '', { fit: true });
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;left:0;bottom:0;pointer-events:none;transition:opacity .4s';
      // button_gifts is authored with y < 0 (above the tools bar): anchor its bottom edge to the lower-left corner.
      w.root.style.transform = 'translate(-20px,-12px)';
      const holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;left:0;bottom:0;width:0;height:0';
      holder.appendChild(w.root);
      el.appendChild(holder);
      this.ctx.root.appendChild(el);
      setTimeout(() => (el.style.opacity = '0'), 2000); // NewCollectibleBar.mMaxTimer
      setTimeout(() => el.remove(), 2500);
    } catch (e) {
      console.warn('new collectible bar', e);
    }
  }

  // ---- PopupCollectibleFound ---------------------------------------------------------------------------------------------

  async showFound(sid: string, sku: string): Promise<void> {
    const w = await Widget.create(SWF, 'popup_new_gift_found');
    const p = new Popup(w);
    const keepOk = this.store.canKeep(sku);
    w.setText('Caption', tid(keepOk ? 'TID_POPUP_COLLECTIBLES_NEW_GIFT_TITLE' : 'TID_POPUP_COLLECTIBLES_OLD_GIFT_TITLE'), { fit: true });
    w.setText(
      'TextInfo_02',
      keepOk ? tid('TID_POPUP_COLLECTIBLES_NEW_GIFT_BODY') : t('TID_COLLECTIBLES_FIND_NOKEEP', ['99']),
      { fit: true },
    );
    const keep = new Button(w.part('keep'));
    keep.setLabel(tid('TID_POPUP_COLLECTIBLES_NEW_GIFT_BUTTON01'));
    const sell = new Button(w.part('sell'));
    sell.setLabel(tid('TID_POPUP_COLLECTIBLES_OLD_GIFT_BUTTON01'));
    w.hide('share'); // send to a friend: Facebook only
    if (keepOk) {
      w.hide('sell');
      keep.onClick(() => { this.keep(sid, sku); p.close(); });
    } else {
      w.hide('keep');
      sell.onClick(() => void this.confirmSell(sid, sku, () => p.close()));
    }
    const icon = await Widget.create(SWF, `coll_${sku}`).catch(() => undefined);
    if (icon) place(w.root, icon, 0, -50);
    p.closeOnEscape = false;
    p.show();
  }

  /** PopupCollectibleConfirmSell (houses_info popup_confirm_buy). */
  private async confirmSell(sid: string, sku: string, done: () => void): Promise<void> {
    const price = this.store.sellValue(sku);
    const w = await Widget.create('houses_info', 'popup_confirm_buy');
    const p = new Popup(w);
    w.part('gold').hide();
    w.setText('mPrize', fmtCoins(price), { fit: true });
    w.setText('TextInfo', tid('TID_POPUP_COLLECTIBLES_SELL_ITEM_TITLE'), { fit: true });
    const ok = new Button(w.part('OkButton'));
    ok.setLabel(tid('TID_POPUP_COLLECTIBLES_OLD_GIFT_BUTTON01'));
    const cancel = new Button(w.part('CancelButton'));
    cancel.setLabel(tid('TID_GEN_BUTTON_CANCEL'));
    cancel.onClick(() => p.close());
    ok.onClick(() => {
      const { game } = this.ctx;
      game.applyGain({ coins: price });
        game.sendCommand(game.commands.collectible('SELL', { sid, sku, gained: { exp: 0, coins: price, cash: 0 } }));
      this.store.pending.delete(sid);
      game.collectibleGotten(sid);
      p.close();
      done();
    });
    p.show();
  }

  // ---- buy (PopupCollectibleBuyAsk TYPE_SHOP_POPUP) ----------------------------------------------------------------------

  private async buyPopup(def: CollectibleDef): Promise<void> {
    const w = await Widget.create('houses_info', 'popup_found_gift');
    const p = new Popup(w);
    const price = def.priceCash;
    w.setText('Caption', tid('TID_COLLECTIBLES_GET_TITLE'), { fit: true });
    w.setText('TextInfo', t('TID_COLLECTIBLES_GET_BODY', [String(price)]), { fit: true });
    w.hide('FCButton'); // Facebook credits are off
    // PopupCollectibleBuyAsk.as:78-92: Ask (friends request, Facebook: offline it opens the neighbor invite) + Buy; the photo clip keeps
    // its own art because the feed jpg is not shipped (oracle shows the "Houses Upgraded" star).
    const ask = new Button(w.part('AcceptButton'));
    ask.setLabel(tid('TID_POPUP_COLLECTIBLES_ASK_ITEM_BUTTON'));
    ask.onClick(() => { p.close(); uiBus.emit('openInvite'); });
    const buy = new Button(w.part('CancelButton'));
    buy.setLabel(tid('TID_POPUP_COLLECTIBLES_BUY_ITEM_BUTTON'));
    p.wireClose(new Button(w.part('mClose')));
    await this.fillFeedPhoto(w);
    buy.onClick(() => {
      const { game } = this.ctx;
      if (game.profile.cash < price) {
        p.close();
        void this.noGold(price - game.profile.cash);
        return;
      }
      game.applyGain({ cash: -price });
        game.sendCommand(game.commands.collectible('BUY', { sid: '-1', sku: def.sku, gained: { exp: 0, coins: 0, cash: -price } }));
      const { completedGroup } = this.store.keep(def.sku);
      this.album?.refresh();
      p.close();
      if (completedGroup) void this.showGroupComplete(completedGroup);
    });
    p.show();
  }

  /** The original loads a feed jpg into `photo`; it is not shipped, and the fallback seen in the oracle is the "Houses Upgraded" star clip. */
  private async fillFeedPhoto(w: Widget): Promise<void> {
    const photo = w.find('photo');
    if (!photo) return;
    const art = await Widget.create('hud', 'popup_next_level');
    const fi = art.part('feed_image');
    const clone = fi.el.cloneNode(true) as HTMLElement;
    const pb = photo.bounds() ?? [0, 0, 0, 0];
    const fb = fi.bounds() ?? [0, 0, 0, 0];
    clone.style.transform = `translate(${pb[0] - fb[0]}px,${pb[1] - fb[1]}px)`;
    clone.style.display = '';
    photo.el.replaceChildren(clone);
  }

  private async noGold(missing: number): Promise<void> {
    const p = await createConfirmPopup({
      title: getText('TID_NO_GOLD_TITLE'),
      body: t('TID_NOT_ENOUGH_GOLD', [0, String(Math.max(1, missing))]),
      buttons: [{ slot: 2, kind: 'gold', label: getText('TID_BUTTON_TEXT_ADDCASH'), onClick: () => uiBus.emit('openAddGold') }],
    });
    p.show();
  }

  // ---- group complete / reward claim -------------------------------------------------------------------------------------

  /** PopupCollectibleGroupComplete (popup_celebrate_building): offer to claim straight away. */
  async showGroupComplete(groupSku: string): Promise<void> {
    const g = this.store.group(groupSku);
    if (!g) return;
    const w = await Widget.create(SWF, 'popup_celebrate_building');
    const p = new Popup(w);
    const name = tid(g.tid);
    w.setText('Caption', t('TID_POPUP_COLLECTIBLES_COLLECTION_COMPLETED_TITLE', [name]), { fit: true });
    w.setText('TextInfo_02', t('TID_POPUP_COLLECTIBLES_COLLECTION_COMPLETED_BODY', [name]), { fit: true });
    const claim = new Button(w.part('share'));
    claim.setLabel(tid('TID_POPUP_COLLECTIBLES_COLLECTION_COMPLETED_BUTTON'));
    const skip = new Button(w.part('skip'));
    skip.onClick(() => p.close());
    claim.onClick(() => { p.close(); void this.openAlbum(g.commerce); });
    await this.putRewardImage(w, g, 'instance', -40);
    p.show();
  }

  /** Reward art: item icon inside `instance`, otherwise the collectables.swf class named after the reward sku. */
  private async putRewardImage(w: Widget, g: GroupDef, holder: string, y: number): Promise<void> {
    if (g.rewardType === 'item') {
      const ph = w.find(holder);
      if (ph) await setItemIcon(ph, g.reward);
      return;
    }
    const img = await Widget.create(SWF, g.reward).catch(() => undefined);
    if (!img) return;
    if (g.rewardType === 'set') {
      img.find('experience')?.hide();
      img.find('Cash')?.hide();
    }
    place(w.root, img, 0, y);
  }

  /** PopupCollectibleManager.claimReward */
  claimReward(g: GroupDef): void {
    const { game } = this.ctx;
    if (this.store.state(g.sku) !== GroupState.PENDING_TO_GET_REWARD) return;
    this.album?.popup.close();
    if (g.rewardType === 'item') {
      // ToolBuild with a free item; the new_item command carries `collectible: <group>` and the server grants the reward.
      game.setTool({ kind: 'build', sku: g.reward, gift: { extra: { key: 'collectible', value: g.sku }, ref: `coll:${g.sku}` } });
      game.toast(getText('TID_POPUP_COLLECTIBLES_COLLECTION_COMPLETED_BUTTON'));
      return;
    }
    let gain = { exp: 0, coins: 0, cash: 0 };
    const rd = this.store.rewards.get(g.reward);
    if (g.rewardType === 'set') gain = parseSetReward(rd?.value);
    game.applyGain(gain);
    game.sendCommand(game.commands.collectible('GET_REWARD', { sid: '-1', sku: g.sku, gained: gain }));
    this.store.claim(g.sku);
    void this.showCelebrate(g.sku);
  }

  /**
   * Reward claimed: PopupCollectibleManager.showCelebratePopup -> PopupPartner(TYPE_SHARE_COMPLETE_COLLECTIBLE_COLLECTION): houses_info
   * popup_publish_nf_reward ("Well Done!", body TID_POPUP_COLLECTIBLES_REWARD_CLAIMED_BODY, news-feed pre-popup text of `collectionCompleted`).
   * The share button posts to Facebook (closed offline), so it only closes.
   */
  private async showCelebrate(groupSku: string): Promise<void> {
    const g = this.store.group(groupSku);
    if (!g) return;
    const w = await Widget.create('houses_info', 'popup_publish_nf_reward');
    const p = new Popup(w);
    const rd = this.store.rewards.get(g.reward);
    w.setText('Caption', tid('TID_POPUP_COLLECTIBLES_REWARD_CLAIMED_TITLE'), { fit: true });
    w.setText('TextInfo', t('TID_POPUP_COLLECTIBLES_REWARD_CLAIMED_BODY', [rd ? tid(rd.tid) : '']), { fit: true });
    w.setText('TextInfo_02', tid('TID_NEWSFEED_REWARD_PRE_POPUP_ALL_UPGRADES_DONE'), { fit: true });
    await this.fillFeedPhoto(w);
    const share = new Button(w.part('AcceptButton')).setLabel(tid('TID_POPUP_COLLECTIBLES_REWARD_CLAIMED_BUTTON'));
    share.onClick(() => p.close());
    p.wireClose(new Button(w.part('CancelButton')));
    p.show();
  }

  // ---- album (PopupCollectables) -------------------------------------------------------------------------------------------

  async openAlbum(commerceTab?: boolean): Promise<void> {
    if (this.album && this.album.popup.open) {
      if (commerceTab !== undefined) this.album.setTab(commerceTab);
      return;
    }
    const w = await Widget.create(SWF, 'popup_background_collectables');
    const p = new Popup(w);
    let commerce = commerceTab ?? false; // Config.COMMERCES: tab 0 = Vault (commerce groups), 1 = Collections (houses)
    let page = 0;
    w.setText('Caption', tid('TID_COLLECTIBLES_SHOP_TITLE'), { fit: true });
    w.hide('counter_fbc'); // FACEBOOK_CREDITS_AS_CURRENCY is off
    const close = new Button(w.part('mClose'));
    p.wireClose(close);
    const help = new Button(w.part('Buttonhelp'));
    // PopupCollectables.as:141 collectiblesSetFirstShown(true) while building the popup; :125-129 the TutorialArrow (rotated -45) sits on the
    // info button until the help was opened once (collectiblesHelpShown2, :318, onHelp :410-419).
    this.flagSet('collectiblesFirstShown');
    let arrow: HTMLElement | undefined;
    if (!this.flagGet('collectiblesHelpShown2')) {
      arrow = this.helpArrow();
      arrow.style.transform = `translate(${help.part.x}px,${help.part.y}px) rotate(-45deg)`;
      w.root.appendChild(arrow);
    }
    help.onClick(() => {
      void this.showHelp();
      if (arrow) {
        arrow.remove();
        arrow = undefined;
        this.flagSet('collectiblesHelpShown2');
      }
    });
    const vaultTab = new Button(w.part('Commerces'));
    vaultTab.setLabel(tid('TID_COLLECTIBLES_SHOP_COMMERCE_BUTTON02'));
    const collTab = new Button(w.part('Decorations'));
    collTab.setLabel(tid('TID_COLLECTIBLES_SHOP_HOUSE_BUTTON01'));
    const up = new Button(w.part('mArrowUp'));
    const down = new Button(w.part('mArrowDown'));
    const empty = w.part('jueves');
    const viewport = document.createElement('div');
    viewport.style.cssText = `position:absolute;left:${XINIT}px;top:${YINIT}px;width:${VIEW_W}px;height:${YOFFSET * 2}px;overflow:hidden;pointer-events:auto`;
    const strip = document.createElement('div');
    strip.style.cssText = 'position:absolute;left:0;top:0;transition:transform .25s linear';
    viewport.appendChild(strip);
    w.root.appendChild(viewport);

    const refresh = async () => {
      const groups = this.store.tab(commerce);
      strip.replaceChildren();
      empty.setText(tid(commerce ? 'TID_COLLECTIBLE_EMPTY_VAULT' : 'TID_COLLECTIBLE_EMPTY_COLLECTIONS'), { fit: true });
      empty.setVisible(groups.length === 0);
      // The vault tab lists commerce groups; "bg" frame 2 shows the vault tab selected (PopupCollectables.getGroups).
      for (let i = 0; i < groups.length; i++) {
        const gw = await this.groupBox(groups[i], i);
        place(strip, gw, 0, i * YOFFSET);
      }
      vaultTab.setTabSelected(commerce); // TabButton.select/unselect (PopupCollectables :357, :646)
      collTab.setTabSelected(!commerce);
      const maxPage = Math.max(0, Math.ceil(groups.length / 2) - 1);
      page = Math.min(page, maxPage);
      strip.style.transform = `translateY(${-page * 2 * YOFFSET}px)`;
      if (page > 0) up.enable(); else up.disable();
      if (page < maxPage) down.enable(); else down.disable();
    };
    up.onClick(() => { page = Math.max(0, page - 1); void refresh(); });
    down.onClick(() => { page += 1; void refresh(); });
    const setTab = (c: boolean) => { commerce = c; page = 0; void refresh(); };
    vaultTab.onClick(() => setTab(true));
    collTab.onClick(() => setTab(false));
    this.album = { popup: p, refresh: () => void refresh(), setTab };
    await refresh();
    p.on('close', () => { if (this.album?.popup === p) this.album = undefined; });
    p.show();
  }

  /** ItemGroupCollectible */
  private async groupBox(g: GroupDef, _index: number): Promise<Widget> {
    const w = await Widget.create(SWF, 'collectableItemGroup');
    probe().appendChild(w.root); // text fitting measures real layout: attach before setting texts
    w.setText('Title', tid(g.tid), { fit: true });
    const members = this.store.members(g.sku);
    const state = this.store.state(g.sku);
    for (let i = 1; i <= 4; i++) {
      const def = members[i - 1];
      if (!def) {
        w.part(`item${i}`).hide();
        continue;
      }
      const count = this.store.count(def.sku);
      const item = childAtFrame(w, SWF, `item${i}`, count > 0 ? 1 : 0); // frame 2 = collected, frame 1 = pending (ItemCollectible)
      item.setText('mTitle', tid(def.tid), { fit: true });
      const mark = item.part('mark');
      const gift = item.find('gift');
      gift?.hide();
      const art = await Widget.create(SWF, def.sku).catch(() => undefined);
      mark.hide();
      if (art) {
        if (count <= 0) art.root.style.filter = inkFilter(); // pending: flat blue silhouette
        place(item.root, art, mark.x, mark.y);
        // keep the counter above the art
        const num = item.part('gift_number');
        item.root.appendChild(num.el);
      }
      const num = item.part('gift_number');
      if (count > 0) num.setText(`x${count < 10 ? '0' : ''}${count}`, { fit: true });
      else num.hide();
      const get = new Button(item.part('BuyButton'));
      get.setLabel(tid('TID_BUTTON_GET'));
      if (state === GroupState.LOCKED || !this.store.canKeep(def.sku)) get.disable();
      else get.onClick(() => void this.buyPopup(def));
      // ItemCollectibleUnit.start :76-81: Gift (TID_BUTTON_GIFT) is enabled when more than one unit is owned. It opens
      // PopupSendCollectible (Facebook friends); offline the only reachable friend list is the neighbor invite.
      const gift2 = new Button(item.part('askButton'));
      gift2.setLabel(tid('TID_BUTTON_GIFT'));
      if (this.store.canGiveAway(def.sku)) gift2.onClick(() => void this.sendGiftPopup());
      else gift2.disable();
    }
    this.fillReward(w, g, state);
    return w;
  }

  /**
   * PopupSendCollectible (:103-125): investment.swf popup_investment_background with title TID_POPUP_COLLECTIBLES_SEND_GIFT_BUTTON,
   * search box, tabs Millionaire friends / Recommended / All friends. Friends come from Facebook; offline the list stays empty (oracle compare4 c-gift).
   */
  private async sendGiftPopup(): Promise<void> {
    const w = await Widget.create('investment', 'popup_investment_background');
    const p = new Popup(w);
    p.wireClose(new Button(w.part('mClose')));
    w.hide('HelpButton');
    w.find('search.SearchText')?.setText('', { rich: false }); // PopupSendCollectible :121 SearchText = ""
    w.setText('Caption', tid('TID_POPUP_COLLECTIBLES_SEND_GIFT_BUTTON'), { fit: true });
    const tabs = [['NewButton', 'TID_GIFTS_TAB_MC'], ['StatisticsButton', 'TID_GIFTS_TAB_RECOMMENDED'], ['CheckButton', 'TID_GIFTS_TAB_ALL']] as const;
    const btns = tabs.map(([n, k]) => { const b = new Button(w.part(n)); b.setLabel(tid(k), { fit: true }); return b; });
    btns[0].setSelected(true);
    btns.forEach((b, i) => b.onClick(() => btns.forEach((o, j) => o.setSelected(i === j))));
    new Button(w.part('mArrowUp')).disable();
    new Button(w.part('mArrowDown')).disable();
    p.show();
  }

  /** ItemCollectibleReward.load/start */
  private fillReward(w: Widget, g: GroupDef, state: number): void {
    const dim = state === GroupState.INCOMPLETED || state === GroupState.LOCKED;
    const rw = childAtFrame(w, SWF, 'reward', dim ? 1 : 0);
    const rd = this.store.rewards.get(g.reward);
    rw.find('gift')?.hide();
    const mark = rw.find('mark');
    mark?.hide();
    rw.setText('mTitle', rd ? tid(rd.tid) : '', { fit: true });
    if (g.rewardType === 'item' && mark) {
      const holder = mark;
      holder.show();
      // ItemCollectibleReward.load :237 hides `mark` (its sunburst art) and loadIcon draws only the building: drop the baked backdrop shape.
      void setItemIcon(holder, g.reward).then(() => {
        for (const im of Array.from(holder.el.querySelectorAll<HTMLImageElement>('img'))) if (/\/shapes\/842\.png/.test(im.src)) im.style.display = 'none';
        if (dim) holder.setOpacity(0.5);
      });
    } else {
      void Widget.create(SWF, g.reward).then((img) => {
        if (g.rewardType === 'set') {
          const v = parseSetReward(rd?.value);
          img.find('experience')?.setText(t('TID_COLLECTIBLES_REWARD_EXP', [String(v.exp)]), { fit: true });
          img.find('Cash')?.setText(t('TID_COLLECTIBLES_REWARD_CASH', [String(v.coins)]), { fit: true });
        }
        if (dim) img.root.style.opacity = '0.5';
        const at = mark ?? rw.part('mTitle');
        // scaleImage: fit into the mark box (height-10 / width-10), never upscale
        const b = mark?.bounds() ?? [-61, -50, 61, 50];
        const ib = img.self.bounds() ?? [-40, -40, 40, 40];
        const k = Math.min(1, (b[3] - b[1] - 10) / Math.max(1, ib[3] - ib[1]), (b[2] - b[0] - 10) / Math.max(1, ib[2] - ib[0]));
        place(rw.root, img, at.x, at.y);
        img.root.style.transform = `translate(${at.x}px,${at.y}px) scale(${k})`;
      }).catch(() => undefined);
    }
    if (g.icon) {
      // ItemCollectibleReward.as:273-277: the shop tab's on-item icon (hud class new_items, caption TID_GEN_NEW) = the green "New!" star.
      void Widget.create('hud', g.icon).then((star) => { star.setText('Caption', tid('TID_GEN_NEW'), { fit: true }); rw.root.appendChild(star.root); }).catch(() => undefined);
    }
    const lock = rw.part('Lock');
    if (state === GroupState.LOCKED) {
      const req = g.requirements ? this.store.group(g.requirements) : undefined;
      const rrd = req ? this.store.rewards.get(req.reward) : undefined;
      lock.get('LockedText').setText(t('TID_COLLECTIBLES_REQUIRED_UNLOCK', [rrd ? tid(rrd.tid) : '']), { fit: true });
    } else {
      lock.hide();
    }
    const done = rw.part('collection_complete');
    done.setVisible(state === GroupState.COMPLETED);
    const claim = new Button(rw.part('claim'));
    claim.setLabel(tid(g.commerce ? 'TID_POPUP_COLLECTIBLES_COLLECTION_COMPLETED_TRADE_BUTTON' : 'TID_POPUP_COLLECTIBLES_COLLECTION_COMPLETED_BUTTON'));
    if (state === GroupState.PENDING_TO_GET_REWARD) claim.onClick(() => this.claimReward(g));
    else if (state === GroupState.INCOMPLETED) claim.disable();
    else rw.hide('claim');
  }

  /** AssetManager.TutorialArrow clip (30 frames, tip at the origin): see ui/tutorial/arrows.ts. */
  private helpArrow(): HTMLElement {
    const dir = '/gui/Dollars/sprites/com.dchoc.framework.utils.AssetManager_TutorialArrow/';
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;transform-origin:0 0';
    const img = document.createElement('img');
    img.style.cssText = 'position:absolute;left:-32px;top:-77px;max-width:none';
    let f = 1;
    img.src = `${dir}1.png`;
    const timer = window.setInterval(() => {
      if (!el.isConnected && f > 1) return window.clearInterval(timer);
      f = (f % 30) + 1;
      img.src = `${dir}${f}.png`;
    }, 1000 / 30);
    el.appendChild(img);
    return el;
  }

  /** PopupHelpCollectibles (STATE_PREV) over PopupHelp: houses_info popup_help_01/02 (boss genre), 4 text pages TID_COLLECTIBLES_HELP1..4, Back/Next. */
  private async showHelp(): Promise<void> {
    const female = String(this.ctx.game.state.profile.raw.bossGenre ?? '0') === '1';
    const w = await Widget.create('houses_info', female ? 'popup_help_02' : 'popup_help_01');
    const p = new Popup(w);
    const text = await Widget.create(SWF, 'help_text').catch(() => undefined);
    if (text) w.root.appendChild(text.root);
    const MAX = 4;
    let page = 0;
    w.setText('Caption', tid('TID_INVEST_HELP_TITLE'), { fit: true });
    const back = new Button(w.part('BackButton')).setLabel(tid('TID_BUTTON_BACK'));
    const next = new Button(w.part('NextButton')).setLabel(tid('TID_BUTTON_NEXT'));
    p.wireClose(new Button(w.part('mClose')));
    const update = () => {
      w.setText('Step', t('TID_TUTORIAL_STEP', [String(page + 1), String(MAX)]), { fit: true });
      text?.setText('TextInfo_01', tid(`TID_COLLECTIBLES_HELP${1 + page}`), { fit: true });
      if (page === 0) back.disable(); else back.enable();
      if (page === MAX - 1) next.disable(); else next.enable();
    };
    back.onClick(() => { if (page > 0) { page -= 1; update(); } });
    next.onClick(() => { if (page < MAX - 1) { page += 1; update(); } });
    update();
    p.show();
  }
}

export async function mountCollectibles(ctx: UiContext): Promise<CollectiblesUI> {
  const ui = new CollectiblesUI(ctx);
  await ui.init();
  (window as unknown as { __collectibles?: CollectiblesUI }).__collectibles = ui;
  return ui;
}
