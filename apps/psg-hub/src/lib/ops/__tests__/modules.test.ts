import { describe, expect, it } from "vitest";
import {
  asAudience,
  asGrantEffect,
  asGrantRole,
  asTierFloor,
  asVisibility,
  normalizeDisplayName,
  normalizeModuleSlug,
  roleMatrixFor,
  targetedOverrideCount,
  type GrantRow,
} from "@/lib/ops/modules";

describe("normalizeModuleSlug", () => {
  it("lowercases, trims, and hyphenates whitespace", () => {
    expect(normalizeModuleSlug("  Ads Studio  ")).toBe("ads-studio");
  });
  it("accepts dots, underscores, hyphens", () => {
    expect(normalizeModuleSlug("ads_studio.v2-beta")).toBe("ads_studio.v2-beta");
  });
  it("rejects too-short, too-long, leading-symbol, and non-string", () => {
    expect(normalizeModuleSlug("a")).toBeNull();
    expect(normalizeModuleSlug("-leading")).toBeNull();
    expect(normalizeModuleSlug("x".repeat(61))).toBeNull();
    expect(normalizeModuleSlug(42)).toBeNull();
    expect(normalizeModuleSlug("has spaces!")).toBeNull(); // ! is illegal
  });
});

describe("normalizeDisplayName", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeDisplayName("  Ads   Studio ")).toBe("Ads Studio");
  });
  it("rejects empty and over-long", () => {
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("x".repeat(81))).toBeNull();
  });
});

describe("coercion helpers", () => {
  it("asAudience validates the vocabulary", () => {
    expect(asAudience("ops")).toBe("ops");
    expect(asAudience("nonsense")).toBeNull();
  });
  it("asTierFloor treats null/empty as a valid no-floor", () => {
    expect(asTierFloor(null)).toEqual({ ok: true, value: null });
    expect(asTierFloor("")).toEqual({ ok: true, value: null });
    expect(asTierFloor("growth")).toEqual({ ok: true, value: "growth" });
    expect(asTierFloor("platinum")).toEqual({ ok: false });
  });
  it("asVisibility / asGrantRole / asGrantEffect validate", () => {
    expect(asVisibility("hidden")).toBe("hidden");
    expect(asVisibility("invisible")).toBeNull();
    expect(asGrantRole("psg_superadmin")).toBe("psg_superadmin");
    expect(asGrantRole("root")).toBeNull();
    expect(asGrantEffect("deny")).toBe("deny");
    expect(asGrantEffect("maybe")).toBeNull();
  });
});

describe("roleMatrixFor", () => {
  const moduleId = "m1";
  const grants: GrantRow[] = [
    { id: "g1", module_id: "m1", profile_id: null, shop_id: null, role: "customer", effect: "deny" },
    { id: "g2", module_id: "m1", profile_id: null, shop_id: null, role: "psg_internal", effect: "allow" },
    // profile-scope grant on the same module — must NOT appear in the role grid
    { id: "g3", module_id: "m1", profile_id: "p1", shop_id: null, role: null, effect: "allow" },
    // grant on a different module — ignored
    { id: "g4", module_id: "m2", profile_id: null, shop_id: null, role: "customer", effect: "allow" },
  ];

  it("maps role grants and leaves others inheriting", () => {
    expect(roleMatrixFor(moduleId, grants)).toEqual({
      customer: "deny",
      psg_internal: "allow",
      psg_superadmin: "inherit",
    });
  });

  it("counts only profile/shop overrides for the module", () => {
    expect(targetedOverrideCount("m1", grants)).toBe(1);
    expect(targetedOverrideCount("m2", grants)).toBe(0);
  });
});
