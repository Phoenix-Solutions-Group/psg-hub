import { test, expect } from "@playwright/test";
import { OWNER, MULTI, MEGA } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// 11-02: the GA4 (website traffic) panel on the analytics surface. Seeded ga4
// snapshots (global.setup): OWNER 30d from sessions 500, MULTI A 14d from 500 +
// B 14d from 800, MEGA none (unlinked-state path). Latest-day sessions:
// OWNER 645, A 565, B 865; aggregate A+B = 1430.

test.describe("ga4 panel — per-shop (OWNER)", () => {
  test.use({ storageState: OWNER.statePath });

  test("renders GA4 KPIs (incl. engagement rate) + real sessions chart SVG", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Website traffic" })
    ).toBeVisible();

    // Per-shop-only engagement-rate KPI card.
    await expect(
      page.getByText("Engagement rate", { exact: true })
    ).toBeVisible();

    // Latest seeded sessions = 500 + 29*5 = 645 (unique on the page).
    await expect(page.getByText("645", { exact: true })).toBeVisible();

    // REAL recharts render in the sessions chart.
    const chart = page.getByRole("img", {
      name: /Website sessions over the last 30 days/,
    });
    await expect(chart).toBeVisible();
    expect(await chart.locator("svg path").count()).toBeGreaterThan(0);

    await checkA11y(page, "analytics-ga4");
    await shoot(page, "analytics-ga4");
  });
});

test.describe("ga4 panel — MSO aggregate excludes engagement rate (MULTI)", () => {
  test.use({ storageState: MULTI.statePath });

  test("aggregate sums sessions and drops the engagement-rate ratio card", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    // Per-shop (active shop A) latest sessions = 500 + 13*5 = 565.
    await expect(page.getByText("565", { exact: true })).toBeVisible();
    // Per-shop DOES show engagement rate.
    await expect(
      page.getByText("Engagement rate", { exact: true })
    ).toBeVisible();

    // Switch to the all-shops aggregate.
    await page
      .getByRole("navigation", { name: "Analytics scope" })
      .getByRole("link", { name: "All shops" })
      .click();
    await expect(
      page.getByRole("heading", { name: "All shops" })
    ).toBeVisible();

    // AGGREGATION PROOF: sessions = shop A 565 + shop B 865 = 1,430.
    await expect(page.getByText("1,430", { exact: true })).toBeVisible();
    // The summed-ratio lie is excluded from the aggregate.
    await expect(
      page.getByText("Engagement rate", { exact: true })
    ).toHaveCount(0);
    // Summable GA4 KPIs remain.
    await expect(page.getByText("Sessions", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Key events", { exact: true }).first()).toBeVisible();

    // Settle the client-nav fade before the axe scan (09-02 precedent).
    await page
      .waitForFunction(() => document.getAnimations().length === 0, undefined, {
        timeout: 5_000,
      })
      .catch(() => {});
    await page.waitForTimeout(250);

    await checkA11y(page, "analytics-ga4-aggregate");
    await shoot(page, "analytics-ga4-aggregate");
  });
});

test.describe("ga4 panel — unlinked state (MEGA, no ga4)", () => {
  test.use({ storageState: MEGA.statePath });

  test("a shop with no linked GA4 property gets the designed unlinked state", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Website traffic" })
    ).toBeVisible();
    // CardTitle renders a div (08-04b precedent) — match by text.
    await expect(
      page.getByText("No Google Analytics property linked")
    ).toBeVisible();

    await checkA11y(page, "analytics-ga4-unlinked");
    await shoot(page, "analytics-ga4-unlinked");
  });
});
