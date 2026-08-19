import { describe, expect, it } from "vitest";
import type { OpsAccess } from "@/lib/auth/ops-access";
import { visibleOpsNavItems } from "@/lib/ops/navigation";

const access = (role: OpsAccess["role"], functions: string[] = []): OpsAccess => ({
  role,
  functions: new Set(functions),
});

describe("visibleOpsNavItems", () => {
  it("shows the admin walkthrough entries for a superadmin", () => {
    const labels = visibleOpsNavItems(access("psg_superadmin")).map((item) => item.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Production",
        "Mail Editor",
        "BSM Content Approvals",
        "Companies",
        "User Access",
      ])
    );
    expect(labels).not.toContain("BSM Review Workspace");
  });

  it("keeps capability-gated entries hidden from internal staff without grants", () => {
    const labels = visibleOpsNavItems(access("psg_internal")).map((item) => item.label);
    expect(labels).toContain("Production");
    expect(labels).toContain("Companies");
    expect(labels).not.toContain("Mail Editor");
    expect(labels).not.toContain("BSM Content Approvals");
    expect(labels).not.toContain("BSM Review Workspace");
    expect(labels).not.toContain("User Access");
  });
});
