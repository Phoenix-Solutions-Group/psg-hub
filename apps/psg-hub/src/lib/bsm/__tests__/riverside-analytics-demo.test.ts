import { describe, expect, it } from "vitest";

import {
  RIVERSIDE_ANALYTICS_DEMO_SHOP,
  getRiversideAnalyticsPreviewShop,
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
        env: previewEnv,
      })
    ).toBe(true);
  });

  it("activates for the board-demo login when the preview env omits the demo email", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: " Test@PsgHub.Me ",
        activeShopName: "Tedesco Auto Body",
        env: { VERCEL_ENV: "preview" },
      })
    ).toBe(true);
  });

  it("activates for the default Riverside demo shop customer", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: " Owner@E2E.Test ",
        activeShopName: RIVERSIDE_ANALYTICS_DEMO_SHOP.name,
        requestHost: "hub.psgweb.me",
        env: { VERCEL_ENV: "production" },
      })
    ).toBe(true);
  });

  it("activates for Nick's board-review account in preview", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: " Nick@PhoenixSolutionsGroup.Net ",
        activeShopName: "Tedesco Auto Body",
        env: { VERCEL_ENV: "preview" },
      })
    ).toBe(true);
  });

  it("activates for Nick's board-review account without an active customer shop", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: " Nick@PhoenixSolutionsGroup.Net ",
        activeShopName: null,
        env: { VERCEL_ENV: "preview" },
      })
    ).toBe(true);
  });

  it("activates for extra configured reviewer emails in preview", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: "reviewer@example.test",
        activeShopName: "Tedesco Auto Body",
        env: {
          DEMO_REVIEWER_EMAILS: "reviewer@example.test, second@example.test",
          VERCEL_ENV: "preview",
        },
      })
    ).toBe(true);
  });

  it("activates on PSG Vercel preview hosts when VERCEL_ENV is unavailable", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: "test@psghub.me",
        activeShopName: "Tedesco Auto Body",
        requestHost: "psg-acephccxk-psg-digital.vercel.app",
        env: {},
      })
    ).toBe(true);
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: "test@psghub.me",
        activeShopName: "Tedesco Auto Body",
        env: { VERCEL_URL: "https://psg-acephccxk-psg-digital.vercel.app" },
      })
    ).toBe(true);
  });

  it("activates on the board demo host for configured demo reviewers", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: "nick@phoenixsolutionsgroup.net",
        activeShopName: "Tedesco Auto Body",
        requestHost: "hub.psgweb.me",
        env: { VERCEL_ENV: "production" },
      })
    ).toBe(true);
  });

  it("does not activate outside Vercel previews", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: "nick@phoenixsolutionsgroup.net",
        activeShopName: "Tedesco Auto Body",
        env: { ...previewEnv, VERCEL_ENV: "production" },
      })
    ).toBe(false);
  });

  it("does not activate for other users", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: "customer@example.test",
        activeShopName: "Tedesco Auto Body",
        env: previewEnv,
      })
    ).toBe(false);
  });

  it("still activates for preview reviewers when Riverside is already selected", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: previewEnv.DEMO_SHOP_EMAIL,
        activeShopName: RIVERSIDE_ANALYTICS_DEMO_SHOP.name,
        env: previewEnv,
      })
    ).toBe(true);
  });

  it("still activates when the preview user has a stale non-Riverside active shop", () => {
    expect(
      shouldUseRiversideAnalyticsPreviewFallback({
        userEmail: previewEnv.DEMO_SHOP_EMAIL,
        activeShopName: "Tedesco Auto Body",
        env: previewEnv,
      })
    ).toBe(true);
  });

  it("resolves the Riverside shop record for a preview reviewer", async () => {
    const service = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "shop_riverside",
                name: RIVERSIDE_ANALYTICS_DEMO_SHOP.name,
              },
            }),
          }),
        }),
      }),
    };

    await expect(
      getRiversideAnalyticsPreviewShop(service, {
        userEmail: "nick@phoenixsolutionsgroup.net",
        activeShopName: null,
        env: { VERCEL_ENV: "preview" },
      })
    ).resolves.toEqual({
      id: "shop_riverside",
      name: RIVERSIDE_ANALYTICS_DEMO_SHOP.name,
    });
  });

  it("does not look up Riverside outside the private preview path", async () => {
    const service = {
      from: () => {
        throw new Error("unexpected lookup");
      },
    };

    await expect(
      getRiversideAnalyticsPreviewShop(service, {
        userEmail: "nick@phoenixsolutionsgroup.net",
        activeShopName: null,
        env: { VERCEL_ENV: "production" },
      })
    ).resolves.toBeNull();
  });
});
