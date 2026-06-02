import { describe, it, expect } from "vitest";
import { decideDashboardAccess } from "@/lib/auth/shop-access";

describe("decideDashboardAccess", () => {
  it("psg_superadmin passes with no shops", () => {
    expect(decideDashboardAccess({ role: "psg_superadmin", shopIds: [] })).toBe("pass");
  });

  it("psg_internal passes with no shops", () => {
    expect(decideDashboardAccess({ role: "psg_internal", shopIds: [] })).toBe("pass");
  });

  it("customer with a shop passes", () => {
    expect(decideDashboardAccess({ role: "customer", shopIds: ["shop-1"] })).toBe("pass");
  });

  it("customer with no shop gets no-shop notice", () => {
    expect(decideDashboardAccess({ role: "customer", shopIds: [] })).toBe("no-shop");
  });

  it("null role with no shop gets no-shop notice", () => {
    expect(decideDashboardAccess({ role: null, shopIds: [] })).toBe("no-shop");
  });

  it("null role WITH a shop passes (membership is sufficient)", () => {
    expect(decideDashboardAccess({ role: null, shopIds: ["shop-1"] })).toBe("pass");
  });
});
