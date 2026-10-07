import { describe, expect, it } from "vitest";
import { cursorToFootprint, snapToTile } from "./placement";

describe("placement snapping", () => {
  it("rounds up past half a tile", () => {
    expect(snapToTile(0)).toBe(0);
    expect(snapToTile(16)).toBe(0);
    expect(snapToTile(17)).toBe(1);
    expect(snapToTile(33)).toBe(1);
    expect(snapToTile(-1)).toBe(-1 + 0 + (31 > 16 ? 1 : 0));
  });

  it("centres a 2x2 item on the cursor", () => {
    expect(cursorToFootprint(64, 64, 2, 2)).toEqual({ x: 1, y: 1 });
    expect(cursorToFootprint(100, 100, 3, 3)).toEqual({ x: 2, y: 2 });
  });
});
