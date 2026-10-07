import { Attrs, parseElements } from "./xml.js";

export type ItemKind = "houses" | "commerce" | "decoration" | "other";

export interface ItemDefinition {
  sku: string;
  kind: ItemKind;
  subtype: string;
  level: number;
  baseCols: number;
  baseRows: number;
  tenants: number;
  contractsTypeSku: string;
  constructionCoins: number;
  constructionCash: number;
  constructionFBCnoCash: number;
  /** ms. XML minutes -> ms (ItemDefinition.as:575 minToMs). */
  constructionTimeMs: number;
  /** ms. Commerce: XML minutes; others: XML hours (ItemDefinition.as:393). */
  incomeTimeMs: number;
  /** ms, commerce `eventOnTime` minutes (unit assumed minutes; see notes). */
  eventOnTimeMs: number;
  incomeValue: number;
  incomeXP: number;
  incomeLevelFactor: number;
  exp: number;
  influenceValue: number;
  influenceRatio: number;
  instantBuildFactor: number;
  instantBuildFBC: number;
  instantBuildType: string;
  movePriceCoins: number;
  companyValue: number;
}

const num = (a: Attrs, k: string, d = 0): number => {
  const v = Number(a[k]);
  return a[k] !== undefined && a[k] !== "" && Number.isFinite(v) ? v : d;
};
/** AS3 `int(x)` cast of an XML attribute (ActionGetItemDefinitions.itemCommonFromXML reads most fields with int(...)). */
const int = (a: Attrs, k: string, d = 0): number => Math.trunc(num(a, k, d));

/** ItemDefinition.as:575 (constructionTime), :393 (incomeTime), :476 build(). */
export function itemFromAttrs(a: Attrs, kind: ItemKind): ItemDefinition {
  const incomeUnit = kind === "commerce" ? 60_000 : 3_600_000;
  return {
    sku: a.sku ?? "",
    kind,
    subtype: a.subtype ?? "",
    level: num(a, "level", 1),
    baseCols: int(a, "baseCols", 1),
    baseRows: int(a, "baseRows", 1),
    tenants: int(a, "tenants"),
    contractsTypeSku: a.contractsTypeSku ?? "",
    constructionCoins: int(a, "constructionCoins"),
    constructionCash: int(a, "constructionCash"),
    constructionFBCnoCash: int(a, "constructionFBCnoCash"),
    constructionTimeMs: Math.round(num(a, "constructionTime") * 60_000),
    incomeTimeMs: Math.round(num(a, "incomeTime") * incomeUnit),
    eventOnTimeMs: int(a, "eventOnTime") * 60_000,
    // ActionGetItemDefinitions.as:93 reads ONLY @incomeValue (houses have none -> 0); the houses' costCoins/incomeCoins
    // attributes are never read by the original (contracts.xml supplies the rent).
    incomeValue: int(a, "incomeValue"),
    incomeXP: int(a, "incomeXP"),
    incomeLevelFactor: num(a, "incomeLevelFactor"),
    exp: int(a, "exp"),
    influenceValue: num(a, "influenceValue"),
    influenceRatio: int(a, "influenceRatio"),
    instantBuildFactor: num(a, "instantBuildFactor"),
    instantBuildFBC: int(a, "instantBuildFBC"),
    instantBuildType: a.instantBuildType ?? "",
    movePriceCoins: int(a, "movePriceCoins"),
    companyValue: int(a, "companyValue")
  };
}

/** Parse itemDefinitions.xml / commerceDefinitions.xml / decorationDefinitions.xml text. */
export function parseDefinitions(xmlText: string, kind: ItemKind): ItemDefinition[] {
  return parseElements(xmlText, "Definition").map((a) => itemFromAttrs(a, kind));
}

/** ItemDefinition.requiresTerrainMine (ItemDefinition.as:633). */
export function requiresTerrainMine(def: ItemDefinition): boolean {
  return def.kind !== "decoration";
}

export interface ContractDefinition {
  sku: string;
  level: number;
  costCoins: number;
  incomeCoins: number;
  incomeXP: number;
  /** ms; contracts.xml incomeTime is hours (ContractDefinition.as setIncomeTime hourToMs). */
  incomeTimeMs: number;
}

export function parseContracts(xmlText: string): ContractDefinition[] {
  return parseElements(xmlText, "Definition").map((a) => ({
    sku: a.sku ?? "",
    level: num(a, "level", 1),
    costCoins: num(a, "costCoins"),
    incomeCoins: num(a, "incomeCoins"),
    incomeXP: int(a, "incomeXp"),
    incomeTimeMs: Math.round(num(a, "incomeTime") * 3_600_000)
  }));
}

/** contractsTypes.xml: type sku -> contract skus (values may contain spaces). */
export function parseContractTypes(xmlText: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const a of parseElements(xmlText, "Definition")) {
    m.set(a.sku ?? "", (a.contractsSkus ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  }
  return m;
}

export interface LevelRow {
  level: number;
  xpNeed: number;
  timePrice: number;
  terrainPrice: number;
  exchangeFBC: number;
  exchangeGold: number;
}

/** XPTable.xml (RulesFacade.as:580-604). Row i = level i+1. */
export function parseXpTable(xmlText: string): LevelRow[] {
  return parseElements(xmlText, "level").map((a) => ({
    level: num(a, "id"),
    xpNeed: num(a, "xpneed"),
    timePrice: num(a, "timePrice"),
    terrainPrice: num(a, "terrainPrice"),
    exchangeFBC: num(a, "exchangeFBC"),
    exchangeGold: num(a, "exchangeGold")
  }));
}

/** Highest level whose xpNeed <= xp. */
export function levelForXp(table: LevelRow[], xp: number): number {
  let lvl = table[0]?.level ?? 1;
  for (const r of table) if (xp >= r.xpNeed) lvl = r.level;
  return lvl;
}

/** XP required to reach `level` (RulesFacade.getLevelXP, :381). */
export function xpForLevel(table: LevelRow[], level: number): number {
  return table.find((r) => r.level === level)?.xpNeed ?? Infinity;
}

export interface Settings {
  incomeMultiplier: number;
  abandonTimePercentage: number;
  /** ms (RulesFacade.as:937 minToMs). */
  abandonMinTimeMs: number;
  cashToCoins: number;
  sellPricePercentage: number;
}

export function parseSettings(xmlText: string): Settings {
  const a = parseElements(xmlText, "Definition")[0] ?? {};
  return {
    incomeMultiplier: Math.trunc(num(a, "incomeMultiplier")),
    abandonTimePercentage: Math.trunc(num(a, "abandonTimePercentage")),
    abandonMinTimeMs: Math.trunc(num(a, "abandonMinTime") * 60_000),
    cashToCoins: num(a, "cashToCoins", 60000),
    sellPricePercentage: num(a, "sellPricePercentage")
  };
}
