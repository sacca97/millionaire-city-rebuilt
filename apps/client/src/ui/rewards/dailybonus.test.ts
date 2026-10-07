import { describe, expect, it } from 'vitest';
import { dayStates, isBonusEnabled, parseDailyInfo, rewardGain } from './dailybonus-logic';

describe('daily bonus', () => {
  it('first day: day1 current, others pending', () => {
    const s = dayStates(parseDailyInfo({ dailyRewardsCount: '0', dailyRewardsNextRewardId: 'reward_02' }));
    expect(s.map((x) => x.state)).toEqual(['current', 'pending', 'pending', 'pending', 'pending']);
    expect(s[0].sku).toBe('reward_02');
  });
  it('day 3 shows two collected', () => {
    const s = dayStates(parseDailyInfo({ dailyRewardsCount: 3, dailyRewardsLastGiven: 'a,b,', dailyRewardsNextRewardId: 'c' }));
    expect(s.map((x) => x.state)).toEqual(['collected', 'collected', 'current', 'pending', 'pending']);
  });
  it('day 5 is the big reward', () => {
    const s = dayStates(parseDailyInfo({ dailyRewardsCount: 5, dailyRewardsNextRewardId: 'r' }));
    expect(s[4].state).toBe('current');
    expect(s[3].state).toBe('collected');
  });
  it('enabled after a day', () => {
    const i = parseDailyInfo({ dailyRewardsLastGivenDate: 1000 });
    expect(isBonusEnabled(i, 1000 + 86_400_000)).toBe(true);
    expect(isBonusEnabled(i, 1000 + 3_600_000)).toBe(false);
  });
  it('gain', () => {
    expect(rewardGain({ sku: 'x', bonusType: 'coins', value: '100', group: 1, chances: 1, date: '' }, 7).coins).toBe(100);
    expect(rewardGain({ sku: 'x', bonusType: 'coins', value: '100', group: 6, chances: 1, date: '1:1:2011' }, 7).coins).toBe(700);
  });
});
