import { describe, expect, it } from "vitest";

import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  shouldUseRiversideAnalyticsPreviewFallback,
} from "@/lib/bsm/riverside-analytics-demo";

const previewEnv = {
  DEMO_SHOP_EMAIL: "demo-shop@example.test",
  VERCEL_ENV: "preview",
};

describe("Riverside Analytics preview demo fallback", () => {
  it("activates for the configured preview demo shop login when Riverside is missing", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: " Demo-Shop@Example.Test ",
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: false,
        env: previewEnv,
      })
    ).toBe(true);
  });

  it("does not activate outside Vercel previews", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: previewEnv.DEMO_SHOP_EMAIL,
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: false,
        env: { ...previewEnv, VERCEL_ENV: "production" },
      })
    ).toBe(false);
  });

  it("does not activate for other users or when Riverside is already selected", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: "customer@example.test",
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: false,
        env: previewEnv,
      })
    ).toBe(false);
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: previewEnv.DEMO_SHOP_EMAIL,
        activeShopName: RIVERSIDE_ANALYTICS_DEMO_SHOP.name,
        hasRiversideMembership: false,
        env: previewEnv,
      })
    ).toBe(false);
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: previewEnv.DEMO_SHOP_EMAIL,
        activeShopName: "Tedesco Auto Body",
        hasRiversideMembership: true,
        env: previewEnv,
      })
    ).toBe(false);
  });
});
