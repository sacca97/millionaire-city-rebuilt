// Pure logic of the daily bonus (DailyBonusManager.as / PopupDailyReward.as).
export interface DailyDefinition {
  sku: string;
  bonusType: 'exp' | 'coins' | 'cash' | 'item';
  value: string;
  group: number;
  chances: number;
  /** "dd:mm:yyyy" for dated (birthday) rewards; 0 = regular. */
  date: string;
}

export interface DailyInfo {
  count: number;
  lastGiven: string[];
  lastGivenDate: number;
  nextRewardId: string;
}

export function parseDailyInfo(dat: Record<string, unknown> | undefined): DailyInfo {
  const d = dat ?? {};
  // DailyBonusManager.build (:108-113): split(","), keeping the trailing "" of "a,b," (PopupDailyReward's slice relies on it).
  let given = String(d.dailyRewardsLastGiven ?? '').split(',');
  if (given.length <= 1 && given[0] === '') given = [];
  return {
    // The original server answers count=1 for a fresh/reset streak (GamePlay.java:953); the TS server sends 0.
    count: Math.max(1, Number(d.dailyRewardsCount ?? 0) || 0),
    lastGiven: given,
    lastGivenDate: Number(d.dailyRewardsLastGivenDate ?? 0) || 0,
    nextRewardId: String(d.dailyRewardsNextRewardId ?? ''),
  };
}

/** DailyBonusManager.isBonusEnabled: at least one day since the last claim (Math.abs, as in the original). */
export function isBonusEnabled(info: DailyInfo, nowMs: number): boolean {
  return Math.abs((nowMs - info.lastGivenDate) / 86_400_000) >= 1;
}

export const LAST_DAY = 5;

export type DayState = { day: number; state: 'collected' | 'current' | 'pending'; sku?: string };

/** PopupDailyReward.getRewards (:105-167): days 1..4 small boxes, day 5 big box. */
export function dayStates(info: DailyInfo): DayState[] {
  let cur = info.count % LAST_DAY;
  if (cur === 0) cur = LAST_DAY;
  const hist = info.lastGiven;
  const last = hist.length - 1;
  const start = Math.max(0, last - (cur - 1));
  const collected = hist.slice(start, last); // AS slice(a, b) excludes b (kept as in the original)
  const out: DayState[] = [];
  for (let d = 1; d < LAST_DAY; d++) {
    if (d < cur) out.push({ day: d, state: 'collected', sku: collected[d - 1] });
    else if (d === cur) out.push({ day: d, state: 'current', sku: info.nextRewardId });
    else out.push({ day: d, state: 'pending' });
  }
  out.push(cur === LAST_DAY ? { day: LAST_DAY, state: 'current', sku: info.nextRewardId } : { day: LAST_DAY, state: 'pending' });
  return out;
}

/** DailyBonusManager.keepDailyBonus: the gain granted by a definition (coins scale with level only for dated rewards). */
export function rewardGain(def: DailyDefinition, level: number): { exp: number; coins: number; cash: number; item: string | null } {
  const v = Number(def.value) || 0;
  switch (def.bonusType) {
    case 'exp': return { exp: v, coins: 0, cash: 0, item: null };
    case 'cash': return { exp: 0, coins: 0, cash: v, item: null };
    case 'coins': return { exp: 0, coins: def.date ? v * level : v, cash: 0, item: null };
    default: return { exp: 0, coins: 0, cash: 0, item: def.value };
  }
}
