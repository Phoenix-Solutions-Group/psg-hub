import { test, expect } from "@playwright/test";
import { OWNER, MULTI, MEGA } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// 13-02b: the GBP (local presence) panel on the analytics surface. Seeded gbp
// snapshots (global.setup): OWNER 30d from call_clicks 300, MULTI A 14d from 300 +
// B 14d from 500, MEGA none (unlinked-state path). Latest-day call_clicks (base + idx):
// OWNER 329, A 313, B 513; aggregate A+B = 826. EVERY gbp metric is summable, so the
// aggregate keeps ALL KPIs — the INVERSE of the gsc panel (which drops ctr+position).

test.describe("gbp panel — per-shop (OWNER)", () => {
  test.use({ storageState: OWNER.statePath });

  test("renders the Local presence panel + real call_clicks KPI + a calls chart SVG", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Local presence" })
    ).toBeVisible();

    // 13-03b: the monthly presence header — seeded star rating 4.6 / 87 reviews / OPEN.
    await expect(
      page.getByText("Current profile status")
    ).toBeVisible();
    await expect(page.getByText("4.6", { exact: true })).toBeVisible();
    await expect(page.getByText("87 reviews")).toBeVisible();
    await expect(page.getByText("Open", { exact: true })).toBeVisible();

    // Latest seeded call_clicks = 300 + 29 = 329 (unique on the page).
    await expect(page.getByText("329", { exact: true })).toBeVisible();

    // REAL recharts render in the calls chart.
    const chart = page.getByRole("img", {
      name: /Profile calls over the last 30 days/,
    });
    await expect(chart).toBeVisible();
    expect(await chart.locator("svg path").count()).toBeGreaterThan(0);

    await checkA11y(page, "analytics-gbp");
    await shoot(page, "analytics-gbp");
  });
});

test.describe("gbp panel — MSO aggregate keeps ALL KPIs (MULTI)", () => {
  test.use({ storageState: MULTI.statePath });

  test("aggregate sums call_clicks and excludes NOTHING (every gbp metric is summable)", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    // Per-shop (active shop A) latest call_clicks = 300 + 13 = 313.
    await expect(page.getByText("313", { exact: true })).toBeVisible();

    // Switch to the all-shops aggregate.
    await page
      .getByRole("navigation", { name: "Analytics scope" })
      .getByRole("link", { name: "All shops" })
      .click();
    await expect(
      page.getByRole("heading", { name: "All shops" })
    ).toBeVisible();

    // AGGREGATION PROOF: call_clicks = shop A 313 + shop B 513 = 826.
    await expect(page.getByText("826", { exact: true })).toBeVisible();

    // INVERSE of gsc: ALL gbp KPI labels remain in the aggregate — nothing excluded.
    await expect(page.getByText("Calls", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("Website clicks", { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Direction requests", { exact: true }).first()
    ).toBeVisible();
    await expect(
      page.getByText("Profile impressions", { exact: true }).first()
    ).toBeVisible();

    // Settle the client-nav fade before the axe scan (09-02 precedent).
    await page
      .waitForFunction(() => document.getAnimations().length === 0, undefined, {
        timeout: 5_000,
      })
      .catch(() => {});
    await page.waitForTimeout(250);

    await checkA11y(page, "analytics-gbp-aggregate");
    await shoot(page, "analytics-gbp-aggregate");
  });
});

test.describe("gbp panel — unlinked state (MEGA, no gbp)", () => {
  test.use({ storageState: MEGA.statePath });

  test("a shop with no linked GBP location gets the designed unlinked state", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    await expect(
      page.getByRole("heading", { name: "Local presence" })
    ).toBeVisible();
    // CardTitle renders a div (08-04b precedent) — match by text.
    await expect(
      page.getByText("No Google Business Profile linked")
    ).toBeVisible();

    await checkA11y(page, "analytics-gbp-unlinked");
    await shoot(page, "analytics-gbp-unlinked");
  });
});
