/**
 * Shop/storage data store: everything the shop UI needs besides the static definitions.
 * Server lists (UserDataFacade load commands): get_unlocked_items_list (UnlockedListManager.build),
 * get_limited_edition_items_list (LimEdManager.build), get_storage_list (StorageManager.build); rules XML for the
 * settings/unlock segments/gift definitions (RulesFacade, FreeGiftDefinitionManager).
 */
import { parseElements } from '@mcity/rules';
import type { UiContext } from '../context';
import {
  cardsForTab, parseCatalogSettings, parseLimEdList, parseStorageList, parseUnlockedList, sortStorage, typeOfSku,
  type CatalogDef, type CatalogSettings, type CatalogState, type LimEdEntry, type OfferInfo, type ShopCard,
} from './catalog';

const RULES = '/mcity/0.501/Datas/rules/';

export interface GiftDef {
  sku: string;
  tid: string;
  order: number;
  giftType: string;
  action: string;
  value: string;
  maxAmount: number;
}

export interface BoxPrize {
  sku: string;
  box: string;
  type: string;
  value: string;
  resname: string;
  tid: string;
}

/** StorageManager.StoredItem. */
export interface StoredItem {
  sku: string;
  amount: number;
  /** 'item' for placeable items, otherwise the gift type (move, briefcase, rentAcc30...). */
  type: string;
  maxAmount: number;
  tid: string;
  action: 'place' | 'move' | 'openBox' | 'rentAccelerator' | string;
  order: number;
}

async function text(file: string): Promise<string> {
  try {
    const res = await fetch(RULES + file);
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

export class ShopData {
  settings: CatalogSettings;
  readonly limEd = new Map<string, LimEdEntry>();
  readonly offers = new Map<string, OfferInfo>();
  readonly freeItems = new Set<string>();
  private storageRaw: Array<{ sku: string; amount: number }> = [];
  private gifts: GiftDef[] = [];
  private prizes: BoxPrize[] = [];
  private sequence: string[] = [];
  private seqPos = new Map<string, number>();
  private listeners = new Set<() => void>();
  private defList: CatalogDef[];
  npcWonderSku: string | undefined;
  /** Storage changed since the vault alert was last cleared (HUD vault alert). */
  storageChanged = false;

  constructor(private ctx: UiContext) {
    this.settings = { unlockMaxPrice: 65, limEdSoldOutShowTimeHours: 48, cashToCoins: 60000, segments: [] };
    this.defList = [...ctx.defs.values()].map((d) => ({ sku: d.sku, attrs: d.attrs }));
  }

  get unlocked(): Set<string> {
    return this.ctx.game.unlockedSkus;
  }

  static async load(ctx: UiContext): Promise<ShopData> {
    const d = new ShopData(ctx);
    const [settings, segments, visibility, gifts, prizes, seq, npcs, unlocked, limEd, storage] = await Promise.all([
      text('settings.xml'),
      text('unlockSegmentsCash.xml'),
      text('unlockSegmentsVisibility.xml').catch(() => ''),
      text('giftDefinitions.xml'),
      text('boxPrizeDefinition.xml'),
      text('giftSequenceDefinition.xml'),
      text('NPCDefinitions.xml'),
      ctx.conn.query('get_unlocked_items_list').catch(() => undefined),
      ctx.conn.query('get_limited_edition_items_list').catch(() => undefined),
      ctx.conn.query('get_storage_list').catch(() => undefined),
    ]);
    d.settings = parseCatalogSettings(settings, segments, visibility);
    d.gifts = parseElements(gifts, 'Definition').map((a) => ({
      sku: a.sku ?? '', tid: a.tid ?? '', order: Number(a.order ?? 0) || 0, giftType: a.giftType ?? '', action: a.action ?? '',
      value: a.value ?? '', maxAmount: a.maxAmount !== undefined ? Number(a.maxAmount) : -1,
    }));
    d.prizes = parseElements(prizes, 'Definition').map((a) => ({
      sku: a.sku ?? '', box: a.item ?? '', type: a.giftType ?? '', value: a.value ?? '', resname: a.resname ?? '', tid: a.tid ?? '',
    }));
    d.sequence = parseElements(seq, 'Definition').map((a) => a.sku ?? '');
    for (const sku of parseUnlockedList(unlocked?._dat)) d.unlocked.add(sku);
    for (const [k, v] of parseLimEdList(limEd?._dat)) d.limEd.set(k, v);
    d.storageRaw = parseStorageList(storage?._dat);
    // profile.bossGenre -> NPC name (RulesFacade.npcsGetSku) -> wonder_npc_<name>
    const names = parseElements(npcs, 'Definition').map((a) => a.name ?? '');
    const genre = Number(ctx.game.state.profile.raw.bossGenre ?? 0) || 0;
    if (names[genre]) d.npcWonderSku = `wonder_npc_${names[genre]}`;
    // StorageManager.addItem(sku): every stored item changes the set the shop's wonder/club buttons see too
    ctx.game.on('storage-used', ({ sku }) => d.consume(sku));
    ctx.game.on('item-unlocked', () => d.emit());
    return d;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(): void {
    for (const l of [...this.listeners]) l();
  }

  // ---- catalog ---------------------------------------------------------------------------------------------------------

  /** Company.registerOccurrenceGetAmount. */
  built = (sku: string): number => this.ctx.game.items().filter((i) => i.sku === sku).length;

  state(): CatalogState {
    const g = this.ctx.game;
    return {
      level: g.profile.level,
      coins: g.profile.coins,
      cash: g.profile.cash,
      now: this.ctx.conn.now(),
      unlocked: this.unlocked,
      limEd: this.limEd,
      built: this.built,
      isFan: false,
      npcWonderSku: this.npcWonderSku,
      offers: this.offers,
      freeItems: this.freeItems,
    };
  }

  cards(tab: number): ShopCard[] {
    return cardsForTab(this.defList, tab, this.state(), this.settings);
  }

  get defs(): CatalogDef[] {
    return this.defList;
  }

  // ---- storage ---------------------------------------------------------------------------------------------------------

  /** StorageManager.addItem + sortStorage. */
  storage(): StoredItem[] {
    const out: StoredItem[] = [];
    for (const e of this.storageRaw) {
      if (e.amount <= 0) continue;
      const def = this.ctx.defs.get(e.sku);
      let type = e.sku;
      let tid = '';
      let action = '';
      let order = -1;
      let max = -1;
      if (def) {
        type = 'item';
        tid = def.attrs.tid ?? '';
        action = 'place';
        order = 100000 + typeOfSku(e.sku);
      }
      const gift = this.gifts.find((g) => g.giftType === type && (type !== 'item' || g.value === e.sku));
      if (gift) {
        tid = gift.tid;
        max = gift.maxAmount;
        action = gift.action;
        if (order < 0) order = gift.order;
      }
      if (order > -1) out.push({ sku: e.sku, amount: max > -1 ? Math.min(e.amount, max) : e.amount, type, maxAmount: max, tid, action, order });
    }
    return sortStorage(out.map((o) => ({ ...o })));
  }

  add(sku: string, n: number): void {
    const e = this.storageRaw.find((x) => x.sku === sku);
    if (e) e.amount += n;
    else if (n > 0) this.storageRaw.push({ sku, amount: n });
    this.storageChanged = true;
    this.emit();
  }

  /** StorageManager.removeItem. */
  consume(sku: string): void {
    const e = this.storageRaw.find((x) => x.sku === sku);
    if (e) {
      e.amount -= 1;
      if (e.amount <= 0) this.storageRaw = this.storageRaw.filter((x) => x !== e);
    }
    this.emit();
  }

  get storageCount(): number {
    return this.storage().reduce((a, s) => a + s.amount, 0);
  }

  /** FreeGiftDefinitionManager.openBox: next prize of the box's sequence (position kept per box for the session). */
  nextPrize(box: string): BoxPrize | undefined {
    const seq = this.sequence.map((s) => this.prizes.find((p) => p.sku === s)).filter((p): p is BoxPrize => !!p && p.box === box);
    if (!seq.length) return undefined;
    const pos = (this.seqPos.get(box) ?? 0) % seq.length;
    this.seqPos.set(box, (pos + 1) % seq.length);
    return seq[pos];
  }
}
