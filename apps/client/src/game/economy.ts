// Economy layer of the original that the core loop left out: commerce/club income from the surrounding population, house
// influence, wonder attributes, HQ road connectivity (suspension), double rent, rent accelerators and the company value.
//
// Pure helpers first (unit tested), then `Economy`, the live model the Game owns. Sources (decompiled/scripts/com/dchoc/dollars):
//   ItemObject.as getIncomeValue :329-374, influenceValue :2539, getPopulation :2011, isHQConnected :962, applyHQConnection :1915
//   StateOnRent.as onIncome/giveIncome/giveDCCoins :877-897,1592, doLogicUpdate :1180-1346, canBeAccelerated :237, accelerateIncomeTime :1817
//   Company.as attributesGetValue :537, getCompanyValuePerBuildings :304, getCompanyValuePerTerrain :565
//   world/items/wonders/WonderTypeDefinition.as (doEffect/undoEffect), states/StateOnBuilt.as
import type { ContractDefinition, ItemDefinition } from "@mcity/rules";
import type { DefinitionTable, ItemDef } from "../model/definitions";
import { RENT_MODE, STATE_ID } from "../net/commands";
import type { PlacedItem } from "../model/save";
import {
  TYPE_CLUBS,
  TYPE_COMMERCES,
  TYPE_DECORATIONS,
  TYPE_HOUSES,
  TYPE_WONDERS,
  affectedHouses,
  buildInfluenceIndex,
  commercePopulation,
  disconnectedItems,
  footprint,
  hasCommerceBehaviour,
  houseInfluencePercent,
  influenceRect,
  isHouseLike,
  needsHQConnection,
  rectsOverlap,
  type InfluenceIndex,
  type InfluenceNode,
  type ItemType,
  type Rect
} from "./influence";
import { MAP_COLS, MAP_ROWS } from "./geometry";
import type { GameRules } from "./rules";

export const HQ_SKU = "HeadQuarter";
/** ItemDefinition.NAME_TYPES */
export const NAME_TYPES = ["Houses", "Commerces", "Decorations", "Wonders", "Clubs"] as const;

/** ItemDefinition.type of a definition (houses/commerce/decoration files; wonders and clubs share the "other" kind). */
export function itemTypeOf(def: Pick<ItemDefinition, "kind" | "sku">): ItemType {
  if (def.kind === "commerce") return TYPE_COMMERCES;
  if (def.kind === "decoration") return TYPE_DECORATIONS;
  if (def.kind === "other") return def.sku.startsWith("club") ? TYPE_CLUBS : TYPE_WONDERS;
  return TYPE_HOUSES;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pure income formulas
// ---------------------------------------------------------------------------------------------------------------------

const u = (n: number): number => (n > 0 ? Math.trunc(n) : 0); // AS3 `uint` store of a Number

/**
 * ItemObject.getIncomeValue for a commerce or club (:329-374), one affected population `pop`:
 * uint v = incomeCoins * pop; v += v * influence / 100; if (levelFactor > 0 && v > 0) v += levelFactor * pop.
 * (`incomeCoins` = ItemObject.getIncomeCoins = def income + contract coins.)
 */
export function commerceRent(incomeCoins: number, pop: number, influencePct: number, levelFactor: number): number {
  let v = u(u(incomeCoins) * u(pop));
  v = u(v + (v * influencePct) / 100);
  if (levelFactor > 0 && v > 0) v = u(v + levelFactor * u(pop));
  return v;
}

/** StateOnRent.giveDCCoins: the doubled rent (RulesFacade.settingsGetIncomeMultiplier) when the double-rent prize is active. */
export const withDoubleRent = (coins: number, multiplier: number, doubled: boolean): number => (doubled ? coins * multiplier : coins);

/** StateOnRent.accelerateIncomeTime (:1817-1831): the remaining income time drops by `percent`% of the full income time. */
export function acceleratedTime(remainingMs: number, maxIncomeMs: number, percent: number): number {
  return Math.max(0, remainingMs - Math.trunc((maxIncomeMs * percent) / 100));
}

/** StateOnRent.canBeAccelerated (:237) && ItemObject.canBeAccelerated (:1424): a house (not HQ) that is renting. */
export function canBeAccelerated(item: { stateId: number; mode: number; isCommerce: boolean; isClub?: boolean; isWonder?: boolean; sku: string; accelerated?: boolean }): boolean {
  return item.stateId === STATE_ID.RENT && item.mode === RENT_MODE.RENTING && !item.isCommerce && !item.isClub && !item.accelerated && item.sku.startsWith("houses_");
}

export interface CompanyValueInput {
  coins: number;
  cash: number;
  cashToCoins: number;
  /** Sellable items (StateItemObject.canBeSold: everything but construction/crew hiring/...): definition value + contract cost. */
  items: Array<{ companyValue: number; contractCost: number }>;
  terrainTiles: number;
  terrainPrice: number;
  /** Profile.getCompanyValuePerExpansions: sum over owned expansions of min(coins, gold * cashToCoins). */
  expansions: number;
}

/** Company.getCompanyValue (:636) = coins + gold*cashToCoins + buildings + terrain + expansions. */
export function computeCompanyValue(i: CompanyValueInput): { coins: number; gold: number; buildings: number; terrain: number; total: number } {
  const gold = i.cash * i.cashToCoins;
  const buildings = i.items.reduce((s, it) => s + it.companyValue + it.contractCost, 0);
  const terrain = i.terrainTiles * i.terrainPrice + i.expansions;
  return { coins: i.coins, gold, buildings, terrain, total: i.coins + gold + buildings + terrain };
}

/** Profile.getCompanyValuePerExpansions with expansionsPrices.xml (DCCash per owned expansion, in unlock order). */
export function expansionsValue(prices: readonly number[], owned: number, cashToCoins: number): number {
  let v = 0;
  for (let i = 0; i < owned; i += 1) v += (prices[i] ?? 0) * cashToCoins; // min(WithFriends(i), DCCash(i)*k): both are DCCash*k
  return v;
}

export function parseExpansionPrices(xml: string): number[] {
  return [...xml.matchAll(/<Definition\s+([^>]*?)\/?>/g)].map((m) => Number(/\bDCCash="(\d+)"/.exec(m[1])?.[1] ?? 0));
}

// ---------------------------------------------------------------------------------------------------------------------
// Wonders
// ---------------------------------------------------------------------------------------------------------------------

export type WonderSubtype = "influence" | "incomeMultiplier" | "npcIncome";

export interface WonderAttributes {
  /** subtype -> target ("Houses", "Commerces", NPC names...) -> summed incomeValue. */
  values: Map<string, Map<string, number>>;
}

/**
 * Company.attributesAddValue / WonderTypeDefinition.doEffect (:26-39): every built, connected wonder adds its incomeValue
 * (getIncomeCoins) to attributes[subtype][target].
 */
export function wonderAttributes(wonders: Array<{ subtype: string; target: string; incomeValue: number }>): WonderAttributes {
  const values = new Map<string, Map<string, number>>();
  for (const w of wonders) {
    if (!w.subtype || !w.target) continue;
    const m = values.get(w.subtype) ?? new Map<string, number>();
    m.set(w.target, (m.get(w.target) ?? 0) + w.incomeValue);
    values.set(w.subtype, m);
  }
  return { values };
}

/** Company.attributesGetValue(key, def): "all" + sku + NAME_TYPES[type] targets. */
export function attributeValue(a: WonderAttributes, key: string, def: { sku: string; type: ItemType }): number {
  const m = a.values.get(key);
  if (!m) return 0;
  return (m.get("all") ?? 0) + (m.get(def.sku) ?? 0) + (m.get(NAME_TYPES[def.type]) ?? 0);
}

/** ItemDefinition.isAffectedByWonderInfluence (:363): commerces and the houses affected by influence. */
export const isAffectedByWonderInfluence = (n: Pick<InfluenceNode, "type" | "isHQ">): boolean => n.type === TYPE_COMMERCES || isHouseLike(n);

// ---------------------------------------------------------------------------------------------------------------------
// Live model
// ---------------------------------------------------------------------------------------------------------------------

/** What the Economy reads from a game item (GameItem satisfies it). */
export interface EconomyItem {
  sid: string;
  sku: string;
  stateId: number;
  mode: number;
  time: number;
  incomeMs: number;
  contractSku?: number;
  tileX: number;
  tileY: number;
  cols: number;
  rows: number;
  def: ItemDef;
}

export interface EconomyHost {
  rules: GameRules;
  defs: DefinitionTable;
  items(): EconomyItem[];
  /** Road tiles (absolute tile index = y * MAP_COLS + x). */
  roads(): ReadonlySet<number>;
}

export interface PlacementPreview {
  area: Rect;
  /** Items (houses) inside the area. */
  houses: string[];
  /** Houses that currently count for a commerce/club (renting, connected). */
  affecting: string[];
  /** Commerce/club: summed tenants of `affecting`. */
  population: number;
  /** Commerce/club: income of one collection (summed per house). */
  income: number;
  /** Decoration: percent added to every covered house. */
  housePercent: number;
}

export interface CommercePayout {
  coins: number;
  xp: number;
  /** Per house: coins paid for it (giveIncome(house)). */
  perHouse: Array<{ sid: string; coins: number; xp: number }>;
}

export class Economy {
  private nodes: InfluenceNode[] = [];
  private bySid = new Map<string, InfluenceNode>();
  private index: InfluenceIndex = { covers: new Map(), coveredBy: new Map() };
  private disconnected = new Set<string>();
  private wonders: WonderAttributes = { values: new Map() };
  private layoutDirty = true;
  private wondersDirty = true;
  /** Server-pushed double rent prizes (UserDataFacade.mDoubleRent). */
  readonly doubleRent: Record<"Houses" | "Commerces", boolean> = { Houses: false, Commerces: false };
  private itemBySid = new Map<string, EconomyItem>();

  constructor(private host: EconomyHost) {}

  /** Roads, item positions or the item set changed. */
  invalidate(): void {
    this.layoutDirty = true;
    this.wondersDirty = true;
  }

  /** An item changed (Game "item-changed"): a new position changes the influence areas; a state change may start/stop a wonder. */
  noteItem(i: { sid: string; tileX: number; tileY: number }): void {
    const n = this.bySid.get(i.sid);
    if (!n || n.x !== i.tileX || n.y !== i.tileY) this.layoutDirty = true;
    this.wondersDirty = true;
  }

  /** A wonder changed state/suspension. */
  invalidateWonders(): void {
    this.wondersDirty = true;
  }

  private refresh(): void {
    if (this.layoutDirty) {
      const items = this.host.items();
      this.itemBySid = new Map(items.map((i) => [i.sid, i]));
      this.nodes = items.map((i) => this.nodeOf(i));
      this.bySid = new Map(this.nodes.map((n) => [n.sid, n]));
      this.index = buildInfluenceIndex(this.nodes);
      this.disconnected = disconnectedItems(this.nodes, this.host.roads(), MAP_COLS, MAP_ROWS);
      this.layoutDirty = false;
    }
    if (this.wondersDirty) {
      const list: Array<{ subtype: string; target: string; incomeValue: number }> = [];
      for (const i of this.itemBySid.values()) {
        if (i.stateId !== STATE_ID.BUILT || itemTypeOf(i.def.rules) !== TYPE_WONDERS || this.disconnected.has(i.sid)) continue;
        list.push({ subtype: i.def.attrs.subtype ?? "", target: i.def.attrs.target ?? "", incomeValue: i.def.rules.incomeValue });
      }
      this.wonders = wonderAttributes(list);
      this.wondersDirty = false;
    }
  }

  private nodeOf(i: EconomyItem): InfluenceNode {
    const r = i.def.rules;
    return {
      sid: i.sid,
      type: itemTypeOf(r),
      isHQ: i.sku === HQ_SKU,
      x: i.tileX,
      y: i.tileY,
      cols: i.cols,
      rows: i.rows,
      ratio: r.influenceRatio,
      value: r.influenceValue
    };
  }

  // ---- connectivity ------------------------------------------------------------------------------------------------

  /** ItemObject.isHQConnected (false only for items that need the HQ and have no road path to it). */
  isConnected(sid: string): boolean {
    this.refresh();
    return !this.disconnected.has(sid);
  }

  /** Sids not connected to the HQ (they show the no-road icon and are suspended). */
  disconnectedSids(): ReadonlySet<string> {
    this.refresh();
    return this.disconnected;
  }

  // ---- population / influence --------------------------------------------------------------------------------------

  private isAffecting = (sid: string): boolean => {
    const it = this.itemBySid.get(sid);
    return !!it && !this.disconnected.has(sid) && it.stateId === STATE_ID.RENT && (it.mode === RENT_MODE.RENTING || it.mode === RENT_MODE.GET_RENT);
  };

  /** ItemObject.getPopulation of a house: the definition's tenants once a contract is signed. */
  housePopulation = (sid: string): number => {
    const it = this.itemBySid.get(sid);
    return it && it.contractSku !== undefined ? it.def.rules.tenants : 0;
  };

  private src = { isAffecting: this.isAffecting, housePopulation: this.housePopulation };

  /** Houses a commerce/club is paid for (ItemObject.influenceGetItemsAffectedByCommerce). */
  affected(sid: string): string[] {
    this.refresh();
    return affectedHouses(sid, this.index, this.src);
  }

  /** ItemObject.getPopulation of a commerce/club. */
  population(sid: string): number {
    this.refresh();
    return commercePopulation(sid, this.index, this.src);
  }

  /** ItemObject.influenceValue (percent): decorations around a house + the wonder bonus; commerces get the wonder bonus only. */
  influencePercent(sid: string): number {
    this.refresh();
    const n = this.bySid.get(sid);
    if (!n) return 0;
    const wonder = isAffectedByWonderInfluence(n) ? attributeValue(this.wonders, "influence", { sku: this.itemBySid.get(sid)?.sku ?? "", type: n.type }) : 0;
    return isHouseLike(n) ? houseInfluencePercent(sid, this.index, this.bySid, wonder) : wonder;
  }

  /** The decorations/commerces whose area covers this house (hover/info). */
  influencers(sid: string): string[] {
    this.refresh();
    return this.index.coveredBy.get(sid) ?? [];
  }

  /** Houses inside the area of an item with an influence area (the area-visibility highlight). */
  covered(sid: string): string[] {
    this.refresh();
    return this.index.covers.get(sid) ?? [];
  }

  /** Company wonder attribute (influence / incomeMultiplier / npcIncome) for a definition. */
  wonderValue(key: WonderSubtype, def: { sku: string; type: ItemType }): number {
    this.refresh();
    return attributeValue(this.wonders, key, def);
  }

  // ---- income ------------------------------------------------------------------------------------------------------

  private incomeBase(item: EconomyItem, contract?: ContractDefinition): { coins: number; xp: number } {
    const d = item.def.rules;
    return { coins: d.incomeValue + (contract?.incomeCoins ?? 0), xp: d.incomeXP + (contract?.incomeXP ?? 0) };
  }

  /**
   * StateOnRent.onIncome for commerces/clubs (:1455-1470 / giveIncome :877): one payment per affected house computed with
   * the house population (`getIncomeValue(false, house)`); clubs pay once with the total population (`getIncomeValue(true)`).
   */
  commercePayout(item: EconomyItem, contract?: ContractDefinition): CommercePayout {
    const d = item.def.rules;
    const base = this.incomeBase(item, contract);
    const infl = this.influencePercent(item.sid);
    const houses = this.affected(item.sid);
    if (itemTypeOf(d) === TYPE_CLUBS) {
      const pop = this.population(item.sid);
      const coins = commerceRent(base.coins, pop, infl, d.incomeLevelFactor);
      return { coins, xp: base.xp, perHouse: [{ sid: item.sid, coins, xp: base.xp }] };
    }
    const perHouse = houses.map((sid) => ({ sid, coins: commerceRent(base.coins, this.housePopulation(sid), infl, d.incomeLevelFactor), xp: base.xp }));
    return { coins: perHouse.reduce((s, h) => s + h.coins, 0), xp: perHouse.reduce((s, h) => s + h.xp, 0), perHouse };
  }

  /** ItemObject.getIncomeValue(true): the single-computation total shown by the commerce info box (StateOnRent.as:1337). */
  commerceInfoIncome(item: EconomyItem, contract?: ContractDefinition): number {
    const d = item.def.rules;
    return commerceRent(this.incomeBase(item, contract).coins, this.population(item.sid), this.influencePercent(item.sid), d.incomeLevelFactor);
  }

  // ---- double rent -------------------------------------------------------------------------------------------------

  /** UserDataFacadeOnline "doubleRent" command: the next collection of that type pays incomeMultiplier times. */
  setDoubleRent(kind: string): void {
    if (kind === "Houses" || kind === "Commerces") this.doubleRent[kind] = true;
  }

  isDoubleRent(nameType: string): boolean {
    return nameType === "Houses" || nameType === "Commerces" ? this.doubleRent[nameType] : false;
  }

  /** UserDataFacade.updateItem with a `doubleRent` param resets both flags (UserDataFacadeOnline.as:143-147). */
  clearDoubleRent(): void {
    this.doubleRent.Houses = false;
    this.doubleRent.Commerces = false;
  }

  // ---- placement preview (ToolBuild: checkInfluence_* / Item influence area) ---------------------------------------

  previewPlacement(def: ItemDef, tx: number, ty: number): PlacementPreview {
    this.refresh();
    const r = def.rules;
    const node: InfluenceNode = { sid: "__preview__", type: itemTypeOf(r), isHQ: false, x: tx, y: ty, cols: def.cols, rows: def.rows, ratio: r.influenceRatio, value: r.influenceValue };
    const area = influenceRect(node);
    const houses = this.nodes.filter((n) => isHouseLike(n) && n.ratio >= 0 && rectsOverlap(area, footprint(n))).map((n) => n.sid);
    const affecting = houses.filter(this.isAffecting);
    const type = node.type;
    let population = 0;
    let income = 0;
    if (hasCommerceBehaviour(type)) {
      population = affecting.reduce((s, sid) => s + this.housePopulation(sid), 0);
      const infl = type === TYPE_COMMERCES ? this.wonderValue("influence", { sku: r.sku, type }) : 0;
      income = commerceRent(r.incomeValue, population, infl, r.incomeLevelFactor);
    }
    return { area, houses, affecting, population, income, housePercent: type === TYPE_DECORATIONS ? r.influenceValue : 0 };
  }

  /** needsHQConnection for an item (for the placement hint). */
  needsConnection(item: EconomyItem): boolean {
    return needsHQConnection(this.nodeOf(item));
  }

  /** Items a wonder/club/commerce of this def would need nothing of: exposed for tests. */
  nodesForTest(): InfluenceNode[] {
    this.refresh();
    return this.nodes;
  }
}

/** Initial state of a freshly placed item (Role.doGetInitialItemState :50-66): decorations are built at once, clubs hire crew. */
export function initialStateKind(def: ItemDefinition, crewCount = 0): "construction" | "built" | "crew" | "headquarter" {
  if (crewCount > 0) return "crew";
  if (def.kind === "decoration") return "built";
  if (def.sku === HQ_SKU) return "headquarter";
  return "construction";
}

export type { PlacedItem };
