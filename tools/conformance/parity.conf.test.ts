// Black-box port of apps/server/test/parity.test.ts. The original asserts exported constants and pure helpers; here each
// golden number is checked through its observable effect over HTTP (commands, /local/resources) and the SQLite file.
import { describe, expect, test } from "vitest";
import { clientFor } from "./lib/client.js";
import { sharedServer } from "./lib/server.js";
import { dailyRewardDefs, rewardSkuOfGroup } from "./lib/rules.js";
import { awardedSids, CHANCE_PERCENT_BY_HOURS, contractHours, findSavedAtForBucket } from "./lib/collectibles.js";

const server = sharedServer();

describe("server parity with original Java", () => {
  test("exchange: Settings.smCashToCoins = 60000 (SecurityNormal.java:85)", async () => {
    const s = server();
    await s.seed((db) => db.editUniverse(({ profile }) => Object.assign(profile, { DCCash: "10", DCCoins: "100" })));
    const c = clientFor(s);
    await c.send("update_money", { action: "exchange", value: 5 });
    const profile = s.profile();
    expect(profile.DCCash).toBe("5");
    expect(profile.DCCoins).toBe(String(100 + 5 * 60000)); // 5 * CASH_TO_COINS = 300000 coins
  });

  test("dailyBonusDone coins = dailyBonus*4 = 20000 and the bonus timer is 24h (SecurityNormal.java:91)", async () => {
    const s = server();
    await s.seed((db) => db.editUniverse(({ profile }) => Object.assign(profile, { DCCoins: "0" })));
    const c = clientFor(s);
    const before = Date.now();
    await c.send("update_money", { action: "dailyBonusDone" });
    const profile = s.profile();
    expect(profile.DCCoins).toBe("20000"); // DAILY_BONUS_COINS * 4
    const at = Number(s.meta("daily_bonus_at_1"));
    expect(at - before).toBeGreaterThanOrEqual(86_400_000); // DAILY_BONUS_TIME_MS
    expect(at - Date.now()).toBeLessThanOrEqual(86_400_000);
  });

  // XPTable: the level thresholds are observable through /local/resources (profile level from stored xp).
  const levels: Array<[number, number]> = [[1, 0], [2, 470], [3, 1010], [4, 1580], [10, 7130], [11, 9010]];
  describe("XPTable levels", () => {
    // sequential on one server, ascending xp: each case moves the stored xp with /local/resources/adjust
    test.each(levels)("level %i starts at xp %i (XPTable)", async (level, xp) => {
      const s = server();
      const post = async (delta: number) =>
        (await (await fetch(`${s.httpUrl}/local/resources/adjust`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ resource: "xp", delta })
        })).json()) as any;
      const current = Number(((await (await fetch(`${s.httpUrl}/local/resources`)).json()) as any).xp);
      if (xp === 0) {
        const res = (await (await fetch(`${s.httpUrl}/local/resources`)).json()) as any;
        expect(res.level).toBe(1);
        return;
      }
      // xp - 1 is still the previous level, xp is the new one
      const below = await post(xp - 1 - current);
      expect(below.xp).toBe(xp - 1);
      expect(below.level).toBe(level - 1);
      const at = await post(1);
      expect(at.xp).toBe(xp);
      expect(at.level).toBe(level);
    });
  });

  // Collectible drop chance per contract: the server awards a pending collectible when roll <= chance, with
  // roll = hash("sid:sku:contract:savedAt") % 100000 / 100000 (deterministic). Pin the threshold exactly: the highest bucket that
  // still awards and the next one that must not.
  async function thresholdAwards(contractSkus: string[], percentOf: (c: string) => number) {
    const s = server();
    const c = clientFor(s);
    const cases: Array<{ sid: string; contractSku: string; savedAt: string; expectAward: boolean }> = [];
    let n = 0;
    for (const contractSku of contractSkus) {
      const chance = percentOf(contractSku) / 100;
      const below = Math.floor(chance * 100000 + 1e-6);
      for (const [bucket, expectAward] of [[below, true], [below + 1, false]] as const) {
        const sid = String(9100 + n++);
        cases.push({ sid, contractSku, savedAt: findSavedAtForBucket(sid, "houses_001_001", contractSku, bucket), expectAward });
      }
    }
    const awarded = await awardedSids(s, c, cases);
    for (const k of cases) expect(awarded.has(k.sid), `contract ${k.contractSku} sid ${k.sid} expectAward=${k.expectAward}`).toBe(k.expectAward);
  }

  test.each([["1", 0.0125], ["2", 0.025], ["3", 0.0375], ["4", 0.0375], ["5", 0.066667]])(
    "collectible drop chance contract %s = %f (CollectiblesRules.java:182, chances table)",
    async (sku, chance) => {
      // a fresh server per case (the cases reuse the same house sids)
      const { startServer } = await import("./lib/server.js");
      const s = await startServer({ noFacebookShim: true });
      try {
        const c = clientFor(s);
        const below = Math.floor(chance * 100000 + 1e-6);
        const cases = [
          { sid: "9101", contractSku: sku, savedAt: findSavedAtForBucket("9101", "houses_001_001", sku, below), expectAward: true },
          { sid: "9102", contractSku: sku, savedAt: findSavedAtForBucket("9102", "houses_001_001", sku, below + 1), expectAward: false }
        ];
        const awarded = await awardedSids(s, c, cases);
        expect(awarded.has("9101")).toBe(true);
        expect(awarded.has("9102")).toBe(false);
      } finally {
        await s.cleanup();
      }
    }
  );

  test("chance table has 11 income-time rows, max 20.8333% at 24h", async () => {
    // contracts.xml has no 2h / 18h contract, so those two rows are internal; every other hour is pinned through a real contract.
    expect(CHANCE_PERCENT_BY_HOURS.size).toBe(11);
    expect(CHANCE_PERCENT_BY_HOURS.get(24)).toBeCloseTo(20.8333, 4);
    const hours = contractHours();
    const bySkuHour = new Map<number, string>();
    for (const [sku, h] of hours) if (!bySkuHour.has(h)) bySkuHour.set(h, sku);
    const reachable = [...bySkuHour.entries()].filter(([h]) => CHANCE_PERCENT_BY_HOURS.has(h));
    expect(reachable.length).toBeGreaterThanOrEqual(9);
    await thresholdAwards(reachable.map(([, sku]) => sku), (sku) => CHANCE_PERCENT_BY_HOURS.get(hours.get(sku)!)!);
  });

  test("daily reward groups cycle 1..5 (DailyRewardsRules.java:46)", async () => {
    const s = server();
    const c = clientFor(s);
    const defs = await dailyRewardDefs(s);
    expect(defs.length).toBeGreaterThan(15);
    const expectedGroups = [1, 2, 3, 4, 5, 1];
    for (let day = 1; day <= 6; day += 1) {
      const group = expectedGroups[day - 1];
      // day N is claimed when the stored count is N-1 and the last claim is 25h old
      await s.seed((db) =>
        db.editDoc("dailyBonusInfo", (d: any) => {
          d.dailyRewardsCount = String(day - 1);
          d.dailyRewardsLastGivenDate = String(Date.now() - 25 * 3_600_000);
        })
      );
      // a sku of a different group is refused, a sku of the day's group is accepted
      const other = rewardSkuOfGroup(defs, group === 1 ? 2 : 1);
      const refused = await c.send("update_daily_reward", { sku: other });
      expect(refused).toEqual({ success: "false" });
      const accepted = await c.send("update_daily_reward", { sku: rewardSkuOfGroup(defs, group) });
      expect(accepted).not.toHaveProperty("success");
    }
  });
});
