import { expect, test } from "@playwright/test";
import { DEMO_SESSIONS } from "./demo-fixtures";
import { OPS_STAFF } from "./fixtures";

const operatorStatePath =
  process.env.DEMO_CAPTURE === "1"
    ? DEMO_SESSIONS.operator.statePath
    : OPS_STAFF.statePath;

test.describe("superadmin walkthrough QA environment", () => {
  test.use({ storageState: operatorStatePath });

  test("operator can reach the BSM operations MVP routes", async ({ page }) => {
    await page.goto("/ops", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Internal Operations" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Companies & ROs/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Production/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /BSM Content Approvals/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Superadmin/ })).toBeVisible();

    await page.goto("/ops/companies", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Companies", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New company" })).toBeVisible();

    await page.goto("/ops/production", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Production", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Print queue" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Historical" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent documents" })).toBeVisible();

    await page.goto("/ops/bsm-content-approvals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "BSM Content Approvals" })).toBeVisible();
    await expect(page.getByLabel("Shop")).toBeVisible();
    await expect(page.getByLabel("Review title")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review library" })).toBeVisible();

    await page.goto("/ops/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "User Access" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite user" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invite" })).toBeVisible();
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
