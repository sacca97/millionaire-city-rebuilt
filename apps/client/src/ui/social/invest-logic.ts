// Pure model of investments (invests/InvestObject.as, InvestManager.as, investDefinitions.xml). Server: invest_* commands,
// get_investments_list {investmentsList:[{investment:[],extId,userId,value,time,remindTime,state,id}], investmentsStarted, investmentsRewarded}.
export const InvestState = { WAITING: 0, RUNNING: 1, DONE: 2, EXPIRED: 3, DONE_CLAIMED: 4 } as const;

export interface InvestObject {
  extId: string;
  userId: number;
  companyValue: number;
  timeLeft: number;
  remindTimeLeft: number;
  state: number;
}

export interface InvestDefinition {
  timeMs: number;
  target: number;
  /** coins paid to start an investment (attribute "inversion") */
  cost: number;
  rewardCoins: number;
  rewardCash: number;
}

/** InvestObject.setStatePersistence: server state -> UI state. */
export function stateFromPersistence(p: number): number {
  if (p === -1) return InvestState.EXPIRED;
  if (p === 2) return InvestState.RUNNING;
  if (p === 3) return InvestState.DONE;
  if (p === 10) return InvestState.DONE_CLAIMED;
  return InvestState.WAITING;
}

export function parseInvestments(dat: Record<string, unknown> | undefined): { list: InvestObject[]; started: number; rewarded: number } {
  const entries = (dat?.investmentsList as Array<Record<string, unknown>> | undefined) ?? [];
  const list: InvestObject[] = [];
  for (const e of entries) {
    if (!('investment' in e)) continue;
    list.push({
      extId: String(e.extId ?? ''),
      userId: Number(e.userId ?? 0) || 0,
      companyValue: Number(e.value ?? 0) || 0,
      timeLeft: Number(e.time ?? 0) || 0,
      remindTimeLeft: Number(e.remindTime ?? 0) || 0,
      state: stateFromPersistence(Number(e.state ?? 0)),
    });
  }
  return { list, started: Number(dat?.investmentsStarted ?? 0) || 0, rewarded: Number(dat?.investmentsRewarded ?? 0) || 0 };
}

/** InvestObject.isSuccesfully: finished (DONE) and the friend reached the target company value. */
export const isSuccessful = (o: InvestObject, def: InvestDefinition): boolean => o.state === InvestState.DONE && o.companyValue >= def.target;

/** InvestManager.sortInvestmentsUI order: done, running, expired, waiting..., claimed last. */
export function sortInvestments(list: InvestObject[]): InvestObject[] {
  const rank = (s: number) => (s === InvestState.DONE ? 0 : s === InvestState.RUNNING ? 1 : s === InvestState.EXPIRED ? 2 : s === InvestState.DONE_CLAIMED ? 4 : 3);
  return [...list].sort((a, b) => rank(a.state) - rank(b.state));
}

/** TimerUtil.msToDays + the hours fallback of InvestFriendInvestor: {n, hours} to print under "days"/"hours left". */
export function timeLeftLabel(ms: number): { n: number; hours: boolean } {
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return { n: days, hours: false };
  let h = Math.floor(ms / 3_600_000);
  if (ms - h * 3_600_000 > 0) h++;
  return { n: h, hours: true };
}

/** Success percentage shown in the statistics panel (InvestManager.statsGetInvestmentSuccessPercentage). */
export const successPercentage = (started: number, rewarded: number): number => (started > 0 ? Math.trunc((100 * rewarded) / started) : 0);
