import { expect, test } from "@playwright/test";
import { DEMO_SESSIONS } from "./demo-fixtures";

test.describe("superadmin walkthrough QA environment", () => {
  test.use({ storageState: DEMO_SESSIONS.operator.statePath });

  test("operator can reach user access, module access, and audit pages", async ({ page }) => {
    await page.goto("/ops/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "User Access" })).toBeVisible();
    await expect(page.getByText("Users and shop access")).toBeVisible();
    await expect(page.getByPlaceholder("Search users")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save role" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign shop" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save tier" }).first()).toBeVisible();

    await page.goto("/ops/admin/modules", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Module Access Matrix" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New module" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Deny" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Inherit" }).first()).toBeVisible();

    await page.goto("/ops/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Access Audit" })).toBeVisible();
    await expect(page.getByText("Append-only history of every privileged change")).toBeVisible();
  });
});
