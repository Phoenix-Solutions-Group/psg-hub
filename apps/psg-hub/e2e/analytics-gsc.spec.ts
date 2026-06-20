import { test, expect } from "@playwright/test";
import { OWNER, MULTI, MEGA } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// 11-03: the GSC (search performance) panel on the analytics surface. Seeded gsc
// snapshots (global.setup): OWNER 30d from clicks 200, MULTI A 14d from 200 +
// B 14d from 400, MEGA none (unlinked-state path). Latest-day clicks (base + idx*2):
// OWNER 258, A 226, B 426; aggregate A+B = 652.

test.describe("gsc panel — per-shop (OWNER)", () => {
  test.use({ storageState: OWNER.statePath });

  test("renders GSC KPIs (incl. CTR + avg position) + real clicks chart SVG", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Search performance" })
    ).toBeVisible();

    // Per-shop-only ratio/average KPI cards.
    await expect(page.getByText("CTR", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg. position", { exact: true })).toBeVisible();

    // Latest seeded clicks = 200 + 29*2 = 258 (unique on the page).
    await expect(page.getByText("258", { exact: true })).toBeVisible();

    // REAL recharts render in the clicks chart.
    const chart = page.getByRole("img", {
      name: /Search clicks over the last 30 days/,
    });
    await expect(chart).toBeVisible();
    // Wait for Recharts to render paths (animation runs after container appears).
    await expect(chart.locator("svg path").first()).toBeVisible();
    expect(await chart.locator("svg path").count()).toBeGreaterThan(0);

    await checkA11y(page, "analytics-gsc");
    await shoot(page, "analytics-gsc");
  });
});

test.describe("gsc panel — MSO aggregate excludes ctr + position (MULTI)", () => {
  test.use({ storageState: MULTI.statePath });

  test("aggregate sums clicks and drops BOTH the ctr and position ratio cards", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    // Per-shop (active shop A) latest clicks = 200 + 13*2 = 226.
    await expect(page.getByText("226", { exact: true })).toBeVisible();
    // Per-shop DOES show CTR + avg position.
    await expect(page.getByText("CTR", { exact: true })).toBeVisible();
    await expect(page.getByText("Avg. position", { exact: true })).toBeVisible();

    // Switch to the all-shops aggregate.
    await page
      .getByRole("navigation", { name: "Analytics scope" })
      .getByRole("link", { name: "All shops" })
      .click();
    await expect(
      page.getByRole("heading", { name: "All shops" })
    ).toBeVisible();

    // AGGREGATION PROOF: clicks = shop A 226 + shop B 426 = 652.
    await expect(page.getByText("652", { exact: true })).toBeVisible();
    // The summed-ratio lies are excluded from the aggregate.
    await expect(page.getByText("CTR", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Avg. position", { exact: true })
    ).toHaveCount(0);
    // Summable GSC KPIs remain.
    await expect(page.getByText("Clicks", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("Impressions", { exact: true }).first()
    ).toBeVisible();

    // Settle the client-nav fade before the axe scan (09-02 precedent).
    await page
      .waitForFunction(() => document.getAnimations().length === 0, undefined, {
        timeout: 5_000,
      })
      .catch(() => {});
    await page.waitForTimeout(250);

    await checkA11y(page, "analytics-gsc-aggregate");
    await shoot(page, "analytics-gsc-aggregate");
  });
});

test.describe("gsc panel — unlinked state (MEGA, no gsc)", () => {
  test.use({ storageState: MEGA.statePath });

  test("a shop with no linked GSC site gets the designed unlinked state", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Search performance" })
    ).toBeVisible();
    // CardTitle renders a div (08-04b precedent) — match by text.
    await expect(
      page.getByText("No Google Search Console site linked")
    ).toBeVisible();

    await checkA11y(page, "analytics-gsc-unlinked");
    await shoot(page, "analytics-gsc-unlinked");
  });
});
