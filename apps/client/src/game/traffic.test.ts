import { describe, expect, it } from "vitest";
import { TILE, TrafficSim, makeRng, roadSetFromRelative } from "./traffic";

const COLS = 20;
const ROWS = 20;
// 10x10 ring road
function ring(): Set<number> {
  const s = new Set<number>();
  for (let i = 2; i <= 11; i += 1) {
    for (const [x, y] of [[i, 2], [i, 11], [2, i], [11, i]]) s.add(y * COLS + x);
  }
  return s;
}

describe("traffic", () => {
  it("rng is deterministic", () => {
    const a = makeRng(7);
    const b = makeRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("relative coordinates map to tile indices", () => {
    expect(roadSetFromRelative([[0, 0]], 90, 60).roads.has(30 * 90 + 45)).toBe(true);
  });

  it("spawns on roads and stays on them, driving around a ring", () => {
    const sim = new TrafficSim({ cols: COLS, rows: ROWS, roads: ring() }, { seed: 3, plots: 5 });
    const roads = ring();
    let spawned = 0;
    for (let i = 0; i < 50 && spawned < 3; i += 1) if (sim.trySpawn()) spawned += 1;
    expect(spawned).toBeGreaterThan(0);
    for (let t = 0; t < 20000; t += 16) {
      sim.update(16);
      for (const a of sim.agents) {
        if (!a.enabled) continue;
        const tx = Math.floor(a.x / TILE);
        const ty = Math.floor(a.y / TILE);
        expect(roads.has(ty * COLS + tx), `agent at ${a.x},${a.y}`).toBe(true);
      }
    }
    expect(sim.agents.some((a) => a.enabled)).toBe(true);
  });

  it("same seed gives same trajectories", () => {
    const run = () => {
      const sim = new TrafficSim({ cols: COLS, rows: ROWS, roads: ring() }, { seed: 11 });
      for (let i = 0; i < 20; i += 1) sim.trySpawn();
      for (let t = 0; t < 5000; t += 16) sim.update(16);
      return sim.agents.map((a) => [a.x, a.y, a.rotation]);
    };
    expect(run()).toEqual(run());
  });

  it("dead-end agents fade out and free their slot", () => {
    const roads = new Set<number>([5 * COLS + 5, 5 * COLS + 6, 5 * COLS + 7]);
    const sim = new TrafficSim({ cols: COLS, rows: ROWS, roads }, { seed: 2 });
    sim.trySpawn() ?? sim.trySpawn();
    for (let i = 0; i < 20 && sim.agents.length === 0; i += 1) sim.trySpawn();
    for (let t = 0; t < 30000; t += 16) sim.update(16);
    expect(sim.agents.filter((a) => a.enabled && a.state === "ending").length).toBeLessThanOrEqual(1);
  });

  it("only owned-condition agents spawn when owned", () => {
    const sim = new TrafficSim({ cols: COLS, rows: ROWS, roads: ring() }, { seed: 5, owned: (s) => (s === "commerce_bank" ? 1 : 0) });
    for (let i = 0; i < 60; i += 1) sim.trySpawn();
    for (const a of sim.agents) expect(["car_01", "car_02", "car_03", "car_04", "car_05", "car_police"]).toContain(a.def.sku);
  });
});
