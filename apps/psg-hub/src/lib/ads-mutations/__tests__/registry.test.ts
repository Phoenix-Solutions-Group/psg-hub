import { describe, it, expect } from "vitest";
import {
  MUTATION_REGISTRY,
  getMutation,
  requiresSuperadminApproval,
  mutationsForPlatform,
} from "@/lib/ads-mutations/registry";

describe("MUTATION_REGISTRY", () => {
  it("is non-empty and covers both platforms", () => {
    expect(MUTATION_REGISTRY.length).toBeGreaterThan(0);
    expect(mutationsForPlatform("google_ads").length).toBeGreaterThan(0);
    expect(mutationsForPlatform("gtm").length).toBeGreaterThan(0);
  });

  it("has unique keys", () => {
    const keys = MUTATION_REGISTRY.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("requires a target on every mutation (customer-id / container-id governance)", () => {
    for (const m of MUTATION_REGISTRY) {
      expect(m.target.required).toBe(true);
      expect(m.target.param.length).toBeGreaterThan(0);
      // Google Ads ops key on customer id; GTM ops key on container id.
      if (m.platform === "google_ads") {
        expect(m.target.kind).toBe("google_ads_customer_id");
      } else {
        expect(m.target.kind).toBe("gtm_container_id");
      }
    }
  });

  it("classifies every mutation with a valid risk level", () => {
    for (const m of MUTATION_REGISTRY) {
      expect(["low", "medium", "high"]).toContain(m.riskLevel);
    }
  });

  it("maps every mutation to a Python module + apply fn", () => {
    for (const m of MUTATION_REGISTRY) {
      expect(m.pythonModule).toMatch(/^(googleads_psg|gtm_psg)\./);
      expect(m.applyFn.length).toBeGreaterThan(0);
    }
  });

  it("flags high-risk mutations (and only those) for superadmin approval", () => {
    for (const m of MUTATION_REGISTRY) {
      expect(requiresSuperadminApproval(m)).toBe(m.riskLevel === "high");
    }
    // bidding / network / GTM publish are unambiguously high-risk.
    expect(requiresSuperadminApproval(getMutation("google_ads.campaign_bidding")!)).toBe(true);
    expect(requiresSuperadminApproval(getMutation("gtm.publish_version")!)).toBe(true);
    // negative keywords are restrictive-only — low risk.
    expect(requiresSuperadminApproval(getMutation("google_ads.negative_keywords")!)).toBe(false);
  });

  it("getMutation returns undefined for unknown keys", () => {
    expect(getMutation("nope.nope")).toBeUndefined();
  });
});
