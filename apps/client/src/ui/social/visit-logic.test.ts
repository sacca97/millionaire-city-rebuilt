import { describe, expect, it } from 'vitest';
import { upgradeRewardFor, upgradeTypeFor, UPGRADE_TYPE_NORMAL, UPGRADE_TYPE_SUPER } from './visit-logic';

describe('visitor upgrade type (UpgradesManager.setNeighborId)', () => {
  it('NPC neighbours are partners: SUPER', () => {
    expect(upgradeTypeFor('100')).toBe(UPGRADE_TYPE_SUPER);
    expect(upgradeTypeFor('101')).toBe(UPGRADE_TYPE_SUPER);
  });
  it('other neighbours are NORMAL', () => {
    expect(upgradeTypeFor('555')).toBe(UPGRADE_TYPE_NORMAL);
  });
  it('reward by type (UpgradesManager.as:95-98)', () => {
    expect(upgradeRewardFor(1)).toEqual({ coins: 150, exp: 15 });
    expect(upgradeRewardFor(0)).toEqual({ coins: 100, exp: 10 });
  });
});
