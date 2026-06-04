import { describe, it, expect, vi } from "vitest";
import { decideDashboardAccess, getDashboardAccess } from "@/lib/auth/shop-access";

// Mutable mock state (names must start with `mock` to satisfy vi.mock hoisting).
let mockRoleRow: { role: string } | null = null;
let mockShopRows: { shop_id: string }[] = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "app_user_roles"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: mockRoleRow }),
              }),
            }),
          }
        : {
            select: () => ({
              eq: () => Promise.resolve({ data: mockShopRows }),
            }),
          },
  }),
}));

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

describe("getDashboardAccess", () => {
  it("maps the role row + membership rows from the service client", async () => {
    mockRoleRow = { role: "customer" };
    mockShopRows = [{ shop_id: "shop-1" }, { shop_id: "shop-2" }];
    const access = await getDashboardAccess("user-1");
    expect(access).toEqual({ role: "customer", shopIds: ["shop-1", "shop-2"] });
  });

  it("defaults to null role + empty shops when no rows exist", async () => {
    mockRoleRow = null;
    mockShopRows = [];
    const access = await getDashboardAccess("user-2");
    expect(access).toEqual({ role: null, shopIds: [] });
  });
});
