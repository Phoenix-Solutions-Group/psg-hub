import { test, expect } from "@playwright/test";
import { MULTI } from "@/../e2e/fixtures";
import { checkA11y, shoot } from "@/../e2e/_helpers";

test.use({ storageState: MULTI.statePath });

test("dashboard is the portfolio tool home", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "Your PSG tools" }),
  ).toBeVisible();
  for (const name of [
    "Content Approvals",
    "Reviews & Reputation",
    "Marketing Analytics",
    "Google Ads",
    "Plan & Billing",
    "Shop Settings",
  ]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(page.locator('[data-tool="agents"]')).toHaveCount(0);

  const analytics = page.locator('[data-tool="analytics"]');
  await expect(analytics.getByText("2 ready", { exact: true })).toBeVisible();

  const content = page.locator('[data-tool="content"]');
  await content.getByRole("button", { name: "Choose location" }).click();
  const locationPanel = page.getByRole("region", {
    name: "Content Approvals by location",
  });
  await expect(locationPanel).toBeVisible();
  const search = locationPanel.getByRole("searchbox", {
    name: "Find a location",
  });
  await expect(search).toBeFocused();
  await checkA11y(page, "dashboard-tools-location");
  await search.fill("Shop B");
  await expect(
    locationPanel.getByText(MULTI.shopB, { exact: true }),
  ).toBeVisible();
  await expect(
    locationPanel.getByText(MULTI.shopA, { exact: true }),
  ).toHaveCount(0);
  await locationPanel
    .getByRole("button", { name: "Close location chooser" })
    .click();
  await expect(locationPanel).toHaveCount(0);

  const ads = page.locator('[data-tool="ads"]');
  await ads.getByRole("button", { name: "Contact PSG" }).click();
  const request = page.getByRole("region", {
    name: "Request Google Ads for your portfolio",
  });
  await expect(request).toContainText(
    "does not change your plan or begin checkout",
  );
  await expect(
    request.getByRole("button", { name: "Send request" }),
  ).toBeVisible();

  await checkA11y(page, "dashboard-tools-request");
  await request
    .getByRole("button", { name: "Close portfolio request" })
    .click();
  await checkA11y(page, "dashboard-tools");
  await shoot(page, "dashboard-tools");
});
