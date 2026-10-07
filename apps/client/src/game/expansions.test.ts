import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Expansions, parseExpansions, parsePlotStates } from "./expansions";
import { parseLogicTiles } from "./world";

const RULES = new URL("../../../../assets/dchoc1-a.akamaihd.net/0.501/mcity/Datas/rules/", import.meta.url);
const read = (f: string): string => readFileSync(new URL(f, RULES), "utf8");

describe("expansions", () => {
  const defs = parseExpansions(read("expansions.xml"));

  it("parses 25 plots", () => {
    expect(defs).toHaveLength(25);
    expect(defs[12].composition).toEqual([14, 15, 20, 21]);
  });

  it("owns only the centre plot by default", () => {
    const ex = new Expansions(defs, parsePlotStates("", defs));
    expect(ex.isMine(45, 30)).toBe(true);
    expect(ex.isMine(30, 20)).toBe(true);
    expect(ex.isMine(59, 39)).toBe(true);
    expect(ex.isMine(60, 30)).toBe(false);
    expect(ex.isMine(0, 0)).toBe(false);
    expect(ex.plotRect(12)).toEqual({ x: 30, y: 20, w: 30, h: 20 });
  });

  it("parses solid logic tiles", () => {
    const solid = parseLogicTiles(read("universe/map.xml"));
    expect(solid.length).toBeGreaterThan(100);
  });
});
