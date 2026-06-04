import { test, expect } from "@playwright/test";
import { OWNER, PASSWORD } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// Fresh, unauthenticated context (ignore the per-role storageState).
test.use({ storageState: { cookies: [], origins: [] } });

test("login form authenticates and lands on the dashboard", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Welcome back" })
  ).toBeVisible();
  await checkA11y(page, "login");
  await shoot(page, "login");

  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/dashboard");
  // Authenticated shell: sign-out control + the owner's shop name in the sidebar.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(
    page.getByRole("complementary").getByText(OWNER.shopName)
  ).toBeVisible();

  await checkA11y(page, "dashboard");
  await shoot(page, "dashboard");
});
