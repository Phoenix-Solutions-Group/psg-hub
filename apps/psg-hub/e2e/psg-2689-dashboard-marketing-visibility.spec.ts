import { test, expect } from "@playwright/test";
import { OWNER } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

test.describe("PSG-2689 dashboard marketing visibility", () => {
  test.use({ storageState: OWNER.statePath });

  test("customer dashboard shows restored visibility cards with honest data states", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();

    await expect(page.getByText("Content Items", { exact: true })).toBeVisible();
    await expect(page.getByText("Pending Review", { exact: true })).toBeVisible();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();

    const visibility = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Marketing visibility" }),
    });
    await expect(visibility).toBeVisible();
    await expect(visibility).toContainText(
      "The core signals a shop owner needs to see whether local marketing is working.",
    );

    await expect(visibility).toContainText("Local map visibility");
    await expect(visibility).toContainText("Waiting on first scan");
    await expect(visibility).toContainText(
      "Map ranking appears after PSG imports a Local Falcon scan for this shop.",
    );

    await expect(visibility).toContainText("Local presence");
    await expect(visibility).toContainText("4.6 rating");
    await expect(visibility).toContainText("87 Google reviews currently counted.");

    await expect(visibility).toContainText("Search performance");
    await expect(visibility).toContainText("258 clicks");
    await expect(visibility).toContainText(
      "3,096 search impressions in the latest synced day.",
    );

    await expect(visibility).toContainText(
      "Google Analytics property connection",
    );
    await expect(visibility).toContainText("645 sessions");
    await expect(visibility).toContainText(
      "635 website users in the latest synced day.",
    );

    await expect(
      visibility.getByRole("link", { name: "View full analytics" }),
    ).toHaveAttribute("href", "/dashboard/analytics");
    await expect(visibility).not.toContainText("demo");

    await checkA11y(page, "psg-2689-dashboard-marketing-visibility");
    await shoot(page, "psg-2689-dashboard-marketing-visibility");
  });
});
