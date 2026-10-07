import { describe, expect, it } from "vitest";
import { advanceItem, type ItemRuntime } from "./simulation";
import { parseGameRules, contractsForDef, destroyProfit, movePrice, levelOf, terrainPrice } from "./rules";
import { RENT_MODE, STATE_ID } from "../net/commands";
import { fetchText, loadDefsSync } from "../../test/helpers";

const rules = parseGameRules({
  xpTable: await fetchText("XPTable.xml"),
  contracts: await fetchText("contracts.xml"),
  contractTypes: await fetchText("contractsTypes.xml"),
  settings: await fetchText("settings.xml")
});
const defs = loadDefsSync();

const rt = (over: Partial<ItemRuntime>): ItemRuntime => ({ sid: "1", sku: "houses_001_001", stateId: 0, mode: 2, time: 1000, incomeMs: 0, isCommerce: false, ...over });

describe("advanceItem", () => {
  it("counts down construction then reports completion once", () => {
    const i = rt({});
    expect(advanceItem(i, 400, rules)).toEqual([]);
    expect(i.time).toBe(600);
    const t = advanceItem(i, 700, rules);
    expect(t.map((x) => x.type)).toEqual(["constructionDone"]);
    expect(i).toMatchObject({ stateId: STATE_ID.RENT, mode: RENT_MODE.WAITING_FOR_CONTRACT, time: 0 });
  });

  it("cascades renting -> collectable -> abandoned with the abandon time", () => {
    const i = rt({ stateId: 1, mode: RENT_MODE.RENTING, time: 180000, incomeMs: 180000 });
    const t = advanceItem(i, 180000 + 10, rules);
    expect(t.map((x) => x.type)).toEqual(["rentReady"]);
    expect(i.mode).toBe(RENT_MODE.GET_RENT);
    expect(i.time).toBe(3600000 - 10); // max(100% of income time, abandonMinTime 60 min)
    expect(advanceItem(i, 3600000, rules).map((x) => x.type)).toEqual(["abandoned"]);
    expect(i.mode).toBe(RENT_MODE.ABANDONED);
  });

  it("commerce restarts renting instead of becoming collectable (no influence simulated)", () => {
    const i = rt({ stateId: 1, mode: RENT_MODE.RENTING, time: 100, incomeMs: 1000, isCommerce: true });
    expect(advanceItem(i, 150, rules)).toEqual([]);
    expect(i.mode).toBe(RENT_MODE.RENTING);
  });
});

describe("economy rules", () => {
  const h = defs.get("houses_001_001")!.rules;
  it("levels, terrain price, sell price, contracts", () => {
    expect(levelOf(rules, 0)).toBe(1);
    expect(levelOf(rules, 470)).toBe(2);
    expect(terrainPrice(rules, 1)).toBe(1000);
    expect(destroyProfit(rules, h)).toBe(10500);
    expect(contractsForDef(rules, h)[0]).toMatchObject({ sku: "1", name: "Family", costCoins: 90, incomeCoins: 350 });
    expect(movePrice(rules, 1, h)).toBe(6000 + Math.trunc(250 * 10 * 0.1875));
  });
});

describe("advanceItem with the economy environment", () => {
  const commerce = (over: Partial<ItemRuntime> = {}): ItemRuntime => rt({ sku: "commerce_pizza", stateId: 1, mode: RENT_MODE.RENTING, time: 1000, incomeMs: 180000, isCommerce: true, ...over });

  it("commerce construction ends directly in renting with the definition income time", () => {
    const i = commerce({ stateId: 0, mode: 2, time: 500 });
    const t = advanceItem(i, 600, rules);
    expect(t.map((x) => x.type)).toEqual(["constructionDone"]);
    expect(i).toMatchObject({ stateId: STATE_ID.RENT, mode: RENT_MODE.RENTING, time: 180000 - 100 }); // the 100 ms left over already count
  });

  it("wonders end construction in the built state (5)", () => {
    const i = rt({ sku: "wonder_pyramid", isWonder: true, time: 100 });
    advanceItem(i, 200, rules);
    expect(i).toMatchObject({ stateId: STATE_ID.BUILT });
  });

  it("commerce with population becomes collectable and waits (never abandoned); losing the population restarts renting", () => {
    const i = commerce();
    const env = { population: () => 30 };
    expect(advanceItem(i, 1500, rules, env).map((x) => x.type)).toEqual(["rentReady"]);
    expect(i).toMatchObject({ mode: RENT_MODE.GET_RENT, time: 0 });
    expect(advanceItem(i, 10 * 3600_000, rules, env)).toEqual([]); // no abandonment
    expect(i.mode).toBe(RENT_MODE.GET_RENT);
    const t = advanceItem(i, 16, rules, { population: () => 0 });
    expect(t.map((x) => x.type)).toEqual(["rentRestarted"]);
    expect(i).toMatchObject({ mode: RENT_MODE.RENTING, time: 180000 });
  });

  it("commerce without population just restarts its renting cycle (no transition)", () => {
    const i = commerce({ time: 100 });
    expect(advanceItem(i, 150, rules, { population: () => 0 })).toEqual([]);
    expect(i).toMatchObject({ mode: RENT_MODE.RENTING, time: 180000 - 50 });
  });

  it("clubs are abandoned when their population vanishes; suspended items do not run", () => {
    const club = rt({ sku: "club_001", isClub: true, stateId: 1, mode: RENT_MODE.GET_RENT, time: 5000, incomeMs: 3_600_000 });
    expect(advanceItem(club, 1, rules, { population: () => 0 }).map((x) => x.type)).toEqual(["abandoned"]);
    const frozen = rt({ stateId: 0, mode: 2, time: 1000, suspended: true });
    expect(advanceItem(frozen, 5000, rules)).toEqual([]);
    expect(frozen.time).toBe(1000);
  });
});
