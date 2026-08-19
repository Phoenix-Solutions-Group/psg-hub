import { describe, expect, it } from "vitest";
import { dashboardNav } from "../layout";

describe("dashboardNav", () => {
  it("shows collision data review only to superadmins", () => {
    const reviewHref = "/dashboard/collision-intelligence/review";

    expect(dashboardNav(null, true).map(({ href }) => href)).toContain(
      reviewHref,
    );
    expect(dashboardNav(null, false).map(({ href }) => href)).not.toContain(
      reviewHref,
    );
  });
});
