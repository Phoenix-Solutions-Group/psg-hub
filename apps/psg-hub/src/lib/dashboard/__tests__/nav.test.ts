import { describe, expect, it } from "vitest";
import { buildDashboardNav } from "@/lib/dashboard/nav";

describe("buildDashboardNav", () => {
  it("does not show shop-scoped billing links without an active shop", () => {
    const nav = buildDashboardNav(null);

    expect(nav.map((item) => item.label)).not.toContain("Billing");
    expect(nav.map((item) => item.label)).not.toContain("Invoices");
  });

  it("shows billing and the active shop invoice path when a shop is selected", () => {
    const nav = buildDashboardNav("shop 1");

    expect(nav).toContainEqual({ href: "/dashboard/billing", label: "Billing" });
    expect(nav).toContainEqual({
      href: "/dashboard/shop/shop%201/invoices",
      label: "Invoices",
    });
  });
});
