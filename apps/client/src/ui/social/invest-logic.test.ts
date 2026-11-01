import { describe, expect, it } from 'vitest';
import { friendsToInvest, InvestState, parseInvestments, sortInvestments, successPercentage, timeLeftLabel } from './invest-logic';

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
  it('excludes any friend with an investment (any state) and sorts the rest by name as strings', () => {
    const friends = [
      { extId: 'npc_Sheik', name: 'Sheik' },
      { extId: 'npc_Ronald', name: 'Ronald' },
      { extId: 'npc_Cindy', name: 'Cindy' },
      { extId: 'npc_Zed', name: 'Zed' },
      { extId: 'npc_Abe', name: 'Abe' },
    ];
    const invests = [
      { extId: 'npc_Sheik', userId: 0, companyValue: 0, timeLeft: 0, remindTimeLeft: 0, state: InvestState.RUNNING },
      { extId: 'npc_Zed', userId: 0, companyValue: 0, timeLeft: 0, remindTimeLeft: 0, state: InvestState.DONE_CLAIMED },
    ];
    expect(friendsToInvest(friends, invests).map((f) => f.name)).toEqual(['Abe', 'Cindy', 'Ronald']);
    expect(friendsToInvest(friends, [])).toHaveLength(5);
    // plain string compare: uppercase sorts before lowercase, as sortCompareFunctionName does
    expect(friendsToInvest([{ extId: 'a', name: 'bob' }, { extId: 'b', name: 'Zoe' }], []).map((f) => f.name)).toEqual(['Zoe', 'bob']);
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
