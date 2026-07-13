import { expect, test } from "@playwright/test";
import { OWNER } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

test.describe("focused BSM customer walkthrough", () => {
  test.use({ storageState: OWNER.statePath });

  test("customer can sign in and see the customer navigation", async ({
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
    await expect(page.getByRole("heading", { name: OWNER.shopName })).toBeVisible();
    await expect(page.getByText("Organic traffic").first()).toBeVisible();
    await expect(page.getByText(/Last synced/)).toBeVisible();
    await shoot(page, "focused-bsm-analytics");
  });

  test("Google Ads setup state is visible", async ({ page }) => {
    await page.goto("/dashboard/ads");
    await expect(page.getByRole("heading", { name: "Ads", exact: true })).toBeVisible();
    await shoot(page, "focused-bsm-ads");
    await expect(page.getByRole("heading", { name: "Google Ads" })).toBeVisible();
    await expect(page.getByText("No Google Ads account linked yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Link Google Ads" })).toBeVisible();
  });

  test("billing path is visible", async ({ page }) => {
    await page.goto("/dashboard/billing");
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("Manage your subscription and billing.")).toBeVisible();
    await expect(page.getByText("Essentials")).toBeVisible();
    await expect(page.getByText("Growth", { exact: true })).toBeVisible();
    await expect(page.getByText("Performance")).toBeVisible();
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

  for (const route of [
    { path: "/dashboard/analytics", label: "focused-bsm-analytics" },
    { path: "/dashboard/ads", label: "focused-bsm-ads" },
    { path: "/dashboard/billing", label: "focused-bsm-billing" },
    { path: "/dashboard/approvals", label: "focused-bsm-approvals" },
  ]) {
    test(`${route.label} has no serious accessibility violations`, async ({
      page,
    }) => {
      await page.goto(route.path);
      await checkA11y(page, route.label);
    });
  }
});
