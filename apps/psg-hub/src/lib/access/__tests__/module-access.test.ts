import { describe, it, expect } from "vitest";
import {
  resolveModuleAccess,
  type ModuleAccessInput,
} from "@/lib/access/module-access";

const base = (over: Partial<ModuleAccessInput> = {}): ModuleAccessInput => ({
  module: { slug: "analytics", minTier: null, defaultVisibility: "visible" },
  grants: [],
  shopTier: "growth",
  isStaff: false,
  ...over,
});

describe("resolveModuleAccess — precedence", () => {
  it("profile grant beats shop and role grants", () => {
    expect(
      resolveModuleAccess(
        base({
          grants: [
            { scope: "role", effect: "allow" },
            { scope: "shop", effect: "allow" },
            { scope: "profile", effect: "deny" },
          ],
        })
      )
    ).toEqual({ visible: false, reason: "grant:profile" });
  });

  it("shop grant beats role grant when no profile grant", () => {
    expect(
      resolveModuleAccess(
        base({
          grants: [
            { scope: "role", effect: "deny" },
            { scope: "shop", effect: "allow" },
          ],
        })
      )
    ).toEqual({ visible: true, reason: "grant:shop" });
  });

  it("role grant applies when it is the only level present", () => {
    expect(
      resolveModuleAccess(base({ grants: [{ scope: "role", effect: "deny" }] }))
    ).toEqual({ visible: false, reason: "grant:role" });
  });

  it("deny beats allow at the same level", () => {
    expect(
      resolveModuleAccess(
        base({
          grants: [
            { scope: "shop", effect: "allow" },
            { scope: "shop", effect: "deny" },
          ],
        })
      )
    ).toEqual({ visible: false, reason: "grant:shop" });
  });
});

describe("resolveModuleAccess — tier floor + default", () => {
  it("hides a tier-gated module when the shop tier is below the floor", () => {
    expect(
      resolveModuleAccess(
        base({
          module: { slug: "ads", minTier: "performance", defaultVisibility: "visible" },
          shopTier: "growth",
        })
      )
    ).toEqual({ visible: false, reason: "tier:below-floor" });
  });

  it("shows a tier-gated module when the shop tier meets the floor", () => {
    expect(
      resolveModuleAccess(
        base({
          module: { slug: "ads", minTier: "growth", defaultVisibility: "visible" },
          shopTier: "performance",
        })
      )
    ).toEqual({ visible: true, reason: "default" });
  });

  it("staff bypass tier floors", () => {
    expect(
      resolveModuleAccess(
        base({
          module: { slug: "ads", minTier: "performance", defaultVisibility: "visible" },
          shopTier: null,
          isStaff: true,
        })
      )
    ).toEqual({ visible: true, reason: "default" });
  });

  it("an explicit grant overrides the tier floor", () => {
    expect(
      resolveModuleAccess(
        base({
          module: { slug: "ads", minTier: "performance", defaultVisibility: "visible" },
          shopTier: "essentials",
          grants: [{ scope: "shop", effect: "allow" }],
        })
      )
    ).toEqual({ visible: true, reason: "grant:shop" });
  });

  it("respects a hidden default with no grants and no tier floor", () => {
    expect(
      resolveModuleAccess(
        base({ module: { slug: "beta", minTier: null, defaultVisibility: "hidden" } })
      )
    ).toEqual({ visible: false, reason: "default" });
  });
});
