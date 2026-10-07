import { describe, expect, it } from "vitest";
import {
  constructionProgress,
  iconFrame,
  loopFrameIndex,
  regla3,
  rentingFrame,
  resolveVisual,
  RENT_MODE,
  STATE_ID,
  type VisualContext
} from "./animation";

const ctx: VisualContext = {
  isAnimated: false,
  isClub: false,
  hasBuildingClip: false,
  hasNormal2Clip: false,
  constructionMs: 600000,
  incomeMs: 3000
};

describe("animation logic", () => {
  it("regla3 truncates", () => {
    expect(regla3(2, 3, 3)).toBe(2);
    expect(regla3(1, 3, 3)).toBe(1);
    expect(regla3(1, 4, 3)).toBe(0);
  });
  it("renting frame advances 1..3 as time runs out", () => {
    expect(rentingFrame(3000, 3000)).toBe(1);
    expect(rentingFrame(2500, 3000)).toBe(1);
    expect(rentingFrame(1500, 3000)).toBe(2);
    expect(rentingFrame(500, 3000)).toBe(3);
    expect(rentingFrame(0, 3000)).toBe(3);
    expect(rentingFrame(100, 0)).toBe(1);
  });
  it("construction progress is clamped", () => {
    expect(constructionProgress(300, 600)).toBe(0.5);
    expect(constructionProgress(900, 600)).toBe(0);
    expect(constructionProgress(0, 600)).toBe(1);
  });
  it("loop index wraps", () => {
    expect(loopFrameIndex(0, 12, 4)).toBe(0);
    expect(loopFrameIndex(84, 12, 4)).toBe(1);
    expect(loopFrameIndex(1000, 12, 4)).toBe(0);
    expect(loopFrameIndex(500, 12, 1)).toBe(0);
  });
  it("icon follows 0,1,2,3,2,1", () => {
    const at = (ms: number) => iconFrame(ms);
    expect([0, 150, 280, 410, 560, 690, 820].map(at)).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
  it("resolves visuals per state", () => {
    expect(resolveVisual({ stateId: STATE_ID.CONSTRUCTION, mode: 0, time: 300000 }, ctx).clip).toBe("generic");
    expect(resolveVisual({ stateId: STATE_ID.CONSTRUCTION, mode: 0, time: 300000 }, { ...ctx, hasBuildingClip: true }).clip).toBe("building");
    expect(resolveVisual({ stateId: STATE_ID.CONSTRUCTION, mode: 0, time: 0 }, ctx).clip).toBe("normal");
    const wait = resolveVisual({ stateId: STATE_ID.RENT, mode: RENT_MODE.WAITING_FOR_CONTRACT, time: 0 }, ctx);
    expect(wait).toMatchObject({ clip: "normal", frame: 1, icon: "contract" });
    expect(resolveVisual({ stateId: STATE_ID.RENT, mode: RENT_MODE.GET_RENT, time: 0 }, ctx)).toMatchObject({ frame: 4, icon: "rent" });
    expect(resolveVisual({ stateId: STATE_ID.RENT, mode: RENT_MODE.GET_RENT, time: 0 }, ctx, true).icon).toBe("commerce");
    expect(resolveVisual({ stateId: STATE_ID.BUILT, mode: 0, time: 0 }, { ...ctx, isAnimated: true }).frame).toBe("loop");
    expect(resolveVisual({ stateId: STATE_ID.BUILT, mode: 0, time: 0 }, ctx).frame).toBe(1);
  });
});
