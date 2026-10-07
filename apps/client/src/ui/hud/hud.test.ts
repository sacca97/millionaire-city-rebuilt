import { describe, expect, it } from "vitest";
import { actionsFor } from "./actions";
import { cursorFor } from "./cursor";
import { parseNeighborList, rankNeighbors } from "./friends";
import { elapsed, infoKindFor } from "./infobox";
import { buttonForTool } from "./toolsbar";

const RENT = 1;
describe("cursorFor (Cursor.as / Tool.getDefaultCursorID)", () => {
  it("maps tools to cursor art", () => {
    expect(cursorFor({ kind: "destroy" }, null)).toBe("demolition");
    expect(cursorFor({ kind: "road" }, null)).toBe("road");
    expect(cursorFor({ kind: "terrain" }, null)).toBe("terrain");
    expect(cursorFor({ kind: "move", sid: "1" }, null)).toBe("move");
    expect(cursorFor({ kind: "build", sku: "x" }, null)).toBeNull();
    expect(cursorFor({ kind: "select" }, "collector")).toBe("collector");
    expect(cursorFor({ kind: "select" }, "contract")).toBe("contractSignator");
  });
  it("select tool shows contextual cursors over items", () => {
    expect(cursorFor({ kind: "select" }, null, { stateId: RENT, mode: 5 })).toBe("collect");
    expect(cursorFor({ kind: "select" }, null, { stateId: RENT, mode: 1 })).toBe("signContract");
    expect(cursorFor({ kind: "select" }, null, { stateId: RENT, mode: 7 })).toBe("abandoned");
    expect(cursorFor({ kind: "select" }, null, { stateId: RENT, mode: 4 })).toBeNull();
  });
});

describe("toolbar / info / actions logic", () => {
  it("selected button per tool", () => {
    expect(buttonForTool({ kind: "select" })).toBe("select");
    expect(buttonForTool({ kind: "destroy" })).toBe("demolition");
    expect(buttonForTool({ kind: "build", sku: "a" })).toBeNull();
  });
  it("info box kind follows StateOnRent.doInfoBoxGetBox", () => {
    expect(infoKindFor({ stateId: 1, mode: 1, isCommerce: false })).toBe("wonder");
    expect(infoKindFor({ stateId: 1, mode: 7, isCommerce: false })).toBe("abandoned");
    expect(infoKindFor({ stateId: 1, mode: 4, isCommerce: false })).toBe("house");
    expect(infoKindFor({ stateId: 1, mode: 4, isCommerce: true })).toBe("commerce");
    expect(infoKindFor({ stateId: 0, mode: 1, isCommerce: false })).toBe("construction");
    expect(infoKindFor({ stateId: 1, mode: 3, isCommerce: false })).toBe("none");
  });
  it("fill bar elapsed time is clamped", () => {
    expect(elapsed(100, 30)).toBe(70);
    expect(elapsed(100, 150)).toBe(0);
  });
  it("context actions", () => {
    expect(actionsFor({ stateId: 1, mode: 1, isCommerce: false }, true)).toEqual(["contract", "move", "sell"]);
    expect(actionsFor({ stateId: 1, mode: 5, isCommerce: false }, false)).toEqual(["collect", "move"]);
  });
});

describe("friends bar data", () => {
  it("ranks by company value", () => {
    const r = rankNeighbors([
      { userId: "1", name: "a", exp: 0, companyValue: 5 },
      { userId: "2", name: "b", exp: 0, companyValue: 9 },
    ]);
    expect(r.map((n) => n.userId)).toEqual(["2", "1"]);
  });
  it("parses the neighbor list", () => {
    expect(parseNeighborList({ neighborList: [{ id: 7, xp: 10, companyValue: 99 }] })).toEqual([{ userId: "7", name: "Neighbor", exp: 10, companyValue: 99, photo: undefined }]);
    expect(parseNeighborList(undefined)).toEqual([]);
  });
});
