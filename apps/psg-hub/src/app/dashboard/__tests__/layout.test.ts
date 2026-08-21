import { describe, expect, it } from "vitest";
import { dashboardNav } from "../layout";

describe("dashboardNav", () => {
  it("shows collision data review only to superadmins", () => {
    const reviewHref = "/dashboard/collision-intelligence/review";
    const insuranceHref =
      "/dashboard/collision-intelligence/body-shop-insurance";
    const superadminNav = dashboardNav(null, true);

    expect(superadminNav.map(({ href }) => href)).toContain(reviewHref);
    expect(superadminNav.map(({ href }) => href)).toContain(insuranceHref);
    expect(superadminNav.find(({ href }) => href === reviewHref)?.label).toBe(
      "Data Quality & Matching",
    );
    expect(dashboardNav(null, false).map(({ href }) => href)).not.toContain(
      reviewHref,
    );
    expect(dashboardNav(null, false).map(({ href }) => href)).not.toContain(
      insuranceHref,
    );
  });

  it("uses distinct customer navigation terms for requests, artifacts, and reputation", () => {
    const nav = dashboardNav(null, false);

    expect(nav.find(({ href }) => href === "/dashboard/approvals")?.label).toBe(
      "Review Requests",
    );
    expect(nav.find(({ href }) => href === "/dashboard/content")?.label).toBe(
      "Content Library",
    );
    expect(nav.find(({ href }) => href === "/dashboard/reviews")?.label).toBe(
      "Reputation",
    );
  });
});
