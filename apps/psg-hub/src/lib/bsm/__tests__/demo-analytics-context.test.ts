import { describe, expect, it } from "vitest";

import {
  isRiversideDemoAnalyticsContext,
  isRiversideDemoShop,
  resolveDemoAnalyticsShopId,
  shouldUseRiversidePreviewDemoFallback,
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

  it("activates the preview fallback for the configured demo login when membership is stale", () => {
    expect(
      shouldUseRiversidePreviewDemoFallback({
        userEmail: " Demo-Shop@Example.Test ",
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: false,
        env: {
          DEMO_SHOP_EMAIL: "demo-shop@example.test",
          VERCEL_ENV: "preview",
        },
      })
    ).toBe(true);
  });

  it("does not activate the preview fallback for production, other users, or existing Riverside membership", () => {
    const env = {
      DEMO_SHOP_EMAIL: "demo-shop@example.test",
      VERCEL_ENV: "preview",
    };
    expect(
      shouldUseRiversidePreviewDemoFallback({
        userEmail: env.DEMO_SHOP_EMAIL,
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: false,
        env: { ...env, VERCEL_ENV: "production" },
      })
    ).toBe(false);
    expect(
      shouldUseRiversidePreviewDemoFallback({
        userEmail: "customer@example.test",
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: false,
        env,
      })
    ).toBe(false);
    expect(
      shouldUseRiversidePreviewDemoFallback({
        userEmail: env.DEMO_SHOP_EMAIL,
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: true,
        env,
      })
    ).toBe(false);
  });
});
