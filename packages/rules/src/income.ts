import { ContractDefinition, ItemDefinition, LevelRow, Settings } from "./definitions.js";

export interface IncomeInputs {
  def: ItemDefinition;
  contract?: ContractDefinition | null;
  /** commerce: sum of getPopulation() of houses affected (ItemObject.as:336-346) */
  affectedPopulation?: number;
  /** UpgradesManager.getExtraPercentage(sid) when the state's upgradeGetEnabled() */
  upgradeExtraPercentage?: number;
  /** ItemObject.influenceValue (ItemObject.as:2539), percent */
  influenceValue?: number;
  /** getPopulation() of this item, used for incomeLevelFactor (see note in getIncomeValue) */
  population?: number;
}

/** ItemObject.getIncomeCoins (ItemObject.as:987): def value + contract coins. */
export const getIncomeCoins = (def: ItemDefinition, contract?: ContractDefinition | null): number =>
  def.incomeValue + (contract?.incomeCoins ?? 0);

/** ItemObject.getIncomeXP (ItemObject.as:2923). */
export const getIncomeXP = (def: ItemDefinition, contract?: ContractDefinition | null): number =>
  def.incomeXP + (contract?.incomeXP ?? 0);

/** ItemObject.incomeTime (ItemObject.as:436): contract time overrides def time (ms). */
export const getIncomeTimeMs = (def: ItemDefinition, contract?: ContractDefinition | null): number =>
  contract ? contract.incomeTimeMs : def.incomeTimeMs;

/**
 * ItemObject.getIncomeValue (ItemObject.as:329-374). Returns uint in AS (trunc toward zero on assignment
 * of each int-typed result is NOT applied mid-way: values are uint but arithmetic is Number-based
 * until the uint conversion on each `_loc3_ +=`; we emulate with >>>0 truncation after each step).
 * Commerce (def.kind==="commerce"): incomeCoins * affectedPopulation.
 */
export function getIncomeValue(i: IncomeInputs): number {
  const u = (n: number) => Math.max(0, Math.trunc(n)) >>> 0;
  let v: number;
  if (i.def.kind === "commerce") v = u(getIncomeCoins(i.def, i.contract) * u(i.affectedPopulation ?? 0));
  else v = u(getIncomeCoins(i.def, i.contract));
  if (i.upgradeExtraPercentage !== undefined) v = u(v + (i.upgradeExtraPercentage * v) / 100);
  v = u(v + (v * (i.influenceValue ?? 0)) / 100);
  if (i.def.incomeLevelFactor > 0 && v > 0) v = u(v + i.def.incomeLevelFactor * u(i.affectedPopulation ?? 0));
  return v;
}

/** RulesFacade.settingsGetAbandonTime (RulesFacade.as:832). Both args ms. */
export function settingsGetAbandonTime(incomeTimeMs: number, s: Pick<Settings, "abandonTimePercentage" | "abandonMinTimeMs">): number {
  return Math.max(Math.trunc((incomeTimeMs * s.abandonTimePercentage) / 100), s.abandonMinTimeMs);
}

/** RulesFacade.getTimePrice (RulesFacade.as:376): timePrice of the LAST row of XPTable (loop overwrites). */
export const getTimePrice = (table: LevelRow[]): number => table[table.length - 1]?.timePrice ?? 0;

/**
 * ItemDefinition.build (ItemDefinition.as:476) overflow diagnostic ONLY: it uses the static RulesFacade.getTimePrice() (last XPTable row)
 * and is NOT the price the player pays; use instantBuildPriceAt with the current level's timePrice for that.
 */
export function instantBuildPrice(def: ItemDefinition, table: LevelRow[]): number {
  return getTimePrice(table) * (def.constructionTimeMs / 60_000) * def.instantBuildFactor;
}

/**
 * RulesFacade.getInstantBuildPrice(ms, factor) (RulesFacade.as:331) = Profile.getTimePrice(ms) * factor, where
 * Profile.getTimePrice (Profile.as:2042) returns an AS3 `int`: timePrice(level row) * minutes is truncated FIRST, then multiplied by
 * the factor and truncated again (two int casts, not one). `timePrice` is the XPTable row of the player's current level.
 * Used for the instant-build price (remaining construction time) and, with min(1, factor), the move price (ToolMove.as:132).
 */
export function instantBuildPriceAt(timePrice: number, ms: number, factor: number): number {
  const perTime = Math.trunc(timePrice * (ms / 60_000));
  return Math.trunc(perTime * factor);
}
