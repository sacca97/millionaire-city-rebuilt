import { describe, expect, it } from "vitest";
import { parseWorld } from "./save";

describe("parseWorld", () => {
  it("decodes the XML-escaped city name the server sends (the original's XML parser does)", () => {
    const world = parseWorld({ universe: [{ Profile: [], cityname: "Sheik&apos;s City &amp; Co", userName: "Sheik" }] } as never);
    expect(world.profile.cityName).toBe("Sheik's City & Co");
  });
});
