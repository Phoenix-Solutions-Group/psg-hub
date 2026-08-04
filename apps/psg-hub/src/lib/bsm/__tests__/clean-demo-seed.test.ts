import { describe, expect, it } from "vitest";

import {
  assertNoSupabaseError,
  CLEAN_DEMO_SEED,
  requiredDemoEnvNames,
  shouldSeedInternalRegressionUser,
} from "../../../../scripts/seed-superadmin-qa-env.mjs";

describe("clean BSM demo seed", () => {
  it("requires only the two visible demo accounts by default", () => {
    const env = {
      NODE_ENV: "test" as const,
      DEMO_OPERATOR_EMAIL: "admin@example.test",
      DEMO_OPERATOR_PASSWORD: "password",
      DEMO_SHOP_EMAIL: "shop@example.test",
      DEMO_SHOP_PASSWORD: "password",
    };

    expect(shouldSeedInternalRegressionUser(env)).toBe(false);
    expect(requiredDemoEnvNames(env)).toEqual([
      "DEMO_OPERATOR_EMAIL",
      "DEMO_OPERATOR_PASSWORD",
      "DEMO_SHOP_EMAIL",
      "DEMO_SHOP_PASSWORD",
    ]);
  });

  it("adds the regression-only internal account only when explicitly requested", () => {
    const env = {
      NODE_ENV: "test" as const,
      DEMO_INCLUDE_INTERNAL_REGRESSION_USER: "1",
    };

    expect(shouldSeedInternalRegressionUser(env)).toBe(true);
    expect(requiredDemoEnvNames(env)).toContain("DEMO_INTERNAL_EMAIL");
    expect(requiredDemoEnvNames(env)).toContain("DEMO_INTERNAL_PASSWORD");
  });

  it("uses board-demo names instead of older QA walkthrough names", () => {
    expect(CLEAN_DEMO_SEED.operatorDisplayName).toBe("BSM Demo Admin");
    expect(CLEAN_DEMO_SEED.shopUserDisplayName).toBe("BSM Demo User");
    expect(CLEAN_DEMO_SEED.shopName).toBe("Riverside Collision");
    expect(CLEAN_DEMO_SEED.riversideAnalytics).toEqual({
      organicTraffic: 184,
      organicKeywords: 57,
      authorityScore: 41,
      backlinks: 142,
    });
    expect(CLEAN_DEMO_SEED.directMail).toEqual({
      sends: 45,
      priorSent: 72,
      priorOutcomes: 11,
      segmentKey: "demo-riverside-direct-mail",
    });
    expect(CLEAN_DEMO_SEED.shopSlug).not.toBe(CLEAN_DEMO_SEED.previousShopSlug);
    expect(CLEAN_DEMO_SEED.shopSlug).not.toBe(CLEAN_DEMO_SEED.legacyShopSlug);
    expect(CLEAN_DEMO_SEED.shopSlug).not.toBe(CLEAN_DEMO_SEED.previousPilotShopSlug);
    expect(CLEAN_DEMO_SEED.shopName).not.toBe(CLEAN_DEMO_SEED.previousPilotShopName);
  });

  it("fails loudly when a Supabase cleanup call fails", () => {
    expect(() =>
      assertNoSupabaseError(
        { error: { message: "foreign key blocked delete" } },
        "Delete legacy demo rows"
      )
    ).toThrow("Delete legacy demo rows failed: foreign key blocked delete");
  });
});
