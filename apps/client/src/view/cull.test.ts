import { describe, expect, it } from "vitest";
import { intersects, unionBoxes, worldViewRect } from "./cull";

describe("cull", () => {
  it("worldViewRect inverts the camera transform", () => {
    const r = worldViewRect(-100, -50, 2, 800, 600, 10);
    expect(r).toEqual({ left: 40, top: 15, right: 460, bottom: 335 });
  });
  it("intersects is inclusive and rejects disjoint boxes", () => {
    const r = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(intersects(r, 100, 100, 200, 200)).toBe(true);
    expect(intersects(r, 101, 0, 200, 50)).toBe(false);
    expect(intersects(r, -50, -50, -1, 10)).toBe(false);
    expect(intersects(r, -50, 20, 10, 30)).toBe(true);
  });
  it("unionBoxes", () => {
    expect(unionBoxes([])).toBeUndefined();
    expect(unionBoxes([[0, 0, 1, 1], [-2, 3, 0, 9]])).toEqual([-2, 0, 1, 9]);
  });
});
