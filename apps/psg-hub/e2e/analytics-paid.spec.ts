import { test, expect } from "@playwright/test";
import { OWNER, MULTI, MEGA } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// 10-02: the paid (Google Ads) panel on the analytics surface. Seeded
// google_ads snapshots (global.setup): OWNER 30d from spend 100, MULTI A 14d
// from 100 + B 14d from 200, MEGA none (unlinked-state path).

test.describe("paid panel — per-shop (OWNER)", () => {
  test.use({ storageState: OWNER.statePath });

  test("renders paid KPIs (incl. CPL) + real spend chart SVG", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Paid advertising" })
    ).toBeVisible();

    // Paid KPI cards, including the per-shop-only CPL. Exact match — the spend
    // chart caption contains the substring "spend (USD)".
    await expect(page.getByText("Spend (USD)", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Cost per lead (USD)", { exact: true })
    ).toBeVisible();

    // Latest seeded spend = 100 + 29 = 129 (unique to the spend KPI).
    await expect(page.getByText("129", { exact: true })).toBeVisible();

    // REAL recharts render in the paid spend chart.
    const chart = page.getByRole("img", {
      name: /Google Ads spend over the last 30 days/,
    });
    await expect(chart).toBeVisible();
    // Wait for Recharts to render paths (animation runs after container appears).
    await expect(chart.locator("svg path").first()).toBeVisible();
    expect(await chart.locator("svg path").count()).toBeGreaterThan(0);

    await checkA11y(page, "analytics-paid");
    await shoot(page, "analytics-paid");
  });
});

test.describe("paid panel — MSO aggregate excludes CPL (MULTI)", () => {
  test.use({ storageState: MULTI.statePath });

  test("aggregate sums spend and drops the CPL ratio card", async ({ page }) => {
    await page.goto("/dashboard/analytics");

    // Per-shop (active shop A) latest spend = 100 + 13 = 113.
    await expect(page.getByText("113", { exact: true })).toBeVisible();
    // Per-shop DOES show CPL.
    await expect(
      page.getByText("Cost per lead (USD)", { exact: true })
    ).toBeVisible();

    // Switch to the all-shops aggregate.
    await page
      .getByRole("navigation", { name: "Analytics scope" })
      .getByRole("link", { name: "All shops" })
      .click();
    await expect(
      page.getByRole("heading", { name: "All shops" })
    ).toBeVisible();

    // AGGREGATION PROOF: spend = shop A 113 + shop B 213 = 326.
    await expect(page.getByText("326", { exact: true })).toBeVisible();
    // The summed-ratio lie is excluded from the aggregate.
    await expect(
      page.getByText("Cost per lead (USD)", { exact: true })
    ).toHaveCount(0);
    // Summable paid KPIs remain.
    await expect(page.getByText("Spend (USD)", { exact: true })).toBeVisible();
    await expect(page.getByText("Conversions").first()).toBeVisible();

    // Settle the client-nav fade before the axe scan (09-02 precedent).
    await page
      .waitForFunction(() => document.getAnimations().length === 0, undefined, {
        timeout: 5_000,
      })
      .catch(() => {});
    await page.waitForTimeout(250);

    await checkA11y(page, "analytics-paid-aggregate");
    await shoot(page, "analytics-paid-aggregate");
  });
});

test.describe("paid panel — unlinked state (MEGA, no google_ads)", () => {
  test.use({ storageState: MEGA.statePath });

  test("a shop with no linked account gets the designed unlinked state", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Paid advertising" })
    ).toBeVisible();
    // CardTitle renders a div (08-04b precedent) — match by text.
    await expect(page.getByText("No Google Ads account linked")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Link Google Ads" })
    ).toBeVisible();

    await checkA11y(page, "analytics-paid-unlinked");
    await shoot(page, "analytics-paid-unlinked");
  });
});
