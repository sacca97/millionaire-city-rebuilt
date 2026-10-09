/**
 * Shop data model (pure, no DOM): which items each shop tab lists, in which order and in which state.
 * Ported from the original client:
 *  - tabs: rules/gui/shopTabDefinitions.xml (ids = index: Houses 0, Commerces 1, Decorations 2, Wonders 3, Clubs 4, Bundles 5,
 *    new_items 6, featured 7, limEd 8) and ItemDefinition.TYPE_*_ID (ItemDefinition.as:54-64)
 *  - visibility: ItemDefinition.isAllowedToBeInShop (ItemDefinition.as:1189-1245)
 *  - locking: ItemDefinition.isLocked (:702-728), getUnlockPrice (:1163-1177), RulesFacade.unlockSegmentsGetPrice (:878-906)
 *  - card state: BuyBox.checkContentState (BuyBox.as:~690-760)
 *  - price/button: ItemContentUnlocked.setupBox (ItemContentUnlocked.as:~120-170), getConstructionCoins/Cash with offers (:1002+)
 *  - ordering: DefinitionManager.sortCompareFunction (level) + ItemDefinitionManager.sortCompareSameLevelFunction (coins, exp)
 *    and sortCompareFeaturedFunction (offers, bundles first)
 */

import { parseElements } from '@mcity/rules';

export const SHOP_TABS = ['Houses', 'Commerces', 'Decorations', 'Wonders', 'Clubs', 'Bundles', 'new_items', 'featured', 'limEd'] as const;
export type ShopTabSku = (typeof SHOP_TABS)[number];
export const TYPE_HOUSES = 0;
export const TYPE_COMMERCES = 1;
export const TYPE_DECORATIONS = 2;
export const TYPE_WONDERS = 3;
export const TYPE_CLUBS = 4;
export const TYPE_BUNDLE = 5;
export const TAB_NEW_ITEMS = 6;
export const TAB_FEATURED = 7;
/** Items per page: 4 columns x 2 rows (BuyBox.MAX_ITEMS_PAGE). */
export const ITEMS_PER_PAGE = 8;

/** Accepts the sku from the HUD ('Houses', 'commerces', 'build'...) or a tab index. */
export function tabIndexOf(tab: string | number | undefined): number {
  if (typeof tab === 'number') return tab;
  if (!tab) return TYPE_HOUSES;
  const l = tab.toLowerCase();
  const i = SHOP_TABS.findIndex((s) => s.toLowerCase() === l || s.toLowerCase() === `${l}s` || s.toLowerCase().replace(/s$/, '') === l);
  return i < 0 ? TYPE_HOUSES : i;
}

/** The part of a definition the shop needs: the sku plus the raw XML attributes. */
export interface CatalogDef {
  sku: string;
  attrs: Record<string, string>;
}

export interface UnlockSegment {
  levelStart: number;
  levelEnd: number;
  baseCash: number;
}

export interface CatalogSettings {
  /** settings.xml @unlockMaxPrice (gold cap for early unlock). */
  unlockMaxPrice: number;
  /** unlockSegmentsCash.xml */
  segments: UnlockSegment[];
  /** unlockSegmentsVisibility.xml: how many levels above the current one may be unlocked with gold (mode LIMITED, the default). */
  visibility?: { levelStart: number; levelsVisible: number }[];
  /** settings.xml @limEdSoldOutShowTime (hours the sold-out card stays visible). */
  limEdSoldOutShowTimeHours: number;
  /** settings.xml @cashToCoins */
  cashToCoins: number;
}

export interface OfferInfo {
  offerType: 'discount' | 'bundle';
  /** discount: fraction (0.5); bundle: number of extra units. */
  amount: number;
}

export interface LimEdEntry {
  units: number;
  /** ms epoch of the last legal purchase (0 = still available). */
  lastLegalBuyTime: number;
}

export interface CatalogState {
  level: number;
  coins: number;
  cash: number;
  /** Server clock (ms). */
  now: number;
  /** get_unlocked_items_list + units unlocked in this session. */
  unlocked: ReadonlySet<string>;
  /** get_limited_edition_items_list. Items without an entry keep the XML unitsAmount (offline behaviour). */
  limEd: ReadonlyMap<string, LimEdEntry>;
  /** Company.registerOccurrenceGetAmount: how many of this sku are already built. */
  built: (sku: string) => number;
  isFan: boolean;
  /** wonder_npc_<name> of the current advisor (profile.bossGenre -> NPCDefinitions name). */
  npcWonderSku?: string;
  offers?: ReadonlyMap<string, OfferInfo>;
  /** OfferManager free items (price 0). */
  freeItems?: ReadonlySet<string>;
}

export type CardKind =
  | 'unlocked'
  | 'offer'
  | 'bundle'
  | 'locked'
  | 'lockedByCash'
  | 'lockedFan'
  | 'lockedCross'
  | 'limEdSoldOut';

/** Which shop.swf class the card uses (ItemContent.getBox overrides). */
export type BoxClass = 'shop_box' | 'shop_box_wonder' | 'shop_box_crew' | 'shop_box_locked' | 'shop_box_promoted';

export interface ShopItem {
  sku: string;
  type: number;
  /** TID of the item name. */
  tid: string;
  level: number;
  coins: number;
  cash: number;
  fbc: number;
  exp: number;
  constructionTimeMs: number;
  cols: number;
  rows: number;
  incomeValue: number;
  unlockCondition: 'level' | 'fan' | 'cross';
  unlockCrossApp: number;
  freeGift: boolean;
  featured: boolean;
  shopTabs: string[];
  where: string[] | null;
  releaseTime: number;
  expireTime: number;
  limEd: boolean;
  /** XML unitsAmount (used offline when the server has no entry). */
  unitsAmount: number;
  abTest: string | null;
  isHQ: boolean;
}

export interface ShopCard {
  item: ShopItem;
  kind: CardKind;
  box: BoxClass;
  /** Position within the tab (BuyBox mId). */
  index: number;
  price: { currency: 'coins' | 'cash' | 'free'; amount: number; oldAmount?: number };
  /** XP reward (hidden when 0). */
  exp: number;
  /** "items left" counter of limited editions; undefined for normal items. */
  unitsLeft?: number;
  /** Remaining ms of an expiring item (needsToShowExpireTime). */
  timeLeftMs?: number;
  /** Early-unlock price in gold (0 = not unlockable with gold). */
  unlockGold: number;
  /** Buy button disabled (wonder/club already built). */
  buyDisabled: boolean;
  offer?: OfferInfo;
  /** Bundle (2per1): extra items granted. */
  bundleAmount?: number;
}

const num = (a: Record<string, string>, k: string, d = 0): number => {
  const v = Number(a[k]);
  return a[k] !== undefined && a[k] !== '' && Number.isFinite(v) ? v : d;
};

/** TimerUtil.getDateInMs: "dd:mm:yyyy[:hh:mm]" local time. */
export function parseDateMs(s: string | undefined): number {
  if (!s) return 0;
  const p = s.split(':').map((x) => Number(x));
  if (p.length < 3 || p.some((x) => !Number.isFinite(x))) return 0;
  return new Date(p[2], p[1] - 1, p[0], p[3] ?? 0, p[4] ?? 0).getTime();
}

/** ItemDefinition type id from the sku family (file of origin is not kept in the definition table). */
export function typeOfSku(sku: string): number {
  if (sku.startsWith('wonder_')) return TYPE_WONDERS;
  if (sku.startsWith('club_')) return TYPE_CLUBS;
  if (sku.startsWith('decorations_')) return TYPE_DECORATIONS;
  if (sku.startsWith('commerce_')) return TYPE_COMMERCES;
  return TYPE_HOUSES;
}

/** ActionGetItemDefinitions: attribute parsing for the shop-relevant fields. */
export function parseShopItem(def: CatalogDef): ShopItem {
  const a = def.attrs;
  const cond = (a.unlockCondition ?? '').trim().split('_');
  const unlockCondition = cond[0] === 'fan' ? 'fan' : cond[0] === 'cross' ? 'cross' : 'level';
  const tabs = (a.shopTab ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const type = typeOfSku(def.sku);
  return {
    sku: def.sku,
    type,
    tid: a.tid ?? '',
    level: num(a, 'level', 1),
    coins: num(a, 'constructionCoins'),
    cash: num(a, 'constructionCash'),
    fbc: num(a, 'constructionFBC'),
    exp: num(a, 'exp'),
    // constructionTime: minutes (ItemDefinition.as:575)
    constructionTimeMs: Math.round(num(a, 'constructionTime') * 60_000),
    cols: num(a, 'baseCols', 1),
    rows: num(a, 'baseRows', 1),
    incomeValue: num(a, 'incomeValue'),
    unlockCondition,
    unlockCrossApp: unlockCondition === 'cross' ? num({ v: cond[1] ?? '' }, 'v') : 0,
    freeGift: a.freeGift === '1',
    featured: 'featured' in a,
    shopTabs: tabs,
    where: a.where !== undefined ? a.where.split(',').map((s) => s.trim()) : null,
    releaseTime: parseDateMs(a.releaseTime),
    expireTime: parseDateMs(a.expireTime),
    limEd: tabs.includes('limEd'),
    unitsAmount: num(a, 'unitsAmount'),
    abTest: a.showInABTest ? a.showInABTest : null,
    isHQ: def.sku === 'HeadQuarter' || a.sku === 'HeadQuarter',
  };
}

/** Effective units of a limited edition (LimEdManager.build): server entry wins; a sold-out entry (lastLegalBuyTime) is 0. */
export function limEdUnits(item: ShopItem, st: CatalogState): number {
  const e = st.limEd.get(item.sku);
  if (!e) return item.unitsAmount;
  return e.lastLegalBuyTime > 0 ? 0 : e.units;
}

/** Effective expire time: XML expireTime, or lastLegalBuyTime + limEdSoldOutShowTime for sold-out limited editions. */
export function expireTimeOf(item: ShopItem, st: CatalogState, s: CatalogSettings): number {
  const e = st.limEd.get(item.sku);
  if (e && e.lastLegalBuyTime > 0) return e.lastLegalBuyTime + s.limEdSoldOutShowTimeHours * 3_600_000;
  return item.expireTime;
}

/** 16:01:2012 00:00 local: oracle-observed boundary between hidden and listed expiring items. */
const ORIGINAL_SHOP_EXPIRY_CUTOFF = new Date(2012, 0, 16).getTime();

/** ItemDefinition.isAllowedToBeInShop. */
export function isAllowedInShop(item: ShopItem, st: CatalogState, s: CatalogSettings): boolean {
  let ok = true;
  if (item.abTest !== null) return false; // no A/B test infrastructure: those variants are off
  if (item.isHQ || !(item.where === null || item.where.includes('shop'))) ok = false;
  if (ok && item.freeGift) ok = false;
  if (ok && item.type === TYPE_WONDERS && item.sku.includes('wonder_npc_') && item.sku !== st.npcWonderSku) ok = false;
  if (item.releaseTime > 0) ok = st.now >= item.releaseTime;
  const expire = expireTimeOf(item, st, s);
  if (ok && item.limEd) ok = limEdUnits(item, st) > 0 || expire > 0;
  // Oracle (original client against a 2026 server clock): items expiring 16:01:2012 (Titanium Sculpture, Canton Tower, Burj Khalifa, ...)
  // are still listed in the shop (New Items tab, no countdown) while every earlier-expiring seasonal item is hidden, i.e. the
  // original behaves as if "now" were just before 16:01:2012. The sold-out limEd window still uses the real clock.
  const soldOutWindow = st.limEd.get(item.sku)?.lastLegalBuyTime;
  if (ok && expire > 0) ok = soldOutWindow ? st.now < expire : expire >= ORIGINAL_SHOP_EXPIRY_CUTOFF;
  if (ok && item.type === TYPE_CLUBS) ok = st.built(item.sku) === 0;
  return ok;
}

/** ItemDefinition.isLocked. */
export function isLocked(item: ShopItem, st: CatalogState): boolean {
  let locked = false;
  if (!st.unlocked.has(item.sku)) {
    if (item.unlockCondition === 'level') locked = st.level < item.level;
    else if (item.unlockCondition === 'fan') locked = !st.isFan;
    else locked = true; // cross promotion: never unlocked offline
  }
  if (!locked && item.limEd) locked = limEdUnits(item, st) === 0;
  return locked;
}

/** RulesFacade.unlockSegmentsGetSegmentId. */
function segmentOf(level: number, segs: readonly UnlockSegment[]): number {
  let i = 0;
  while (i < segs.length && segs[i].levelStart <= level) i += 1;
  return i - 1;
}

/**
 * RulesFacade.unlockSegmentsGetPrice(cur, target, fbc=false): sum of the base gold price of every level from the current
 * level up to the item's level (unlockSegmentsCash.xml). The visibility limit applies (see below).
 */
export function unlockSegmentsPrice(
  cur: number,
  target: number,
  segs: readonly UnlockSegment[],
  vis?: readonly { levelStart: number; levelsVisible: number }[]
): number {
  if (target <= cur || segs.length === 0) return 0;
  // RulesFacade.unlockSegmentsGetPrice (:892): UNLOCK_SEGMENTS_MODE_DEFAULT = LIMITED sets mUnlockSegmentsCheckVisibility
  // (unlockSegmentsSetMode, :1260/:1703), so only items within levelsVisible of the current level have a gold price.
  if (vis && vis.length > 0) {
    let i = 0;
    while (i < vis.length && vis[i].levelStart <= cur) i += 1;
    if (target - cur > (vis[i - 1]?.levelsVisible ?? 0)) return 0;
  }
  let sum = 0;
  for (let l = cur; l <= target; l += 1) sum += segs[Math.max(0, segmentOf(l, segs))]?.baseCash ?? 0;
  return sum;
}

/** ItemDefinition.getUnlockPrice(false): gold to unlock a level-locked item early (capped at settings @unlockMaxPrice). */
export function unlockPrice(item: ShopItem, st: CatalogState, s: CatalogSettings): number {
  let p = 0;
  if (item.unlockCondition === 'level' && item.level > st.level) p = unlockSegmentsPrice(st.level, item.level, s.segments, s.visibility);
  return Math.min(p, s.unlockMaxPrice);
}

/** DefinitionManager.sortCompareFunction + ItemDefinitionManager.sortCompareSameLevelFunction/CostFunction. */
export function compareItems(a: ShopItem, b: ShopItem): number {
  if (a.level !== b.level) return a.level > b.level ? 1 : -1;
  // ItemDefinitionManager.as:119-146 (sortCompareSameLevelFunction): the gold price (constructionFBC) is compared first
  if (a.fbc > b.fbc && b.fbc > 0) return 1;
  if (a.fbc < b.fbc && a.fbc > 0) return -1;
  if (a.coins > b.coins && b.coins > 0) return 1;
  if (a.coins < b.coins && a.coins > 0) return -1;
  // sortCompareSameCostFunction returns -1 for equal XP; Flash's Array.sort then keeps the definition order (oracle shop-houses: Bungalow
  // Luxury before Kioko House, both 60,000 / 200 XP), so ties compare equal (stable sort) here.
  return a.exp > b.exp ? 1 : a.exp < b.exp ? -1 : 0;
}

/** Items of one shop tab, shop-allowed, in the original order (before card-state decisions). */
export function itemsForTab(defs: Iterable<CatalogDef>, tab: number, st: CatalogState, s: CatalogSettings): ShopItem[] {
  const out: ShopItem[] = [];
  for (const d of defs) {
    const it = parseShopItem(d);
    let inTab: boolean;
    if (tab === TAB_NEW_ITEMS) inTab = it.shopTabs.includes('new_items');
    // ItemDefinition.as:302-314 offerDef setter, OfferManager.addFreeItem (:45-54): items with an offer or free items are featured too
    else if (tab === TAB_FEATURED) inTab = it.featured || (st.offers?.has(it.sku) ?? false) || (st.freeItems?.has(it.sku) ?? false);
    else if (tab === TYPE_BUNDLE) inTab = false; // BundleDefinition: no bundle rules ship with 0.501
    else inTab = it.type === tab || (it.shopTabs.includes(SHOP_TABS[tab] as string) && tab < TYPE_BUNDLE);
    if (!inTab) continue;
    if (!isAllowedInShop(it, st, s)) continue;
    out.push(it);
  }
  if (tab === TAB_FEATURED) {
    // sortCompareFeaturedFunction: offers first, then bundles, then the level order
    const has = (i: ShopItem): number => (st.offers?.has(i.sku) ? 0 : 1);
    return out.sort((a, b) => has(a) - has(b) || compareItems(a, b));
  }
  return out.sort(compareItems);
}

/**
 * PopupLevel.as:229 getItemsByLevel(level, -1, isAllowedToBeInLevelUp) (ItemDefinition.as:1280-1325, ItemDefinitionManager.checkLevel :204):
 * unlockCondition == level, level == n, shop-allowed (where/freeGift/other boss's wonder_npc/release/expire/limEd/A-B) minus bundles and clubs.
 * Order: type 0..4 (DefinitionManager.getDefinitionsWithCondition :162-190), each type in shop order (compareItems).
 */
export function levelUpItems(defs: Iterable<CatalogDef>, level: number, st: CatalogState, s: CatalogSettings): ShopItem[] {
  const out: ShopItem[] = [];
  for (const d of defs) {
    const it = parseShopItem(d);
    if (it.unlockCondition !== 'level' || it.level !== level) continue;
    if (it.type === TYPE_BUNDLE || it.type === TYPE_CLUBS) continue;
    // the club "already built" test of isAllowedToBeInShop does not exist here, and clubs are excluded anyway
    if (!isAllowedInShop(it, st, s)) continue;
    out.push(it);
  }
  return out.sort((a, b) => a.type - b.type || compareItems(a, b));
}

function boxFor(item: ShopItem, kind: CardKind): BoxClass {
  if (kind === 'offer' || kind === 'bundle') return 'shop_box_promoted';
  if (kind !== 'unlocked') return 'shop_box_locked';
  if (item.type === TYPE_CLUBS) return 'shop_box_crew';
  if (item.type === TYPE_WONDERS) return 'shop_box_wonder';
  return 'shop_box';
}

/** BuyBox.checkContentState. */
export function cardKind(item: ShopItem, st: CatalogState, s: CatalogSettings): CardKind {
  if (isLocked(item, st)) {
    const gold = unlockPrice(item, st, s);
    if (item.limEd) {
      if (limEdUnits(item, st) === 0) return 'limEdSoldOut';
      return gold > 0 ? 'lockedByCash' : 'locked';
    }
    if (gold > 0) return 'lockedByCash';
    if (item.unlockCondition === 'fan' && !st.isFan) return 'lockedFan';
    if (item.unlockCondition === 'cross') return 'lockedCross';
    return 'locked';
  }
  const offer = st.offers?.get(item.sku);
  if (offer?.offerType === 'bundle') return 'bundle';
  if (offer) return 'offer';
  return 'unlocked';
}

/** ItemDefinition.getConstructionCoins/Cash: discount offers and free items. */
export function priceOf(item: ShopItem, st: CatalogState): ShopCard['price'] {
  const offer = st.offers?.get(item.sku);
  const free = st.freeItems?.has(item.sku) ?? false;
  const disc = (v: number): number => (offer?.offerType === 'discount' ? Math.trunc(v - v * offer.amount) : v);
  if (item.cash === 0) {
    const amount = free ? 0 : disc(item.coins);
    return amount === 0 ? { currency: 'free', amount: 0 } : { currency: 'coins', amount, oldAmount: amount !== item.coins ? item.coins : undefined };
  }
  const amount = free ? 0 : disc(item.cash);
  return { currency: 'cash', amount, oldAmount: amount !== item.cash ? item.cash : undefined };
}

export function buildCard(item: ShopItem, index: number, st: CatalogState, s: CatalogSettings): ShopCard {
  const kind = cardKind(item, st, s);
  const offer = st.offers?.get(item.sku);
  const expire = expireTimeOf(item, st, s);
  const card: ShopCard = {
    item,
    kind,
    box: boxFor(item, kind),
    index,
    price: priceOf(item, st),
    exp: item.exp,
    unlockGold: kind === 'lockedByCash' ? unlockPrice(item, st, s) : 0,
    buyDisabled: (item.type === TYPE_WONDERS || item.type === TYPE_CLUBS) && st.built(item.sku) > 0,
  };
  if (item.limEd) card.unitsLeft = limEdUnits(item, st);
  if (expire > 0 && expire - st.now > 0 && !item.limEd) card.timeLeftMs = expire - st.now;
  if (offer) {
    card.offer = offer;
    if (offer.offerType === 'bundle') card.bundleAmount = offer.amount;
  }
  return card;
}

/** All cards of a tab (BuyBox.getItems). */
export function cardsForTab(defs: Iterable<CatalogDef>, tab: number, st: CatalogState, s: CatalogSettings): ShopCard[] {
  return itemsForTab(defs, tab, st, s).map((it, i) => buildCard(it, i, st, s));
}

/** Number of shop pages of a card list (BuyBox.mMaxScrolls). */
export function pageCount(n: number): number {
  return Math.max(1, Math.ceil(n / ITEMS_PER_PAGE));
}

/** Grid slot of the i-th card (BuyBox.getItems: XINIT/YINIT/XOFFSET/YOFFSET). */
export const GRID = { xInit: -190.3, yInit: -105, xOffset: 135, yOffset: 190.1 } as const;
export function slotOf(i: number): { x: number; y: number; page: number } {
  return {
    x: GRID.xInit + GRID.xOffset * (i % 4) + GRID.xOffset * 4 * Math.floor(i / 8),
    y: GRID.yInit + GRID.yOffset * (Math.floor(i / 4) % 2),
    page: Math.floor(i / ITEMS_PER_PAGE),
  };
}

/** Tab availability (BuyBox.start: a tab with no shop items is disabled). */
export function tabCounts(defs: Iterable<CatalogDef>, st: CatalogState, s: CatalogSettings): number[] {
  const arr = [...defs];
  return [TYPE_HOUSES, TYPE_COMMERCES, TYPE_DECORATIONS, TYPE_WONDERS, TYPE_CLUBS, TYPE_BUNDLE, TAB_NEW_ITEMS, TAB_FEATURED].map(
    (t) => itemsForTab(arr, t, st, s).length,
  );
}

/** Position of an item in the shop: tab + page (BuyBox.searchItem). */
export function locateItem(defs: Iterable<CatalogDef>, sku: string, st: CatalogState, s: CatalogSettings): { tab: number; page: number } | undefined {
  const arr = [...defs];
  const it = arr.find((d) => d.sku === sku);
  if (!it) return undefined;
  const tab = typeOfSku(sku);
  const i = itemsForTab(arr, tab, st, s).findIndex((x) => x.sku === sku);
  return i < 0 ? undefined : { tab, page: Math.floor(i / ITEMS_PER_PAGE) };
}

// ---- server lists (get_unlocked_items_list, get_limited_edition_items_list, get_storage_list) --------------------------

type Json = Record<string, unknown>;

/** {listName:[{sku:"..",...}, ...]} -> children attribute maps (the legacy XML-as-JSON shape). */
export function listChildren(doc: unknown, listName: string): Array<Record<string, string>> {
  const d = (doc ?? {}) as Json;
  const arr = d[listName];
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Json => typeof e === 'object' && e !== null)
    .map((e) => {
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(e)) if (typeof v === 'string' || typeof v === 'number') o[k] = String(v);
      return o;
    });
}

export function parseUnlockedList(doc: unknown): Set<string> {
  return new Set(listChildren(doc, 'unlockedList').map((e) => e.sku).filter(Boolean));
}

/** LimEdManager.build: <limEd sku unitsAmount lastLegalBuyTime/>. */
export function parseLimEdList(doc: unknown): Map<string, LimEdEntry> {
  const m = new Map<string, LimEdEntry>();
  for (const e of listChildren(doc, 'limEdList')) {
    if (!e.sku) continue;
    m.set(e.sku, { units: Number(e.unitsAmount) || 0, lastLegalBuyTime: Number(e.lastLegalBuyTime) || 0 });
  }
  return m;
}

export interface StoredEntry {
  sku: string;
  amount: number;
}
/** StorageManager.build: <item sku amount/>. */
export function parseStorageList(doc: unknown): StoredEntry[] {
  return listChildren(doc, 'storageList')
    .filter((e) => e.sku)
    .map((e) => ({ sku: e.sku, amount: Number(e.amount) || 0 }))
    .filter((e) => e.amount > 0);
}

/** StorageManager.sortStorage: items (order 100001+type) before other gifts, then by sku (case-insensitive). */
export function sortStorage<T extends { sku: string; order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || a.sku.toLowerCase().localeCompare(b.sku.toLowerCase()));
}

/** settings.xml + unlockSegmentsCash.xml -> CatalogSettings (RulesFacade settingsLoadOnComplete / unlockSegmentsCashLoadOnComplete). */
export function parseCatalogSettings(settingsXml: string, segmentsXml: string, visibilityXml = ''): CatalogSettings {
  const st = parseElements(settingsXml, 'Definition')[0] ?? {};
  return {
    unlockMaxPrice: Number(st.unlockMaxPrice) || 65,
    limEdSoldOutShowTimeHours: Number(st.limEdSoldOutShowTime) || 48,
    cashToCoins: Number(st.cashToCoins) || 60000,
    visibility: parseElements(visibilityXml, 'Definition').map((a) => ({ levelStart: Number(a.levelStart) || 0, levelsVisible: Number(a.levelsVisible) || 0 })),
    segments: parseElements(segmentsXml, 'Definition').map((a) => ({
      levelStart: Number(a.levelStart) || 0,
      levelEnd: Number(a.levelEnd) || 0,
      baseCash: Number(a.baseCash) || 0,
    })),
  };
}
