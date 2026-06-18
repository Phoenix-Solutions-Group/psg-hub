import { describe, it, expect } from "vitest";
import { classifyConsolidator, CONSOLIDATOR_BRANDS } from "../consolidators";

describe("classifyConsolidator", () => {
  it("matches a major consolidator and returns its canonical group", () => {
    expect(classifyConsolidator("Caliber Collision - Springfield")).toEqual({
      isConsolidator: true,
      group: "Caliber Collision",
    });
    expect(classifyConsolidator("GERBER COLLISION & GLASS")).toMatchObject({
      isConsolidator: true,
      group: "Gerber Collision & Glass",
    });
  });

  it("maps Service King onto Crash Champions (post-merger)", () => {
    expect(classifyConsolidator("Service King #1023").group).toBe("Crash Champions");
  });

  it("is case-insensitive", () => {
    expect(classifyConsolidator("carstar tony's auto body").isConsolidator).toBe(true);
  });

  it("does NOT false-positive an independent that merely sounds similar", () => {
    expect(classifyConsolidator("Classic Auto Body")).toEqual({
      isConsolidator: false,
      group: null,
    });
    expect(classifyConsolidator("Joe's Friendly Auto Repair").isConsolidator).toBe(false);
  });

  it("registry aliases are all lowercase (matching contract)", () => {
    for (const brand of CONSOLIDATOR_BRANDS) {
      for (const alias of brand.aliases) {
        expect(alias).toBe(alias.toLowerCase());
      }
    }
  });
});
