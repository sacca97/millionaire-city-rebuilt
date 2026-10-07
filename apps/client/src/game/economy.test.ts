import { describe, expect, it } from "vitest";
import {
  Economy,
  acceleratedTime,
  attributeValue,
  canBeAccelerated,
  commerceRent,
  computeCompanyValue,
  expansionsValue,
  initialStateKind,
  itemTypeOf,
  parseExpansionPrices,
  wonderAttributes,
  withDoubleRent,
  type EconomyItem
} from "./economy";
import { parseGameRules } from "./rules";
import { MAP_COLS } from "./geometry";
import { RENT_MODE, STATE_ID } from "../net/commands";
import { fetchText, loadDefsSync } from "../../test/helpers";

const rules = parseGameRules({
  xpTable: await fetchText("XPTable.xml"),
  contracts: await fetchText("contracts.xml"),
  contractTypes: await fetchText("contractsTypes.xml"),
  settings: await fetchText("settings.xml"),
  expansionsPrices: await fetchText("expansionsPrices.xml"),
  crew: await fetchText("crewMechanicsDefinition.xml")
});
const defs = loadDefsSync();

let sidN = 0;
function item(sku: string, x: number, y: number, over: Partial<EconomyItem> = {}): EconomyItem {
  const def = defs.get(sku)!;
  return { sid: String(++sidN), sku, stateId: STATE_ID.RENT, mode: RENT_MODE.RENTING, time: 0, incomeMs: 0, contractSku: undefined, tileX: x, tileY: y, cols: def.cols, rows: def.rows, def, ...over };
}
const roadsAlong = (x0: number, x1: number, y: number): Set<number> => new Set(Array.from({ length: x1 - x0 + 1 }, (_, i) => y * MAP_COLS + x0 + i));

describe("pure income formulas (ItemObject.getIncomeValue)", () => {
  it("commerce = coins * population, + influence percent, + incomeLevelFactor * population (uint truncation each step)", () => {
    expect(commerceRent(40, 10, 0, 0)).toBe(400);
    expect(commerceRent(40, 10, 15, 0)).toBe(460); // 400 + 400*15/100
    expect(commerceRent(87, 25, 0, 0.5)).toBe(2175 + 12); // club: 87.5 truncated, +0.5*25 = 12.5 -> 12
    expect(commerceRent(40, 0, 50, 0.5)).toBe(0); // no population: nothing, level factor needs v > 0
  });

  it("double rent multiplies by settings incomeMultiplier", () => {
    expect(rules.settings.incomeMultiplier).toBe(2);
    expect(withDoubleRent(100, rules.settings.incomeMultiplier, true)).toBe(200);
    expect(withDoubleRent(100, 2, false)).toBe(100);
  });

  it("accelerator removes percent of the contract time from the remaining time (StateOnRent.as:1822)", () => {
    expect(acceleratedTime(60_000, 100_000, 30)).toBe(30_000);
    expect(acceleratedTime(10_000, 100_000, 50)).toBe(0);
    const base = { stateId: 1, mode: RENT_MODE.RENTING, isCommerce: false, sku: "houses_001_001" };
    expect(canBeAccelerated(base)).toBe(true);
    expect(canBeAccelerated({ ...base, accelerated: true })).toBe(false);
    expect(canBeAccelerated({ ...base, mode: RENT_MODE.GET_RENT })).toBe(false);
    expect(canBeAccelerated({ ...base, isCommerce: true })).toBe(false);
    expect(canBeAccelerated({ ...base, sku: "HeadQuarter" })).toBe(false);
  });

  it("company value = coins + gold*k + sellable buildings (+contracts) + terrain + expansions", () => {
    const v = computeCompanyValue({ coins: 1000, cash: 2, cashToCoins: 60000, items: [{ companyValue: 500, contractCost: 90 }, { companyValue: 100, contractCost: 0 }], terrainTiles: 10, terrainPrice: 20, expansions: 300 });
    expect(v).toEqual({ coins: 1000, gold: 120000, buildings: 690, terrain: 500, total: 122190 });
    expect(parseExpansionPrices(`<E><Definition DCCash="29"/><Definition DCCash="39"/></E>`)).toEqual([29, 39]);
    expect(expansionsValue([29, 39], 1, 60000)).toBe(29 * 60000);
  });
});

describe("wonders", () => {
  it("sums influence incomeValue per target, attributesGetValue adds all + sku + type name", () => {
    const a = wonderAttributes([
      { subtype: "influence", target: "Houses", incomeValue: 5 },
      { subtype: "influence", target: "Houses", incomeValue: 2 },
      { subtype: "influence", target: "Commerces", incomeValue: 3 },
      { subtype: "incomeMultiplier", target: "Houses", incomeValue: 1 }
    ]);
    expect(attributeValue(a, "influence", { sku: "houses_001_001", type: 0 })).toBe(7);
    expect(attributeValue(a, "influence", { sku: "commerce_pizza", type: 1 })).toBe(3);
    expect(attributeValue(a, "influence", { sku: "decorations_tree_01", type: 2 })).toBe(0);
    expect(attributeValue(a, "incomeMultiplier", { sku: "houses_001_001", type: 0 })).toBe(1);
  });

  it("item types: wonders and clubs share the 'other' file and are told apart by sku", () => {
    expect(itemTypeOf(defs.get("wonder_statue_of_money")!.rules)).toBe(3);
    expect(itemTypeOf(defs.get("club_001")!.rules)).toBe(4);
    expect(itemTypeOf(defs.get("commerce_pizza")!.rules)).toBe(1);
    expect(itemTypeOf(defs.get("decorations_tree_01")!.rules)).toBe(2);
  });

  it("initial state (Role.doGetInitialItemState): decorations built, clubs hire crew, everything else constructs", () => {
    expect(initialStateKind(defs.get("decorations_tree_01")!.rules)).toBe("built");
    expect(initialStateKind(defs.get("club_001")!.rules, 3)).toBe("crew");
    expect(initialStateKind(defs.get("commerce_pizza")!.rules)).toBe("construction");
    expect(initialStateKind(defs.get("wonder_statue_of_money")!.rules)).toBe("construction");
    expect(initialStateKind(defs.get("HeadQuarter")!.rules)).toBe("headquarter");
  });
});

describe("Economy model", () => {
  function city(extra: EconomyItem[] = []) {
    const hq = item("HeadQuarter", 10, 10, { stateId: STATE_ID.HEADQUARTER, mode: 0 });
    const road = roadsAlong(10, 60, 13);
    const house = item("houses_001_001", 20, 14, { contractSku: 1 }); // 10 tenants?
    const items = [hq, house, ...extra];
    const eco = new Economy({ rules, defs, items: () => items, roads: () => road });
    return { eco, hq, house, items, road };
  }

  it("a house beside the connected road is connected; one far away is not and is reported disconnected", () => {
    const lone = item("houses_001_001", 40, 25);
    const { eco, house } = city([lone]);
    expect(eco.isConnected(house.sid)).toBe(true);
    expect(eco.isConnected(lone.sid)).toBe(false);
    expect([...eco.disconnectedSids()]).toEqual([lone.sid]);
  });

  it("commerce population counts the tenants of its renting houses and pays per house", () => {
    const shop = item("commerce_pizza", 22, 14, { mode: RENT_MODE.GET_RENT, incomeMs: 180000 });
    const { eco, house } = city([shop]);
    const tenants = defs.get("houses_001_001")!.rules.tenants;
    expect(tenants).toBeGreaterThan(0);
    expect(eco.population(shop.sid)).toBe(tenants);
    const pay = eco.commercePayout(shop);
    expect(pay.perHouse).toEqual([{ sid: house.sid, coins: defs.get("commerce_pizza")!.rules.incomeValue * tenants, xp: 0 }]);
    expect(pay.coins).toBe(eco.commerceInfoIncome(shop)); // single house: both paths agree
    // the house loses its contract -> no affected population
    house.contractSku = undefined;
    expect(eco.population(shop.sid)).toBe(0);
  });

  it("decorations raise the house influence and wonders add to every house/commerce", () => {
    const tree = item("decorations_tree_01", 22, 15, { stateId: STATE_ID.BUILT, mode: 0 });
    const { eco, house, items } = city([tree]);
    expect(eco.influencePercent(house.sid)).toBe(defs.get("decorations_tree_01")!.rules.influenceValue);
    const wonder = item("wonder_statue_of_money", 50, 14, { stateId: STATE_ID.BUILT, mode: 0 });
    items.push(wonder);
    eco.invalidate();
    const bonus = defs.get("wonder_statue_of_money")!.rules.incomeValue;
    expect(eco.influencePercent(house.sid)).toBe(defs.get("decorations_tree_01")!.rules.influenceValue + bonus);
  });

  it("a wonder that is not connected (suspended) gives nothing", () => {
    const wonder = item("wonder_statue_of_money", 40, 25, { stateId: STATE_ID.BUILT, mode: 0 });
    const { eco, house } = city([wonder]);
    expect(eco.influencePercent(house.sid)).toBe(0);
  });

  it("placement preview reports covered houses, the population of a commerce and the percent of a decoration", () => {
    const { eco, house } = city();
    const pizza = defs.get("commerce_pizza")!;
    const pv = eco.previewPlacement(pizza, 22, 14);
    expect(pv.houses).toEqual([house.sid]);
    expect(pv.population).toBe(defs.get("houses_001_001")!.rules.tenants);
    expect(pv.income).toBe(pizza.rules.incomeValue * pv.population);
    const tree = defs.get("decorations_tree_02")!;
    const pd = eco.previewPlacement(tree, 21, 12);
    expect(pd.housePercent).toBe(tree.rules.influenceValue);
    expect(eco.previewPlacement(pizza, 50, 25).population).toBe(0);
  });

  it("double rent flags are consumed by the owner type", () => {
    const { eco } = city();
    expect(eco.isDoubleRent("Houses")).toBe(false);
    eco.setDoubleRent("Houses");
    expect(eco.isDoubleRent("Houses")).toBe(true);
    expect(eco.isDoubleRent("Commerces")).toBe(false);
    eco.clearDoubleRent();
    expect(eco.isDoubleRent("Houses")).toBe(false);
  });
});
