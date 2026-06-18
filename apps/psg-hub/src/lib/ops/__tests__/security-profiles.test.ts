import { describe, it, expect, vi } from "vitest";

// security-profiles.ts transitively imports ops-access.ts which is `server-only`
// and pulls in next/server + the supabase clients. Stub those module edges so
// the pure helpers can be exercised in the test env (mirrors ops-access.test).
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: () => ({}) } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

import {
  buildFunctionsJsonb,
  grantedFunctions,
  normalizeProfileName,
  canEditProfile,
} from "@/lib/ops/security-profiles";

describe("buildFunctionsJsonb", () => {
  it("maps known capability keys to true", () => {
    expect(buildFunctionsJsonb(["manage_companies", "manage_reports"])).toEqual({
      manage_companies: true,
      manage_reports: true,
    });
  });

  it("drops keys outside the canonical vocabulary (fail-closed)", () => {
    expect(buildFunctionsJsonb(["manage_companies", "is_admin", "drop_db"])).toEqual({
      manage_companies: true,
    });
  });

  it("returns an empty object for no selections", () => {
    expect(buildFunctionsJsonb([])).toEqual({});
  });
});

describe("grantedFunctions", () => {
  it("returns only canonical keys whose value is truthy", () => {
    expect(
      grantedFunctions({ manage_companies: true, manage_reports: false, bogus: true })
    ).toEqual(["manage_companies"]);
  });

  it("tolerates a null/empty jsonb", () => {
    expect(grantedFunctions({})).toEqual([]);
  });
});

describe("normalizeProfileName", () => {
  it("trims and accepts a valid name", () => {
    expect(normalizeProfileName("  Estimators  ")).toBe("Estimators");
  });

  it("rejects empty / whitespace-only / non-string", () => {
    expect(normalizeProfileName("   ")).toBeNull();
    expect(normalizeProfileName("")).toBeNull();
    expect(normalizeProfileName(42)).toBeNull();
    expect(normalizeProfileName(null)).toBeNull();
  });

  it("rejects names over 80 chars", () => {
    expect(normalizeProfileName("x".repeat(81))).toBeNull();
    expect(normalizeProfileName("x".repeat(80))).toBe("x".repeat(80));
  });
});

describe("canEditProfile", () => {
  it("blocks built-in profiles, allows custom ones", () => {
    expect(canEditProfile({ is_builtin: true })).toBe(false);
    expect(canEditProfile({ is_builtin: false })).toBe(true);
  });
});
