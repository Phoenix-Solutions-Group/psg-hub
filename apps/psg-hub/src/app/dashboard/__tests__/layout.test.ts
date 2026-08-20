import { describe, expect, it } from "vitest";
import { dashboardNav } from "../layout";

describe("dashboardNav", () => {
  it("shows collision data review only to superadmins", () => {
    const reviewHref = "/dashboard/collision-intelligence/review";
    const superadminNav = dashboardNav(null, true);

    expect(superadminNav.map(({ href }) => href)).toContain(reviewHref);
    expect(superadminNav.find(({ href }) => href === reviewHref)?.label).toBe(
      "Data Quality & Matching",
    );
    expect(dashboardNav(null, false).map(({ href }) => href)).not.toContain(
      reviewHref,
    );
  });
});
