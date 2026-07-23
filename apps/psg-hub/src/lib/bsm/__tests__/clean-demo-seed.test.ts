import { describe, expect, it } from "vitest";

import {
  CLEAN_DEMO_SEED,
  requiredDemoEnvNames,
  shouldSeedInternalRegressionUser,
} from "../../../../scripts/seed-superadmin-qa-env.mjs";

describe("clean BSM demo seed", () => {
  it("requires only the two visible demo accounts by default", () => {
    const env = {
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
      DEMO_INCLUDE_INTERNAL_REGRESSION_USER: "1",
    };

    expect(shouldSeedInternalRegressionUser(env)).toBe(true);
    expect(requiredDemoEnvNames(env)).toContain("DEMO_INTERNAL_EMAIL");
    expect(requiredDemoEnvNames(env)).toContain("DEMO_INTERNAL_PASSWORD");
  });

  it("uses board-demo names instead of older QA walkthrough names", () => {
    expect(CLEAN_DEMO_SEED.operatorDisplayName).toBe("BSM Demo Admin");
    expect(CLEAN_DEMO_SEED.shopUserDisplayName).toBe("BSM Demo User");
    expect(CLEAN_DEMO_SEED.shopName).toBe("BSM Demo Collision Center");
    expect(CLEAN_DEMO_SEED.shopSlug).not.toBe(CLEAN_DEMO_SEED.legacyShopSlug);
  });
});
