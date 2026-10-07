import { describe, expect, it } from 'vitest';
import { InvestState, parseInvestments, sortInvestments, successPercentage, timeLeftLabel } from './invest-logic';

describe('investments', () => {
  it('parses the server list', () => {
    const r = parseInvestments({
      investmentsStarted: '3',
      investmentsRewarded: '1',
      investmentsList: [{ investment: [], extId: 'npc_Sheik', userId: '-1', value: '10', time: '5000', remindTime: '0', state: '2' }],
    });
    expect(r.started).toBe(3);
    expect(r.list[0]).toMatchObject({ extId: 'npc_Sheik', state: InvestState.RUNNING, timeLeft: 5000 });
  });
  it('sorts and formats', () => {
    const s = sortInvestments([
      { extId: 'a', userId: 0, companyValue: 0, timeLeft: 0, remindTimeLeft: 0, state: InvestState.DONE_CLAIMED },
      { extId: 'b', userId: 0, companyValue: 0, timeLeft: 0, remindTimeLeft: 0, state: InvestState.DONE },
    ]);
    expect(s[0].extId).toBe('b');
    expect(timeLeftLabel(36 * 3_600_000)).toEqual({ n: 1, hours: false });
    expect(timeLeftLabel(90 * 60_000)).toEqual({ n: 2, hours: true });
    expect(successPercentage(4, 1)).toBe(25);
  });
});
