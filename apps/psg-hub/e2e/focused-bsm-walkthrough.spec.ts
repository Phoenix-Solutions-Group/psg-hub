import { expect, test } from "@playwright/test";
import { BSM_DEMO_USER, MULTI } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

test.describe("clean BSM demo user walkthrough", () => {
  test.use({ storageState: BSM_DEMO_USER.statePath });

  test("demo user can sign in for the first time and see the customer navigation", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Analytics" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Billing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Invoices" })).toBeVisible();
  });

  test("analytics is visible and useful", async ({ page }) => {
    await page.goto("/dashboard/analytics");
    await expect(page.getByRole("heading", { name: BSM_DEMO_USER.shopName })).toBeVisible();
    await expect(page.getByText("Organic traffic").first()).toBeVisible();
    await expect(page.getByText(/Last synced/)).toBeVisible();
    await shoot(page, "focused-bsm-analytics");
  });

  test("settings shows the active shop profile", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Shop profile", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(BSM_DEMO_USER.shopName)).toBeVisible();
    await shoot(page, "focused-bsm-settings");
  });

  test("content route shows reviewable BSM content", async ({ page }) => {
    await page.goto("/dashboard/content");
    await expect(page.getByRole("heading", { name: "Content" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Riverside Collision July repair tips" })).toBeVisible();

    await page.getByRole("link", { name: "Riverside Collision July repair tips" }).click();
    await expect(page.getByRole("heading", { name: "Riverside Collision July repair tips" }).first()).toBeVisible();
    await expect(page.getByText("PSG prepared this customer-facing article")).toBeVisible();
    await shoot(page, "focused-bsm-content");
  });

  test("Google Ads customer hub is visible", async ({ page }) => {
    await page.goto("/dashboard/ads");
    await shoot(page, "focused-bsm-ads");
    await expect(page.getByRole("heading", { name: "Your Google Ads" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How your ads are doing" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Request an ad change" })).toBeVisible();
    await expect(page.getByText("Numbers current as of")).toBeVisible();
  });

  test("billing path is visible", async ({ page }) => {
    await page.goto("/dashboard/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("Manage your subscription and billing.")).toBeVisible();
    await expect(page.getByText("Essentials")).toBeVisible();
    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
    await expect(page.locator("#performance").getByText("Performance", { exact: true })).toBeVisible();
    await shoot(page, "focused-bsm-billing");
  });

  test("invoice path is visible from the customer navigation", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Invoices" }).click();
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByText("View and pay your PSG invoices.")).toBeVisible();
    await expect(page.getByText("No invoices yet.")).toBeVisible();
    await shoot(page, "focused-bsm-invoices");
  });

  test("agent approval queue shows review-before-publish behavior", async ({
    page,
  }) => {
    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(
      page.getByText("Review agent-proposed actions before they go live.")
    ).toBeVisible();
    await expect(page.getByText("Nothing waiting for review.")).toBeVisible();
    await shoot(page, "focused-bsm-approvals");
  });

  test("reviews route shows customer feedback and sentiment", async ({ page }) => {
    await page.goto("/dashboard/reviews");
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
    await expect(page.getByText("Morgan Lee")).toBeVisible();
    await expect(page.getByText("Riverside Collision kept me updated")).toBeVisible();
    await expect(page.getByText("Positive")).toBeVisible();
    await expect(page.getByRole("button", { name: "None" })).toBeVisible();
    await shoot(page, "focused-bsm-reviews");
  });

  test("customer can complete the BSM content approval loop", async ({ page }) => {
    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("heading", { name: "Content Review" })).toBeVisible();
    await page.getByRole("link", { name: /E2E BSM homepage approval/ }).click();

    await expect(page.getByRole("heading", { name: "E2E BSM homepage approval" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review content" })).toBeVisible();
    await expect(page.getByText("Homepage proof v2").first()).toBeVisible();

    await page.getByLabel("Comment").fill("The phone number and offer are correct.");
    await page.getByRole("button", { name: "Add comment" }).click();
    await expect(page.getByText("The phone number and offer are correct.").first()).toBeVisible();

    await page.getByLabel("Decision note").fill("Please tighten the headline.");
    await page.getByRole("button", { name: "Request updates" }).click();
    await expect(page.getByText("Request Updates").first()).toBeVisible();

    await page.getByLabel("Decision note").fill("Approved for launch.");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approve").first()).toBeVisible();

    await page.getByLabel("Decision note").fill("Declining duplicate test copy.");
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("Decline").first()).toBeVisible();

    await page.getByLabel("Restore request").fill("Restore the prior homepage proof for comparison.");
    await page.getByRole("button", { name: "Request restore" }).click();
    await expect(page.getByText("Restore the prior homepage proof for comparison.").first()).toBeVisible();

    await page.goto("/dashboard/approvals");
    await expect(page.getByRole("heading", { name: "Approved Content Archive" })).toBeVisible();
    await expect(page.getByText("E2E BSM homepage approval").first()).toBeVisible();
  });

  test("customer cannot open another shop's BSM content approval", async ({ page }) => {
    const response = await page.goto(`/dashboard/approvals/content/${MULTI.bsmReviewItemId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  });

  for (const route of [
    { path: "/dashboard/analytics", label: "focused-bsm-analytics" },
    { path: "/dashboard/ads", label: "focused-bsm-ads" },
    { path: "/dashboard/settings", label: "focused-bsm-settings" },
    { path: "/dashboard/content", label: "focused-bsm-content-list" },
    { path: "/dashboard/billing", label: "focused-bsm-billing" },
    { path: "/dashboard/approvals", label: "focused-bsm-approvals" },
    { path: "/dashboard/reviews", label: "focused-bsm-reviews" },
  ]) {
    test(`${route.label} has no serious accessibility violations`, async ({
      page,
    }) => {
      await page.goto(route.path);
      await checkA11y(page, route.label);
    });
  }
});
