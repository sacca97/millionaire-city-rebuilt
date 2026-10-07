// Game rule tables (XPTable, contracts, settings) and the small pure economy formulas of the original.
// Sources: RulesFacade.as (levels :580-604, settings :920-940, getInstantBuildPrice :331, destroy profits :1010/:1035),
// Profile.getTimePrice (Profile.as:2042) / getTerrainPrice, ItemDefinition.getMoveFactor (ItemDefinition.as:548).
import {
  instantBuildPriceAt,
  levelForXp,
  parseContractTypes,
  parseContracts,
  parseSettings,
  parseXpTable,
  type ContractDefinition,
  type ItemDefinition,
  type LevelRow,
  type Settings
} from "@mcity/rules";
import { parseElements } from "@mcity/rules";
import { parseCrewDefinitions, type CrewDefinition } from "./crew";

export interface ContractInfo extends ContractDefinition {
  name: string;
  icon: string;
}

export interface GameSettings extends Settings {
  destroyItemProfitPercentage: number;
  destroyTerrainProfitPercentage: number;
  cancelContractProfitPercentage: number;
  initialCoins: number;
}

export interface GameRules {
  xp: LevelRow[];
  /** XPTable @DCCashLevelUp per level row (RulesFacade.as:602); absent in the shipped data -> 0. */
  levelCash: number[];
  contracts: Map<string, ContractInfo>;
  contractTypes: Map<string, string[]>;
  settings: GameSettings;
  /** expansionsPrices.xml @DCCash per expansion (Profile.getCompanyValuePerExpansions). */
  expansionCash: number[];
  /** crewMechanicsDefinition.xml by crew sku (CrewMechanicsManager). */
  crew: Map<string, CrewDefinition>;
}

const n = (v: string | undefined, d = 0): number => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

export function parseGameRules(files: { xpTable: string; contracts: string; contractTypes: string; settings: string; expansionsPrices?: string; crew?: string }): GameRules {
  const xp = parseXpTable(files.xpTable);
  const levelCash = parseElements(files.xpTable, "level").map((a) => Math.trunc(n(a.DCCashLevelUp)));
  const names = new Map(parseElements(files.contracts, "Definition").map((a) => [a.sku ?? "", a]));
  const contracts = new Map<string, ContractInfo>();
  for (const c of parseContracts(files.contracts)) {
    // ActionGetContractDefinitions.as:19: costCoins/incomeCoins are int(...) casts.
    contracts.set(c.sku, {
      ...c,
      costCoins: Math.trunc(c.costCoins),
      incomeCoins: Math.trunc(c.incomeCoins),
      name: names.get(c.sku)?.name ?? c.sku,
      icon: names.get(c.sku)?.icon ?? ""
    });
  }
  const raw = parseElements(files.settings, "Definition")[0] ?? {};
  const base = parseSettings(files.settings);
  return {
    xp,
    levelCash,
    contracts,
    contractTypes: parseContractTypes(files.contractTypes),
    expansionCash: [...(files.expansionsPrices ?? "").matchAll(/<Definition\s+([^>]*?)\/?>/g)].map((m) => Number(/\bDCCash="(\d+)"/.exec(m[1])?.[1] ?? 0)),
    crew: parseCrewDefinitions(files.crew ?? ""),
    settings: {
      ...base,
      destroyItemProfitPercentage: n(raw.destroyItemProfitPercentage, 35),
      destroyTerrainProfitPercentage: n(raw.destroyTerrainProfitPercentage, 100),
      cancelContractProfitPercentage: n(raw.cancelContractProfitPercentage, 50),
      initialCoins: n(raw.initialDCCoins)
    }
  };
}

export const RULES_ROOT = "/mcity/0.501/Datas/rules/";

export async function loadGameRules(fetchText: (file: string) => Promise<string>): Promise<GameRules> {
  const optional = (file: string): Promise<string> => fetchText(file).catch(() => "");
  const [xpTable, contracts, contractTypes, settings, expansionsPrices, crew] = await Promise.all([
    ...["XPTable.xml", "contracts.xml", "contractsTypes.xml", "settings.xml"].map(fetchText),
    optional("expansionsPrices.xml"),
    optional("crewMechanicsDefinition.xml")
  ]);
  return parseGameRules({ xpTable, contracts, contractTypes, settings, expansionsPrices, crew });
}

/** Level for an exp total (Profile.level via XPTable). */
export const levelOf = (r: GameRules, exp: number): number => levelForXp(r.xp, exp);
/** XP needed for the level after `level` (Infinity at max). */
export const xpToReach = (r: GameRules, level: number): number => r.xp.find((row) => row.level === level)?.xpNeed ?? Infinity;
const row = (r: GameRules, level: number): LevelRow | undefined => r.xp[Math.min(Math.max(level, 1), r.xp.length) - 1];

/** Profile.getTerrainPrice: XPTable @terrainPrice of the current level row. */
export const terrainPrice = (r: GameRules, level: number): number => row(r, level)?.terrainPrice ?? 0;
/** Profile.getTimePrice(ms): coins per minute at the current level row. */
export const timePrice = (r: GameRules, level: number): number => row(r, level)?.timePrice ?? 0;

/** ItemObject.getSellPrice/settingsGetDestroyItemProfit: int(companyValue * destroyItemProfitPercentage / 100). */
export const destroyProfit = (r: GameRules, def: ItemDefinition): number =>
  Math.trunc((def.companyValue * r.settings.destroyItemProfitPercentage) / 100);
/**
 * ItemObject.getSellPrice (:699) of a rival company's building: settingsGetSellPrice(tiles * Profile.getTerrainPrice + def.getCompanyValue)
 * = int(x * sellPricePercentage / 100). Shown on the FOR SALE sign (StateOnIA.viewForSale :372).
 */
export const rivalSellPrice = (r: GameRules, level: number, def: ItemDefinition, cols: number, rows: number): number =>
  Math.trunc((cols * rows * terrainPrice(r, level) + def.companyValue) * r.settings.sellPricePercentage / 100);
export const destroyTerrainProfit = (r: GameRules, price: number): number =>
  Math.trunc((price * r.settings.destroyTerrainProfitPercentage) / 100);

/** ToolMove.getPlaceItemCoins: movePriceCoins + timePrice * constructionMinutes * min(1, instantBuildFactor). */
export function movePrice(r: GameRules, level: number, def: ItemDefinition): number {
  // ItemDefinition.getMoveFactor (:548) caps the factor at 1; getInstantBuildPrice truncates twice (see instantBuildPriceAt).
  return def.movePriceCoins + instantBuildPriceAt(timePrice(r, level), def.constructionTimeMs, Math.min(1, def.instantBuildFactor));
}

/** Contracts available to an item definition (contractsTypes.xml), in shop order. */
export function contractsForDef(r: GameRules, def: ItemDefinition): ContractInfo[] {
  return (r.contractTypes.get(def.contractsTypeSku) ?? []).map((sku) => r.contracts.get(sku)).filter((c): c is ContractInfo => !!c);
}

/** RulesFacade.settingsGetAbandonTime. */
export const abandonTimeMs = (r: GameRules, incomeMs: number): number =>
  Math.max(Math.trunc((incomeMs * r.settings.abandonTimePercentage) / 100), r.settings.abandonMinTimeMs);
