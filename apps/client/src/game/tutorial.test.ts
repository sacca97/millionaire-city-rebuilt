import { describe, expect, it } from "vitest";
import { DECORATION_SKU, HOUSE_SKU, HQ_SKU, STEP, TutorialMachine, inferResumeStep } from "./tutorial";

describe("TutorialMachine", () => {
  const drive = (m: TutorialMachine) => {
    m.start();
    m.ok();
    m.notify({ type: "hqPlaced" });
    m.ok();
    for (const t of m.terrainTiles) m.notify({ type: "terrainBought", x: t.x, y: t.y });
  };
  it("walks the forced steps in order", () => {
    const m = new TutorialMachine();
    m.start();
    expect(m.step).toBe(STEP.WELCOME);
    expect(m.okEnabled).toBe(true);
    m.ok();
    expect(m.step).toBe(STEP.HQ);
    expect(m.okEnabled).toBe(false);
    m.ok(); // ignored while the action is pending
    expect(m.step).toBe(STEP.HQ);
    m.notify({ type: "hqPlaced" });
    expect(m.okEnabled).toBe(true);
    m.ok();
    expect(m.step).toBe(STEP.PLOTS);
    expect(m.enabledButtons()).toEqual(["terrain"]);
    m.notify({ type: "terrainBought", x: m.terrainTiles[0].x, y: m.terrainTiles[0].y });
    expect(m.okEnabled).toBe(false);
    m.notify({ type: "terrainBought", x: m.terrainTiles[1].x, y: m.terrainTiles[1].y });
    expect(m.okEnabled).toBe(true);
  });
  it("restricts placements to the forced tiles", () => {
    const m = new TutorialMachine();
    m.start();
    m.ok();
    expect(m.checkBuild(HQ_SKU, m.hq.x, m.hq.y)?.ok).toBe(true);
    expect(m.checkBuild(HQ_SKU, m.hq.x + 1, m.hq.y)?.ok).toBe(false);
    expect(m.snapBuild(HQ_SKU, m.hq.x + 1, m.hq.y - 1)).toEqual(m.hq);
    expect(m.allowTool({ kind: "road" })).toBe(false);
    expect(m.allowTool({ kind: "select" })).toBe(true);
  });
  it("ignores events of other steps and ends after the final popup", () => {
    const m = new TutorialMachine();
    drive(m);
    m.notify({ type: "rentCollected" });
    expect(m.step).toBe(STEP.PLOTS);
    m.ok();
    expect(m.allowTool({ kind: "build", sku: HOUSE_SKU })).toBe(true);
    expect(m.shopBuyAllowed(HOUSE_SKU)).toBe(true);
    expect(m.shopBuyAllowed(DECORATION_SKU)).toBe(false);
    expect(m.shopTabAllowed(2)).toBe(false);
    const e = new TutorialMachine(STEP.END);
    e.start();
    e.ok();
    expect(e.ended).toBe(true);
    expect(e.pollsEnabled).toBe(true);
    expect(e.allowTool({ kind: "road" })).toBe(true);
  });
  it("infers the resume step", () => {
    const base = { hasHq: true, plotsBought: true, roadsBuilt: true, decorationPlaced: false };
    expect(inferResumeStep({ ...base, hasHq: false, plotsBought: false, roadsBuilt: false })).toBe(STEP.WELCOME);
    expect(inferResumeStep({ ...base, plotsBought: false, roadsBuilt: false })).toBe(STEP.PLOTS);
    expect(inferResumeStep({ ...base, roadsBuilt: false })).toBe(STEP.BUILD_HOUSE);
    expect(inferResumeStep({ ...base, house: { construction: true, waitingContract: false, renting: false } })).toBe(STEP.INSTANT_BUILD);
    expect(inferResumeStep({ ...base, house: { construction: false, waitingContract: true, renting: false } })).toBe(STEP.SIGN_CONTRACT);
    expect(inferResumeStep({ ...base, house: { construction: false, waitingContract: false, renting: true } })).toBe(STEP.BUILD_DECORATION);
  });
});
