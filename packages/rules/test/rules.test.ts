import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseDefinitions, parseContracts, parseContractTypes, parseXpTable, parseSettings, levelForXp, xpForLevel,
  isBuildable, tileIsRoadable, getIncomeValue, getIncomeCoins, getIncomeTimeMs, settingsGetAbandonTime,
  getTimePrice, instantBuildPrice, constructionRemaining, rentPhase, accelerateIncomeTime,
  type MapState, type TileFlags
} from "../src/index.js";

const R = resolve(__dirname, "../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules");
const rd = (f: string) => readFileSync(resolve(R, f), "utf8");
const commerce = parseDefinitions(rd("commerceDefinitions.xml"), "commerce");
const houses = parseDefinitions(rd("itemDefinitions.xml"), "houses");
const decos = parseDefinitions(rd("decorationDefinitions.xml"), "decoration");
const bank = commerce.find((d) => d.sku === "commerce_bank")!;

function makeMap(cols: number, rows: number, patch: (x: number, y: number) => Partial<TileFlags> = () => ({})): MapState {
  return {
    cols, rows,
    tile: (x, y) => (x < 0 || y < 0 || x >= cols || y >= rows ? undefined :
      { buildable: true, road: false, solid: false, occupiedBy: null, terrain: true, ...patch(x, y) }),
    inAreaMine: (x, y) => x >= 0 && y >= 0 && x < cols && y < rows
  };
}

describe("definitions", () => {
  it("parses commerce_bank", () => {
    expect(bank).toMatchObject({ incomeValue: 75, baseCols: 3, baseRows: 3, level: 26, constructionCoins: 6000000, influenceRatio: 4 });
    expect(bank.constructionTimeMs).toBe(30 * 60_000);
    expect(bank.incomeTimeMs).toBe(3 * 60_000); // commerce minutes
  });
  it("house income time is hours, contract-based", () => {
    const b = houses.find((d) => d.sku === "houses_001_001")!;
    expect(b.incomeTimeMs).toBe(0.05 * 3_600_000);
    expect(b.tenants).toBe(3);
    expect(b.baseCols).toBe(2);
  });
  it("decorations", () => {
    const t = decos.find((d) => d.sku === "decorations_tree_01")!;
    expect(t.influenceValue).toBe(2);
    expect(t.kind).toBe("decoration");
  });
  it("xp table and levels", () => {
    const xp = parseXpTable(rd("XPTable.xml"));
    expect(levelForXp(xp, 0)).toBe(1);
    expect(levelForXp(xp, 469)).toBe(1);
    expect(levelForXp(xp, 470)).toBe(2);
    expect(xpForLevel(xp, 3)).toBe(1010);
  });
  it("settings", () => {
    const s = parseSettings(rd("settings.xml"));
    expect(s).toMatchObject({ incomeMultiplier: 2, abandonTimePercentage: 100, abandonMinTimeMs: 3_600_000, cashToCoins: 60000 });
  });
  it("contracts", () => {
    const c = parseContracts(rd("contracts.xml"));
    expect(c[0]).toMatchObject({ sku: "1", incomeCoins: 350, incomeXP: 1 });
    expect(c[0].incomeTimeMs).toBe(0.05 * 3_600_000);
    expect(parseContractTypes(rd("contractsTypes.xml")).get("13")![0]).toBe("109");
  });
});

describe("placement", () => {
  it("bank 3x3 fits on free map, not over a road/occupied tile or edge", () => {
    expect(isBuildable(makeMap(10, 10), 2, 2, bank)).toBe(true);
    expect(isBuildable(makeMap(10, 10), 8, 8, bank)).toBe(false);
    expect(isBuildable(makeMap(10, 10, (x, y) => (x === 3 && y === 3 ? { road: true } : {})), 2, 2, bank)).toBe(false);
    expect(isBuildable(makeMap(10, 10, (x, y) => (x === 3 && y === 3 ? { occupiedBy: "9" } : {})), 2, 2, bank)).toBe(false);
  });
  it("terrain requirement skipped for decorations and noNeedPlot", () => {
    const m = makeMap(10, 10, () => ({ terrain: false }));
    expect(isBuildable(m, 1, 1, bank)).toBe(false);
    expect(isBuildable(m, 1, 1, bank, { noNeedPlot: true })).toBe(true);
    expect(isBuildable(m, 1, 1, decos[0])).toBe(true);
  });
  it("move onto own tiles", () => {
    const m = makeMap(10, 10, (x, y) => (x < 3 && y < 3 ? { occupiedBy: "7" } : {}));
    expect(isBuildable(m, 0, 0, bank)).toBe(false);
    expect(isBuildable(m, 0, 0, bank, { movingSid: "7" })).toBe(true);
  });
  it("roadable", () => {
    expect(tileIsRoadable({ buildable: true, road: false, solid: false, occupiedBy: null, terrain: true })).toBe(true);
    expect(tileIsRoadable({ buildable: true, road: false, solid: false, occupiedBy: "1", terrain: true })).toBe(false);
    expect(tileIsRoadable({ buildable: true, road: false, solid: false, occupiedBy: "1", high: true, terrain: true })).toBe(true);
  });
});

describe("income", () => {
  const contracts = parseContracts(rd("contracts.xml"));
  it("bank income = 75 * population", () => {
    expect(getIncomeValue({ def: bank, affectedPopulation: 100 })).toBe(7500);
    expect(getIncomeValue({ def: bank, affectedPopulation: 100, influenceValue: 10 })).toBe(8250);
  });
  it("house income with contract", () => {
    const h = houses.find((d) => d.sku === "houses_001_001")!;
    const c = contracts[0];
    expect(getIncomeCoins(h, c)).toBe(350); // def incomeValue 0 (houses have none) + contract 350 (ItemObject.as:987)
    expect(getIncomeTimeMs(h, c)).toBe(c.incomeTimeMs);
    expect(getIncomeValue({ def: h, contract: null })).toBe(0);
  });
  it("abandon time and instant build", () => {
    const s = parseSettings(rd("settings.xml"));
    expect(settingsGetAbandonTime(10 * 60_000, s)).toBe(3_600_000);
    expect(settingsGetAbandonTime(5 * 3_600_000, s)).toBe(5 * 3_600_000);
    const xp = parseXpTable(rd("XPTable.xml"));
    expect(getTimePrice(xp)).toBe(xp[xp.length - 1].timePrice);
    expect(instantBuildPrice(bank, xp)).toBeCloseTo(getTimePrice(xp) * 30 * 24);
  });
});

describe("timers", () => {
  it("construction", () => {
    expect(constructionRemaining(bank.constructionTimeMs, 10 * 60_000)).toBe(20 * 60_000);
    expect(constructionRemaining(bank.constructionTimeMs, 99 * 60_000)).toBe(0);
  });
  it("rent phases", () => {
    expect(rentPhase(10, 100, 50, false)).toBe("renting");
    expect(rentPhase(100, 100, 50, false)).toBe("collectable");
    expect(rentPhase(150, 100, 50, false)).toBe("abandoned");
    expect(rentPhase(1e9, 100, 50, true)).toBe("collectable");
    expect(accelerateIncomeTime(100, 100, 30)).toBe(70);
  });
});
