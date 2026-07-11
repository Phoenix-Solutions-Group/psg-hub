import { describe, expect, it } from "vitest";
import {
  asAdminAppRole,
  asAdminTier,
  asShopMemberRole,
  auditActionForRoleChange,
} from "@/lib/ops/user-management";

describe("user-management helpers", () => {
  it("validates app roles", () => {
    expect(asAdminAppRole("customer")).toBe("customer");
    expect(asAdminAppRole("psg_internal")).toBe("psg_internal");
    expect(asAdminAppRole("psg_superadmin")).toBe("psg_superadmin");
    expect(asAdminAppRole("admin")).toBeNull();
    expect(asAdminAppRole(null)).toBeNull();
  });

  it("validates shop member roles", () => {
    expect(asShopMemberRole("owner")).toBe("owner");
    expect(asShopMemberRole("manager")).toBe("manager");
    expect(asShopMemberRole("viewer")).toBe("viewer");
    expect(asShopMemberRole("billing")).toBeNull();
  });

  it("validates supported tiers", () => {
    expect(asAdminTier("essentials")).toBe("essentials");
    expect(asAdminTier("growth")).toBe("growth");
    expect(asAdminTier("performance")).toBe("performance");
    expect(asAdminTier("multi_location")).toBeNull();
  });

  it("uses generic grant/revoke audit actions for non-superadmin role changes", () => {
    expect(auditActionForRoleChange("customer")).toBe("role.revoke");
    expect(auditActionForRoleChange("psg_internal")).toBe("role.grant");
  });

  it("uses specific audit actions when entering or leaving superadmin", () => {
    expect(auditActionForRoleChange("psg_superadmin", null)).toBe("superadmin.add");
    expect(auditActionForRoleChange("psg_superadmin", "psg_internal")).toBe("superadmin.add");
    expect(auditActionForRoleChange("psg_internal", "psg_superadmin")).toBe("superadmin.remove");
    expect(auditActionForRoleChange("customer", "psg_superadmin")).toBe("superadmin.remove");
    expect(auditActionForRoleChange("psg_superadmin", "psg_superadmin")).toBe("role.grant");
  });
});
