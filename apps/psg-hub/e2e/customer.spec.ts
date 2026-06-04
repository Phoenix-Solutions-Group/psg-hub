import { test, expect } from "@playwright/test";
import { OWNER } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// 1-shop owner session.
test.use({ storageState: OWNER.statePath });

test("settings renders scoped to the active shop", async ({ page }) => {
  await page.goto("/dashboard/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  // CardTitle renders a styled div (not a heading role) — match by text.
  await expect(page.getByText("Shop profile", { exact: true })).toBeVisible();

  // Active-shop scoping: the main content shows THIS owner's shop, not an
  // arbitrary/other-tenant shop, and no "no shop linked" empty state.
  await expect(
    page.getByRole("main").getByText(OWNER.shopName)
  ).toBeVisible();
  await expect(
    page.getByText("No shop linked to your account yet.")
  ).toHaveCount(0);

  await checkA11y(page, "settings");
  await shoot(page, "settings");
});
