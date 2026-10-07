/**
 * Timer functions. The client counts down in ms per frame (StateOnConstruction.doLogicUpdate
 * StateOnConstruction.as:~255; StateOnRent.as:1190-1215); the server persists `time` (ms remaining)
 * plus a save timestamp, so these are pure functions of elapsed ms.
 */

/** Remaining construction ms after `elapsedMs` (clamped at 0). StateOnConstruction mTime -= dt. */
export const constructionRemaining = (remainingAtSaveMs: number, elapsedMs: number): number =>
  Math.max(0, remainingAtSaveMs - Math.max(0, elapsedMs));

export const constructionRemainingFromStart = (startMs: number, nowMs: number, constructionTimeMs: number): number =>
  constructionRemaining(constructionTimeMs, nowMs - startMs);

export const constructionDone = (startMs: number, nowMs: number, constructionTimeMs: number): boolean =>
  constructionRemainingFromStart(startMs, nowMs, constructionTimeMs) === 0;

/** Rent timer (MODE_RENTING) remaining ms; reaching 0 -> MODE_GET_RENT (StateOnRent.as:1213). */
export const rentRemaining = (remainingAtSaveMs: number, elapsedMs: number): number =>
  Math.max(0, remainingAtSaveMs - Math.max(0, elapsedMs));

export type RentPhase = "renting" | "collectable" | "abandoned";

/**
 * Phase after `elapsedMs` since entering MODE_RENTING with `incomeTimeMs`: after incomeTime the rent can be
 * collected (non-commerce houses then start an abandon countdown of settingsGetAbandonTime(incomeTime),
 * StateOnRent.as:654-657); when that also elapses the house is abandoned (MODE_ABANDONED).
 * Commerce buildings never get the abandon countdown (`!isACommerce()` guard, StateOnRent.as:652); a commerce
 * with population 0 at timer end just restarts renting (StateOnRent.as:1247-1254, not modelled).
 */
export function rentPhase(elapsedMs: number, incomeTimeMs: number, abandonMs: number, isCommerce: boolean): RentPhase {
  if (elapsedMs < incomeTimeMs) return "renting";
  if (isCommerce || elapsedMs < incomeTimeMs + abandonMs) return "collectable";
  return "abandoned";
}

/** accelerateIncomeTime(percent) (StateOnRent.as:1816): target -= maxIncomeTime*percent/100, floor 0. */
export const accelerateIncomeTime = (currentMs: number, maxIncomeTimeMs: number, percent: number): number =>
  Math.max(0, currentMs - Math.trunc((maxIncomeTimeMs * percent) / 100));
