// Golden numbers from the ORIGINAL Java backend (archive-recovery-2026-10-06/java/dollars) and the 0.501 rules data.
import { describe, expect, test } from "vitest";
import { collectibleDropChance, COLLECTIBLE_CHANCE_BY_HOURS } from "../src/commandHandlers/collectibles.js";
import { CASH_TO_COINS } from "../src/commandHandlers/money.js";
import { DAILY_BONUS_COINS, DAILY_BONUS_TIME_MS, getDailyRewardGroupByDay, levelFromExp } from "../src/commandHandlers/offline.js";

describe("server parity with original Java", () => {
  test("exchange: Settings.smCashToCoins = 60000 (SecurityNormal.java:85)", () => {
    expect(CASH_TO_COINS).toBe(60000);
    expect(5 * CASH_TO_COINS).toBe(300000);
  });
  test("dailyBonusDone coins = dailyBonus*4 = 20000 (SecurityNormal.java:91)", () => {
    expect(DAILY_BONUS_COINS * 4).toBe(20000);
    expect(DAILY_BONUS_TIME_MS).toBe(86_400_000);
  });
  test.each([[1, 0], [2, 470], [3, 1010], [4, 1580], [10, 7130], [11, 9010]])("level %i starts at xp %i (XPTable)", (level, xp) => {
    expect(levelFromExp(xp)).toBe(level);
    if (xp > 0) expect(levelFromExp(xp - 1)).toBe(level - 1);
  });
  test.each([["1", 0.0125], ["2", 0.025], ["3", 0.0375], ["4", 0.0375], ["5", 0.066667]])(
    "collectible drop chance contract %s = %f (CollectiblesRules.java:182, chances table)",
    (sku, chance) => expect(collectibleDropChance(sku)).toBeCloseTo(chance, 5)
  );
  test("chance table has 11 income-time rows, max 20.8333% at 24h", () => {
    expect(COLLECTIBLE_CHANCE_BY_HOURS.size).toBe(11);
    expect(COLLECTIBLE_CHANCE_BY_HOURS.get(24)).toBeCloseTo(0.208333, 5);
  });
  test("daily reward groups cycle 1..5 (DailyRewardsRules.java:46)", () => {
    expect([1, 2, 3, 4, 5, 6].map(getDailyRewardGroupByDay)).toEqual([1, 2, 3, 4, 5, 1]);
  });
});
