import { describe, it, expect, vi } from "vitest";

// Mutable mock state (names must start with `mock` to satisfy vi.mock hoisting).
let mockRoleRow: { role: string } | null = null;
let mockLegacyRow: { functions_jsonb: Record<string, unknown> } | null = null;
let mockAssignmentRows: Array<Record<string, unknown>> = [];

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: () => ({}) } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "app_user_roles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockRoleRow }) }) }),
        };
      }
      if (table === "security_profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockLegacyRow }) }) }),
        };
      }
      // user_security_profile_assignments
      return { select: () => ({ eq: () => Promise.resolve({ data: mockAssignmentRows }) }) };
    },
  }),
}));

import { hasOpsFn, isOpsStaff, getOpsAccess, type OpsAccess } from "@/lib/auth/ops-access";

const access = (role: OpsAccess["role"], fns: string[] = []): OpsAccess => ({
  role,
  functions: new Set(fns),
});

describe("hasOpsFn", () => {
  it("psg_superadmin passes every capability with no explicit grants", () => {
    expect(hasOpsFn(access("psg_superadmin"), "manage_companies")).toBe(true);
    expect(hasOpsFn(access("psg_superadmin"), "manage_production")).toBe(true);
  });

  it("psg_internal passes only granted capabilities", () => {
    const a = access("psg_internal", ["manage_companies"]);
    expect(hasOpsFn(a, "manage_companies")).toBe(true);
    expect(hasOpsFn(a, "manage_sysconfig")).toBe(false);
  });

  it("customer fails closed even with a stray grant", () => {
    expect(hasOpsFn(access("customer", ["manage_companies"]), "manage_companies")).toBe(false);
  });

  it("null role fails closed", () => {
    expect(hasOpsFn(access(null), "manage_companies")).toBe(false);
  });
});

describe("isOpsStaff", () => {
  it("is true for internal and superadmin only", () => {
    expect(isOpsStaff("psg_internal")).toBe(true);
    expect(isOpsStaff("psg_superadmin")).toBe(true);
    expect(isOpsStaff("customer")).toBe(false);
    expect(isOpsStaff(null)).toBe(false);
  });
});

describe("getOpsAccess", () => {
  it("unions legacy per-user grants with assigned named profiles, keeping only truthy keys", async () => {
    mockRoleRow = { role: "psg_internal" };
    mockLegacyRow = { functions_jsonb: { manage_companies: true, manage_reports: false } };
    mockAssignmentRows = [
      { security_profile_defs: { functions_jsonb: { manage_sysconfig: true } } },
      { security_profile_defs: [{ functions_jsonb: { manage_production: true } }] }, // array shape
    ];

    const result = await getOpsAccess("user-1");
    expect(result.role).toBe("psg_internal");
    expect([...result.functions].sort()).toEqual([
      "manage_companies",
      "manage_production",
      "manage_sysconfig",
    ]);
    expect(result.functions.has("manage_reports")).toBe(false); // falsy value dropped
  });

  it("returns an empty capability set when the user has no grants", async () => {
    mockRoleRow = { role: "customer" };
    mockLegacyRow = null;
    mockAssignmentRows = [];

    const result = await getOpsAccess("user-2");
    expect(result.role).toBe("customer");
    expect(result.functions.size).toBe(0);
  });
});
