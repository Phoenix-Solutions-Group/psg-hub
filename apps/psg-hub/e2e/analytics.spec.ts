import { test, expect } from "@playwright/test";
import { OWNER, MULTI, MEGA } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// 09-02: the analytics surface in a REAL browser. Recharts 3 emits no SVG
// geometry in node SSR, so the "charts actually render" proof + the axe AA
// scan can only happen here (research/recharts-integration.md).

test.describe("analytics — per-shop (OWNER)", () => {
  test.use({ storageState: OWNER.statePath });

  test("renders KPIs + real chart SVG, scoped to the active shop", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    // Story-led header for the active shop + sync freshness.
    await expect(
      page.getByRole("heading", { name: OWNER.shopName })
    ).toBeVisible();
    await expect(page.getByText(/Last synced/)).toBeVisible();

    // Single-shop user: NO scope toggle (AC-3 negative).
    await expect(
      page.getByRole("navigation", { name: "Analytics scope" })
    ).toHaveCount(0);

    // KPI cards present.
    await expect(page.getByText("Organic traffic").first()).toBeVisible();
    await expect(page.getByText("Authority score")).toBeVisible();

    // REAL recharts render: SVG path geometry inside the chart region (the
    // node-SSR output is an empty wrapper — only a browser produces this).
    const chart = page.getByRole("img", {
      name: /Organic traffic over the last 30 days/,
    });
    await expect(chart).toBeVisible();
    expect(await chart.locator("svg path").count()).toBeGreaterThan(0);

    await checkA11y(page, "analytics");
    await shoot(page, "analytics");
  });
});

test.describe("analytics — MSO aggregate (MULTI)", () => {
  test.use({ storageState: MULTI.statePath });

  test("scope toggle aggregates across both shops", async ({ page }) => {
    await page.goto("/dashboard/analytics");

    // Multi-shop user sees the scope toggle; default = active shop (owned A).
    const toggle = page.getByRole("navigation", { name: "Analytics scope" });
    await expect(toggle).toBeVisible();
    await expect(
      page.getByRole("heading", { name: MULTI.shopA })
    ).toBeVisible();

    // Per-shop KPI: the seed formula's latest daily value for ONE shop
    // (14 days: 400 + 13*7 = 491). Anchors the aggregation proof below.
    await expect(page.getByText("491", { exact: true })).toBeVisible();

    // Switch to the all-shops aggregate.
    await toggle.getByRole("link", { name: "All shops" }).click();
    await expect(
      page.getByRole("heading", { name: "All shops" })
    ).toBeVisible();

    // Aggregate view drops the non-summable authority KPI, keeps traffic.
    await expect(page.getByText("Authority score")).toHaveCount(0);
    await expect(page.getByText("Organic traffic").first()).toBeVisible();

    // AGGREGATION PROOF: traffic KPI = shop A + shop B (2 x 491 = 982). A page
    // wired to the single-shop reader would still render 491 and pass the
    // svg-only checks — this assertion is what makes "aggregate" true.
    await expect(page.getByText("982", { exact: true })).toBeVisible();

    // Charts render real SVG on the aggregate too.
    const chart = page.getByRole("img", {
      name: /Organic traffic over the last 30 days/,
    });
    await expect(chart).toBeVisible();
    expect(await chart.locator("svg path").count()).toBeGreaterThan(0);

    // Client-side nav fades the new segment in; axe blends mid-animation
    // colors into false contrast fails (proven: at-rest computed colors are
    // the full tokens). Settle running animations before scanning.
    await page
      .waitForFunction(() => document.getAnimations().length === 0, undefined, {
        timeout: 5_000,
      })
      .catch(() => {});
    await page.waitForTimeout(250);

    await checkA11y(page, "analytics-aggregate");
    await shoot(page, "analytics-aggregate");
  });
});

test.describe("analytics — designed empty state (MEGA shops have no snapshots)", () => {
  test.use({ storageState: MEGA.statePath });

  test("zero-data shop gets the designed empty state, no chart shells", async ({
    page,
  }) => {
    await page.goto("/dashboard/analytics");

    // CardTitle renders a div (08-04b precedent) — match by text.
    await expect(page.getByText("No analytics data yet")).toBeVisible();
    await expect(page.getByText("Awaiting first sync")).toBeVisible();
    // No chart shells and no KPI lies on a no-data shop (scoped to main —
    // the brand Logo outside it is also role=img).
    await expect(page.getByRole("main").getByRole("img")).toHaveCount(0);

    await checkA11y(page, "analytics-empty");
    await shoot(page, "analytics-empty");
  });
});

test.describe("switcher typeahead — big MSO (MEGA, 9 shops)", () => {
  test.use({ storageState: MEGA.statePath });

  test("typing filters the shop list live", async ({ page }) => {
    await page.goto("/dashboard");

    const sidebar = page.getByRole("complementary");
    const search = sidebar.getByRole("searchbox", { name: "Search shops" });
    const select = sidebar.getByRole("combobox", { name: "Active shop" });

    await expect(search).toBeVisible();
    await expect(select.getByRole("option")).toHaveCount(
      MEGA.shopNames.length
    );

    // Type a query matching exactly one shop.
    await search.fill("Mega Shop 3");
    await expect(sidebar.getByText(/1 of 9 shops/)).toBeVisible();

    // Clear restores the full list.
    await search.fill("");
    await expect(sidebar.getByText(/9 of 9 shops/)).toBeVisible();
    await expect(select.getByRole("option")).toHaveCount(
      MEGA.shopNames.length
    );

    await checkA11y(page, "switcher-typeahead");
  });
});
