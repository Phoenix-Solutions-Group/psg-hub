import { describe, it, expect } from "vitest";
import { shouldShowUpgradeBanner } from "@/app/(dashboard)/billing/upgrade-banner";

describe("shouldShowUpgradeBanner", () => {
  it("returns 'hidden' when not returned from Stripe", () => {
    expect(
      shouldShowUpgradeBanner({
        searchParamSuccess: false,
        currentTier: "essentials",
        elapsedMs: 0,
      })
    ).toBe("hidden");
  });

  it("returns 'hidden' when already on Performance", () => {
    expect(
      shouldShowUpgradeBanner({
        searchParamSuccess: true,
        currentTier: "performance",
        elapsedMs: 1_000,
      })
    ).toBe("hidden");
  });

  it("returns 'processing' within the 60s grace window", () => {
    expect(
      shouldShowUpgradeBanner({
        searchParamSuccess: true,
        currentTier: "essentials",
        elapsedMs: 30_000,
      })
    ).toBe("processing");
  });

  it("returns 'timeout' after 60s", () => {
    expect(
      shouldShowUpgradeBanner({
        searchParamSuccess: true,
        currentTier: "essentials",
        elapsedMs: 70_000,
      })
    ).toBe("timeout");
  });

  it("treats null/undefined currentTier as non-Performance", () => {
    expect(
      shouldShowUpgradeBanner({
        searchParamSuccess: true,
        currentTier: null,
        elapsedMs: 1_000,
      })
    ).toBe("processing");
    expect(
      shouldShowUpgradeBanner({
        searchParamSuccess: true,
        currentTier: undefined,
        elapsedMs: 1_000,
      })
    ).toBe("processing");
  });
});
