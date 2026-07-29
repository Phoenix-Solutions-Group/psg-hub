import { describe, expect, it } from "vitest";

import {
  isRiversideDemoAnalyticsContext,
  isRiversideDemoShop,
  resolveDemoAnalyticsShopId,
} from "@/lib/bsm/demo-analytics-context";

const shops = [
  { id: "pilot", name: "PSG Pilot Body Shop" },
  { id: "riverside", name: "Riverside Collision" },
];

describe("Riverside demo analytics context", () => {
  it("matches Riverside by the board-demo shop name", () => {
    expect(isRiversideDemoShop({ name: "Riverside Collision" })).toBe(true);
    expect(isRiversideDemoShop({ name: "  Riverside Collision  " })).toBe(true);
    expect(isRiversideDemoShop({ name: "PSG Pilot Body Shop" })).toBe(false);
  });

  it("selects Riverside for the single-shop Analytics demo view", () => {
    expect(
      resolveDemoAnalyticsShopId({
        shops,
        activeShopId: "pilot",
        scopeAll: false,
      })
    ).toBe("riverside");
  });

  it("does not override the all-shops Analytics view", () => {
    expect(
      resolveDemoAnalyticsShopId({
        shops,
        activeShopId: "pilot",
        scopeAll: true,
      })
    ).toBe("pilot");
  });

  it("identifies the Riverside context that hides Google connection actions", () => {
    expect(
      isRiversideDemoAnalyticsContext({
        shops,
        activeShopId: "riverside",
        scopeAll: false,
      })
    ).toBe(true);
    expect(
      isRiversideDemoAnalyticsContext({
        shops,
        activeShopId: "pilot",
        scopeAll: false,
      })
    ).toBe(false);
  });
});
