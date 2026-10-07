import { describe, expect, it } from 'vitest';
import { contractSlot, goldForCoins, parseExpansionPrices, plotAction, priceFor } from './logic';

describe('popup logic', () => {
  it('rounds gold up like convertToGold', () => {
    expect(goldForCoins(60001, 60000)).toBe(2);
    expect(goldForCoins(60000, 60000)).toBe(1);
    expect(goldForCoins(0, 60000)).toBe(0);
  });
  it('parses expansion prices and clamps', () => {
    const p = parseExpansionPrices('<E><Definition DCCoins="4000000" DCCash="29" FBC="58" InversorsSuccessful="1"/><Definition DCCoins="6000000" DCCash="39" FBC="78" InversorsSuccessful="2"/></E>');
    expect(p).toHaveLength(2);
    expect(priceFor(p, 0).cash).toBe(29);
    expect(priceFor(p, 9).coins).toBe(6000000);
  });
  it('plot actions', () => {
    expect(plotAction(1)).toBe('buy');
    expect(plotAction(0)).toBe('locked');
    expect(plotAction(2)).toBe('none');
  });
  it('contract grid', () => {
    expect(contractSlot(0)).toEqual({ page: 0, x: -114, y: -80 });
    expect(contractSlot(4)).toEqual({ page: 0, x: 0, y: 67 });
    expect(contractSlot(6).page).toBe(1);
  });
});
