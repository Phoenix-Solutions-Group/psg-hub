import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/lib/audit/access-audit";
import {
  auditActionLabel,
  auditCategory,
  knownAuditActions,
  summarizePayload,
} from "@/lib/audit/audit-view";

describe("auditActionLabel", () => {
  it("labels every known action (no raw-key fallthrough)", () => {
    for (const action of AUDIT_ACTIONS) {
      const label = auditActionLabel(action);
      expect(label).not.toBe(action); // every action has a human label
      expect(label.length).toBeGreaterThan(0);
    }
  });
  it("falls back to the raw key for unknown actions", () => {
    expect(auditActionLabel("some.future.action")).toBe("some.future.action");
  });
});

describe("auditCategory", () => {
  it("buckets actions into coarse categories", () => {
    expect(auditCategory("role.grant")).toBe("users");
    expect(auditCategory("shop.assign")).toBe("users");
    expect(auditCategory("tier.change")).toBe("users");
    expect(auditCategory("module_access.deny")).toBe("modules");
    expect(auditCategory("module.visibility.set")).toBe("modules");
    expect(auditCategory("security_profile.assign")).toBe("profiles");
    expect(auditCategory("superadmin.add")).toBe("superadmin");
    expect(auditCategory("mystery")).toBe("other");
  });
  it("covers every known action with a non-other category", () => {
    for (const action of knownAuditActions()) {
      expect(auditCategory(action)).not.toBe("other");
    }
  });
});

describe("summarizePayload", () => {
  it("picks meaningful scalar keys and joins them", () => {
    expect(summarizePayload({ name: "Ads", effect: "deny", role: "customer" })).toBe(
      "name: Ads · role: customer · effect: deny"
    );
  });
  it("skips nested objects (before/after blobs)", () => {
    expect(summarizePayload({ slug: "ads", before: { a: 1 }, after: { a: 2 } })).toBe("slug: ads");
  });
  it("returns empty string for non-objects", () => {
    expect(summarizePayload(null)).toBe("");
    expect(summarizePayload("x")).toBe("");
    expect(summarizePayload([1, 2])).toBe("");
  });
});
