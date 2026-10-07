import { readFileSync } from 'node:fs';
import { parseElements } from '@mcity/rules';
import { describe, expect, it } from 'vitest';
import {
  buildCard, cardsForTab, compareItems, limEdUnits, locateItem, pageCount, parseCatalogSettings, parseLimEdList, parseShopItem,
  parseStorageList, parseUnlockedList, slotOf, tabCounts, tabIndexOf, unlockPrice, unlockSegmentsPrice,
  TAB_FEATURED, TAB_NEW_ITEMS, TYPE_COMMERCES, TYPE_DECORATIONS, TYPE_HOUSES, TYPE_WONDERS, type CatalogDef, type CatalogState,
} from './catalog';

const RULES = new URL('../../../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/', import.meta.url);
const read = (f: string): string => readFileSync(new URL(f, RULES), 'utf8');
const defs: CatalogDef[] = ['itemDefinitions.xml', 'commerceDefinitions.xml', 'decorationDefinitions.xml', 'wonderDefinitions.xml', 'clubDefinitions.xml']
  .flatMap((f) => parseElements(read(f), 'Definition'))
  .filter((a) => a.sku)
  .map((a) => ({ sku: a.sku, attrs: a }));
const settings = parseCatalogSettings(read('settings.xml'), read('unlockSegmentsCash.xml'));
const NOW = new Date(2026, 9, 6).getTime();
const state = (over: Partial<CatalogState> = {}): CatalogState => ({
  level: 1, coins: 380000, cash: 0, now: NOW, unlocked: new Set(), limEd: new Map(), built: () => 0, isFan: false, ...over,
});

describe('shop catalog', () => {
  it('parses settings', () => {
    expect(settings.unlockMaxPrice).toBe(65);
    expect(settings.segments[0]).toEqual({ levelStart: 0, levelEnd: 6, baseCash: 1 });
  });

  it('houses tab is sorted by level then price, HQ excluded', () => {
    const items = cardsForTab(defs, TYPE_HOUSES, state(), settings).map((c) => c.item);
    expect(items.length).toBeGreaterThan(20);
    expect(items.some((i) => i.isHQ)).toBe(false);
    for (let i = 1; i < items.length; i += 1) expect(items[i].level).toBeGreaterThanOrEqual(items[i - 1].level);
    expect(items[0].sku).toBe('houses_001_001');
  });

  it('level-locked items become unlock-by-gold cards with a capped price', () => {
    const cards = cardsForTab(defs, TYPE_HOUSES, state({ level: 1 }), settings);
    const first = cards[0];
    expect(first.kind).toBe('unlocked');
    expect(first.price).toEqual({ currency: 'coins', amount: 30000 });
    const locked = cards.find((c) => c.item.level > 1)!;
    expect(locked.kind).toBe('lockedByCash');
    expect(locked.box).toBe('shop_box_locked');
    expect(locked.unlockGold).toBeGreaterThan(0);
    expect(locked.unlockGold).toBeLessThanOrEqual(65);
  });

  it('early unlock removes the lock', () => {
    const sku = cardsForTab(defs, TYPE_HOUSES, state(), settings).find((c) => c.kind === 'lockedByCash')!.item.sku;
    const c = cardsForTab(defs, TYPE_HOUSES, state({ unlocked: new Set([sku]) }), settings).find((x) => x.item.sku === sku)!;
    expect(c.kind).toBe('unlocked');
  });

  it('unlock price sums the base gold of every level from the current to the item level', () => {
    // levels 1..3 are all in segment 0..6 (1 gold each): 1,2,3 -> 3
    expect(unlockSegmentsPrice(1, 3, settings.segments)).toBe(3);
    // levels 5..8: 1+1+2+2 = 6
    expect(unlockSegmentsPrice(5, 8, settings.segments)).toBe(6);
    expect(unlockSegmentsPrice(5, 5, settings.segments)).toBe(0);
    const it = parseShopItem(defs.find((d) => d.attrs.level === '60' && d.sku.startsWith('houses'))!);
    expect(unlockPrice(it, state({ level: 1 }), settings)).toBe(65);
  });

  it('cash items show gold, free items show free', () => {
    const cash = defs.find((d) => d.attrs.constructionCash && d.attrs.constructionCash !== '0' && d.sku.startsWith('decorations') && !d.attrs.expireTime && !d.attrs.shopTab)!;
    const card = buildCard(parseShopItem(cash), 0, state({ level: 200 }), settings);
    expect(card.price.currency).toBe('cash');
    const free = buildCard(parseShopItem(cash), 0, state({ level: 200, freeItems: new Set([cash.sku]) }), settings);
    expect(free.price.currency).toBe('cash');
    expect(free.price.amount).toBe(0);
  });

  it('expired items (expireTime before 16:01:2012, the oracle boundary) are not listed; the 16:01:2012 new_items still are', () => {
    expect(cardsForTab(defs, TAB_NEW_ITEMS, state(), settings).length).toBeGreaterThan(0);
    const before = cardsForTab(defs, TYPE_DECORATIONS, state({ now: new Date(2010, 5, 1).getTime(), level: 200 }), settings).length;
    const after = cardsForTab(defs, TYPE_DECORATIONS, state({ level: 200 }), settings).length;
    expect(before).not.toBe(after);
  });

  it('limited editions: units left from XML offline, server entry overrides, sold out shows a sold-out card for 48h', () => {
    const lim = defs.find((d) => d.attrs.shopTab === 'limEd' && d.sku.startsWith('wonder'))!;
    const item = parseShopItem(lim);
    expect(limEdUnits(item, state())).toBe(item.unitsAmount);
    const wonders = (st: CatalogState) => cardsForTab(defs, TYPE_WONDERS, st, settings).find((c) => c.item.sku === lim.sku);
    const normal = wonders(state({ level: 200 }))!;
    expect(normal.kind).toBe('unlocked');
    expect(normal.unitsLeft).toBe(item.unitsAmount);
    const server = wonders(state({ level: 200, limEd: new Map([[lim.sku, { units: 42, lastLegalBuyTime: 0 }]]) }))!;
    expect(server.unitsLeft).toBe(42);
    const sold = wonders(state({ level: 200, limEd: new Map([[lim.sku, { units: 0, lastLegalBuyTime: NOW - 3_600_000 }]]) }))!;
    expect(sold.kind).toBe('limEdSoldOut');
    const gone = wonders(state({ level: 200, limEd: new Map([[lim.sku, { units: 0, lastLegalBuyTime: NOW - 49 * 3_600_000 }]]) }));
    expect(gone).toBeUndefined();
  });

  it('wonders already built have a disabled button; npc wonders only for the advisor', () => {
    const cards = cardsForTab(defs, TYPE_WONDERS, state({ level: 200, built: (s) => (s === 'wonder_statue_of_money' ? 1 : 0), npcWonderSku: 'wonder_npc_Ronald' }), settings);
    expect(cards.find((c) => c.item.sku === 'wonder_statue_of_money')!.buyDisabled).toBe(true);
    expect(cards.some((c) => c.item.sku === 'wonder_npc_Cindy')).toBe(false);
    expect(cards.some((c) => c.item.sku === 'wonder_npc_Ronald')).toBe(true);
    expect(cards.find((c) => c.item.sku === 'wonder_statue_of_money')!.box).toBe('shop_box_wonder');
  });

  it('discount offers lower the price and show the old one', () => {
    const sku = 'houses_001_001';
    const c = cardsForTab(defs, TYPE_HOUSES, state({ offers: new Map([[sku, { offerType: 'discount', amount: 0.5 }]]) }), settings).find((x) => x.item.sku === sku)!;
    expect(c.kind).toBe('offer');
    expect(c.box).toBe('shop_box_promoted');
    expect(c.price).toEqual({ currency: 'coins', amount: 15000, oldAmount: 30000 });
  });

  it('featured tab and tab counts', () => {
    const counts = tabCounts(defs, state({ level: 80 }), settings);
    expect(counts[TYPE_HOUSES]).toBeGreaterThan(0);
    expect(counts[TYPE_COMMERCES]).toBeGreaterThan(0);
    expect(counts[TAB_NEW_ITEMS]).toBeGreaterThan(0);
    expect(typeof counts[TAB_FEATURED]).toBe('number');
  });

  it('grid layout and paging', () => {
    expect(slotOf(0)).toEqual({ x: -190.3, y: -105, page: 0 });
    expect(slotOf(5).x).toBeCloseTo(-190.3 + 135);
    expect(slotOf(5).y).toBeCloseTo(-105 + 190.1);
    expect(slotOf(8).page).toBe(1);
    expect(slotOf(8).x).toBeCloseTo(-190.3 + 135 * 4);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(8)).toBe(1);
    expect(pageCount(9)).toBe(2);
  });

  it('locates items for search and maps HUD tab names', () => {
    expect(locateItem(defs, 'houses_001_001', state(), settings)).toEqual({ tab: 0, page: 0 });
    expect(tabIndexOf('Commerces')).toBe(1);
    expect(tabIndexOf('decorations')).toBe(2);
    expect(tabIndexOf(undefined)).toBe(0);
  });

  it('parses the server lists', () => {
    expect([...parseUnlockedList({ unlockedList: [{ item: [], sku: 'a' }, { item: [], sku: 'b' }] })]).toEqual(['a', 'b']);
    expect(parseStorageList({ storageList: [{ item: [], sku: 'x', amount: '3' }, { item: [], sku: 'y', amount: '0' }] })).toEqual([{ sku: 'x', amount: 3 }]);
    expect(parseLimEdList({ limEdList: [{ limEd: [], sku: 'z', unitsAmount: '5', lastLegalBuyTime: '0' }] }).get('z')).toEqual({ units: 5, lastLegalBuyTime: 0 });
  });

  it('compareItems orders by level, then cheaper coins first', () => {
    const a = parseShopItem({ sku: 'a', attrs: { level: '2', constructionCoins: '100', exp: '1' } });
    const b = parseShopItem({ sku: 'b', attrs: { level: '2', constructionCoins: '200', exp: '1' } });
    const c = parseShopItem({ sku: 'c', attrs: { level: '1', constructionCoins: '900', exp: '1' } });
    expect([b, a, c].sort(compareItems).map((x) => x.sku)).toEqual(['c', 'a', 'b']);
  });
});
