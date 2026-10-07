// Golden parity tests: numbers computed from the ORIGINAL client semantics (decompiled/scripts/com/dchoc/dollars) on the real 0.501 rules.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getIncomeValue, getIncomeXP, instantBuildPriceAt, parseDefinitions } from "@mcity/rules";
import { abandonTimeMs, contractsForDef, destroyProfit, destroyTerrainProfit, levelOf, movePrice, parseGameRules, terrainPrice, timePrice } from "../src/game/rules";
import { acceleratedTime, commerceRent, computeCompanyValue, expansionsValue } from "../src/game/economy";
import { parseCatalogSettings, unlockSegmentsPrice } from "../src/ui/shop/catalog";
import { goldForCoins } from "../src/ui/popups/logic";
import { rewardGain } from "../src/ui/rewards/dailybonus-logic";

const R = resolve(__dirname, "../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules");
const rd = (f: string) => readFileSync(resolve(R, f), "utf8");
const rules = parseGameRules({ xpTable: rd("XPTable.xml"), contracts: rd("contracts.xml"), contractTypes: rd("contractsTypes.xml"), settings: rd("settings.xml"), expansionsPrices: rd("expansionsPrices.xml") });
const houses = parseDefinitions(rd("itemDefinitions.xml"), "houses");
const commerce = parseDefinitions(rd("commerceDefinitions.xml"), "commerce");
const wonders = parseDefinitions(rd("wonderDefinitions.xml"), "other");
const h = (sku: string) => houses.find((d) => d.sku === sku)!;
const c = (sku: string) => rules.contracts.get(sku)!;
const bungalow = h("houses_001_001");
const cat = parseCatalogSettings(rd("settings.xml"), rd("unlockSegmentsCash.xml"), rd("unlockSegmentsVisibility.xml"));
const unlock = (cur: number, target: number) => Math.min(unlockSegmentsPrice(cur, target, cat.segments, cat.visibility), cat.unlockMaxPrice);

describe("levels and XP (RulesFacade.levelLoadOnComplete, Profile.levelUp)", () => {
  it("level 2 needs 470 xp", () => { expect(levelOf(rules, 469)).toBe(1); expect(levelOf(rules, 470)).toBe(2); });
  it("level 3 needs 1010 xp", () => { expect(levelOf(rules, 1009)).toBe(2); expect(levelOf(rules, 1010)).toBe(3); });
  it("351 levels, last at 6142705480", () => { expect(rules.xp).toHaveLength(351); expect(levelOf(rules, 6142705480)).toBe(351); expect(levelOf(rules, 6142705479)).toBe(350); });
  it("level-up gold is 0 (DCCashLevelUp absent -> int(empty XMLList))", () => { expect(rules.levelCash.every((v) => v === 0)).toBe(true); });
  it("terrain price 1000 at every level", () => { expect(terrainPrice(rules, 1)).toBe(1000); expect(terrainPrice(rules, 351)).toBe(1000); });
  it.each([[1, 250], [9, 278], [21, 313], [351, 4545]])("time price level %i = %i", (l, p) => expect(timePrice(rules, l)).toBe(p));
  it("settings", () => {
    expect(rules.settings).toMatchObject({ cashToCoins: 60000, initialCoins: 380000, destroyItemProfitPercentage: 35, destroyTerrainProfitPercentage: 100, cancelContractProfitPercentage: 50, abandonMinTimeMs: 3_600_000 });
    expect(cat.unlockMaxPrice).toBe(65);
  });
});

describe("definitions (int casts of ActionGetItemDefinitions)", () => {
  it("bungalow", () => { expect(bungalow).toMatchObject({ level: 1, constructionCoins: 30000, constructionTimeMs: 600_000, exp: 100, tenants: 3, companyValue: 30000 }); });
  it("bank construction 30 min, level 26, 6M", () => { const b = commerce.find((d) => d.sku === "commerce_bank")!; expect(b).toMatchObject({ level: 26, constructionCoins: 6_000_000, constructionTimeMs: 1_800_000, incomeTimeMs: 180_000 }); });
  it("fractional tenants truncate (11.2 -> 11)", () => expect(h("houses_036_001").tenants).toBe(11));
  it("fractional movePriceCoins truncate", () => expect(h("houses_048_002").movePriceCoins).toBe(1879949));
  it("fractional influenceRatio truncates (3.2 -> 3)", () => expect(commerce.find((d) => d.sku === "commerce_aquarium")!.influenceRatio).toBe(3));
});

describe("contracts", () => {
  it("bungalow contract list order", () => expect(contractsForDef(rules, bungalow).map((x) => x.sku)).toEqual(["1", "2", "3", "154", "4", "5", "6", "171", "7", "8", "9"]));
  it("every contract type resolves 11 contracts", () => { for (const [k, v] of rules.contractTypes) if (Number(k) <= 17) expect(v.map((s) => rules.contracts.get(s)).filter(Boolean)).toHaveLength(11); });
  it.each([
    ["1", 350, 1, 180_000, 90], ["4", 4300, 15, 14_400_000, 1062], ["9", 20700, 72, 259_200_000, 7500]
  ])("bungalow on contract %s", (sku, coins, xp, ms, cost) => {
    expect(getIncomeValue({ def: bungalow, contract: c(sku) })).toBe(coins);
    expect(getIncomeXP(bungalow, c(sku))).toBe(xp);
    expect(c(sku).incomeTimeMs).toBe(ms);
    expect(c(sku).costCoins).toBe(cost);
  });
  it("luxury bungalow contract 10: 402.5 -> 402", () => expect(getIncomeValue({ def: h("houses_001_002"), contract: c("10") })).toBe(402));
  it("contract level gates", () => { expect([c("6").level, c("8").level, c("171").level]).toEqual([4, 3, 16]); });
  it("abandon time = max(incomeTime, 1h)", () => { expect(abandonTimeMs(rules, 180_000)).toBe(3_600_000); expect(abandonTimeMs(rules, 259_200_000)).toBe(259_200_000); });
  it("owner upgrade +10% / +12% on coins and xp", () => {
    expect(getIncomeValue({ def: bungalow, contract: c("1"), upgradeExtraPercentage: 10 })).toBe(385);
    expect(getIncomeValue({ def: bungalow, contract: c("4"), upgradeExtraPercentage: 12 })).toBe(4816);
    expect(getIncomeXP(bungalow, c("4")) + Math.trunc((10 * 15) / 100)).toBe(16);
  });
  it("commerce rent: population x income, influence %", () => {
    expect(commerceRent(40, 3, 0, 0)).toBe(120);
    expect(commerceRent(40, 3, 10, 0)).toBe(132);
    expect(commerceRent(100, 3, 0, 0.5)).toBe(301);
  });
  it("accelerator percent of full time, floor 0", () => { expect(acceleratedTime(14_400_000, 14_400_000, 30)).toBe(10_080_000); expect(acceleratedTime(1000, 14_400_000, 30)).toBe(0); });
});

describe("prices", () => {
  it("instant build uses remaining time and double int cast", () => {
    expect(instantBuildPriceAt(250, 600_000, 0.1875)).toBe(468);
    expect(instantBuildPriceAt(250, 360_000, 0.1875)).toBe(281);
    expect(instantBuildPriceAt(278, 600_000, 0.1875)).toBe(521);
    expect(instantBuildPriceAt(313, 1_800_000, 24)).toBe(225_360);
    expect(instantBuildPriceAt(357, 333_000, h("houses_001_002").instantBuildFactor)).toBe(742); // single cast would give 743
  });
  it("move price: coins + time price * construction time * min(1,factor)", () => {
    expect(movePrice(rules, 1, bungalow)).toBe(6468);
    expect(movePrice(rules, 1, wonders.find((d) => d.sku === "wonder_statue_of_money")!)).toBe(40000);
  });
  it("demolish profit 35% of def value, terrain 100%", () => { expect(destroyProfit(rules, bungalow)).toBe(10500); expect(destroyTerrainProfit(rules, 1000)).toBe(1000); });
  it("early gold unlock: LIMITED visibility + segments + 65 cap", () => {
    expect(unlock(1, 2)).toBe(2);
    expect(unlock(1, 3)).toBe(0);
    expect(unlock(7, 10)).toBe(8);
    expect(unlock(10, 13)).toBe(11);
    expect(unlock(31, 41)).toBe(65);
  });
  it("expansion prices", () => {
    expect(expansionsValue(rules.expansionCash, 2, 60000)).toBe((29 + 39) * 60000);
    expect(rules.expansionCash.slice(0, 3)).toEqual([29, 39, 49]);
  });
  it("gold needed for missing coins rounds up", () => { expect(goldForCoins(100000, 60000)).toBe(2); expect(goldForCoins(120000, 60000)).toBe(2); expect(goldForCoins(120001, 60000)).toBe(3); });
  it("company value = coins + gold*k + buildings + terrain + expansions", () => {
    const v = computeCompanyValue({ coins: 380000, cash: 5, cashToCoins: 60000, items: [{ companyValue: 30000, contractCost: 90 }], terrainTiles: 4, terrainPrice: 1000, expansions: 0 });
    expect(v.total).toBe(380000 + 300000 + 30090 + 4000);
  });
  it("daily reward: dated coins scale with level, others do not", () => {
    expect(rewardGain({ sku: "reward_17", bonusType: "coins", value: "15000", group: 6, chances: 100, date: "18:05:2011" }, 10).coins).toBe(150000);
    expect(rewardGain({ sku: "reward_02", bonusType: "coins", value: "8000", group: 1, chances: 40, date: "" }, 10).coins).toBe(8000);
    expect(rewardGain({ sku: "reward_01", bonusType: "exp", value: "80", group: 1, chances: 20, date: "" }, 10).exp).toBe(80);
  });
});
