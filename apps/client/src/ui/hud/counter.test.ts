import { describe, expect, it } from "vitest";
import { Counter } from "./counter";

describe("Counter", () => {
  it("jumps without animation", () => {
    const c = new Counter(5);
    c.set(100, false);
    expect(c.value).toBe(100);
    expect(c.running).toBe(false);
  });
  it("runs towards the target within the duration", () => {
    const c = new Counter(0);
    c.set(1000);
    c.tick(250);
    expect(c.value).toBe(500);
    c.tick(250);
    expect(c.value).toBe(1000);
    expect(c.tick(16)).toBe(false);
  });
  it("counts down and retargets from the shown value", () => {
    const c = new Counter(1000);
    c.set(0);
    c.tick(250);
    expect(c.value).toBe(500);
    c.set(500);
    c.tick(500);
    expect(c.value).toBe(500);
  });
});
