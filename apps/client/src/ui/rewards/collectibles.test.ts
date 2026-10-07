import { describe, expect, it } from 'vitest';
import { buildStore, GroupState, parseSetReward } from './collectibles-logic';

const store = () =>
  buildStore(
    [
      { sku: 'a1', tid: 'T', orderInCollection: '1', collection: '1', priceCoins: '4000', priceCash: '1', priceFBC: '5' },
      { sku: 'a2', tid: 'T', orderInCollection: '2', collection: '1', priceCoins: '3000', priceCash: '2', priceFBC: '5' },
      { sku: 'b1', tid: 'T', orderInCollection: '1', collection: '2', priceCoins: '10', priceCash: '1', priceFBC: '1' },
    ],
    [
      { sku: '1', tid: 'G', reward: 'r1', rewardType: 'hq', order: '50' },
      { sku: '2', tid: 'G', reward: 'r2', rewardType: 'hq', order: '60', requirements: '1' },
    ],
    [{ sku: 'r1', tid: 'R', rewardType: 'hq' }],
  );

describe('collectibles', () => {
  it('parses server attributes', () => {
    const s = store();
    s.load('a1:3,a2', '', '12:b1');
    expect(s.count('a1')).toBe(3);
    expect(s.count('a2')).toBe(1);
    expect(s.pending.get('12')).toBe('b1');
  });
  it('group states and unlocking', () => {
    const s = store();
    s.load('a1:1', '', '');
    expect(s.state('1')).toBe(GroupState.INCOMPLETED);
    expect(s.state('2')).toBe(GroupState.LOCKED);
    expect(s.wouldComplete('a2')).toBe(true);
    expect(s.keep('a2').completedGroup).toBe('1');
    expect(s.state('1')).toBe(GroupState.PENDING_TO_GET_REWARD);
    s.claim('1');
    expect(s.state('1')).toBe(GroupState.COMPLETED);
    expect(s.state('2')).toBe(GroupState.INCOMPLETED);
  });
  it('trade-in groups consume units', () => {
    const s = store();
    s.groups[0].tradeIn = true;
    s.load('a1:2,a2:1', '', '');
    s.claim('1');
    expect(s.count('a1')).toBe(1);
    expect(s.count('a2')).toBe(0);
    expect(s.state('1')).toBe(GroupState.INCOMPLETED);
  });
  it('set reward', () => {
    expect(parseSetReward('0:10000:250')).toEqual({ cash: 0, coins: 10000, exp: 250 });
  });
});
