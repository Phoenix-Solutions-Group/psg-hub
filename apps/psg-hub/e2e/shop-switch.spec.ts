import { test, expect } from "@playwright/test";
import { MULTI } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// 2-shop user: owner of A (default active, owner-first), viewer of B.
test.use({ storageState: MULTI.statePath });

test("switching shops rescopes the customer surface (07-03 flow)", async ({
  page,
}) => {
  await page.goto("/dashboard/settings");

  // Default active shop = the owned shop A.
  await expect(page.getByRole("main").getByText(MULTI.shopA)).toBeVisible();

  // The sidebar switcher lists both memberships.
  const switcher = page
    .getByRole("complementary")
    .getByRole("combobox", { name: "Active shop" });
  await expect(switcher).toBeVisible();
  await expect(switcher.getByRole("option")).toHaveCount(2);

  await checkA11y(page, "switch-before");
  await shoot(page, "switch-before");

  // Switch to shop B -> POST /api/shop/switch -> router.refresh -> rescope.
  await switcher.selectOption({ label: MULTI.shopB });

  await expect(page.getByRole("main").getByText(MULTI.shopB)).toBeVisible();
  await expect(page.getByRole("main").getByText(MULTI.shopA)).toHaveCount(0);

  await checkA11y(page, "switch-after");
  await shoot(page, "switch-after");
});
