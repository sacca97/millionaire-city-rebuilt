import { describe, expect, it } from "vitest";
import type { CommandQueue } from "../net/session";
import { fetchText, loadDefsSync } from "../../test/helpers";
import { Expansions, parseExpansions, parsePlotStates } from "./expansions";
import { Game } from "./game";
import { loadGameRules } from "./rules";
import type { WorldState } from "../model/save";

// B5: a collectible group reward of type "hq" redraws the HQ at once (Map.launchHQSkinAnimation, Map.as:394-407), not after a reload.
describe("HQ skin reward", () => {
  it("setHqSkin updates the HQ's skin and tells the view to redraw it", async () => {
    const rules = await loadGameRules(fetchText);
    const state = {
      profile: { cityName: "", userName: "", exp: 0, coins: 0, cash: 0, raw: {}, missions: { up: [], reached: [], given: [] }, pollCounts: {} },
      mine: { sid: "1", whose: 1, coins: 0, items: [{ sid: "4", sku: "HeadQuarter", x: 10, y: 10, stateId: 4, state: { id: "4", mode: "0" }, suspended: false }] },
      companies: [],
      terrain: [],
      roads: []
    } as unknown as WorldState;
    state.companies = [state.mine!];
    const defs = parseExpansions(await fetchText("expansions.xml"));
    const game = new Game({
      conn: { now: () => Date.now(), loginSync: 0 },
      queue: { on: () => () => undefined, sendCommand: () => undefined } as unknown as CommandQueue,
      state,
      defs: loadDefsSync(),
      rules,
      expansions: new Expansions(defs, parsePlotStates(undefined, defs))
    });
    const seen: Array<{ sid: string; skin: string }> = [];
    game.on("item-skin", (e) => seen.push(e));
    game.setHqSkin("HeadQuarter_02");
    expect(game.item("4")!.placed.skin).toBe("HeadQuarter_02");
    expect(seen).toEqual([{ sid: "4", skin: "HeadQuarter_02" }]);
  });
});
