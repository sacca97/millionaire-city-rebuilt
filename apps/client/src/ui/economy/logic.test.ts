import { describe, expect, it } from "vitest";
import { parseAcceleratorGifts, percentFromGiftType } from "./accelerator";
import { fetchText } from "../../../test/helpers";

describe("rent accelerator gifts (giftDefinitions.xml)", () => {
  it("maps the storage type to the fgift sku the server expects and the percent", async () => {
    const gifts = parseAcceleratorGifts(await fetchText("giftDefinitions.xml"));
    expect(gifts.get("rentAcc30")).toEqual({ giftSku: "fgift_018", percent: 30 });
    expect(gifts.get("rentAcc50")).toEqual({ giftSku: "fgift_022", percent: 50 });
    expect([...gifts.values()].every((g) => g.percent > 0)).toBe(true);
  });

  it("falls back to the digits of the gift type", () => {
    expect(percentFromGiftType("rentAcc30")).toBe(30);
    expect(percentFromGiftType("move")).toBe(0);
  });
});
