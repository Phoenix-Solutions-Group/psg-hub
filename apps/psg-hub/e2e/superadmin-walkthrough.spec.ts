import { expect, test } from "@playwright/test";
import { DEMO_SESSIONS } from "./demo-fixtures";
import { BSM_DEMO_ADMIN } from "./fixtures";
import { shoot } from "./_helpers";

const operatorStatePath =
  process.env.DEMO_CAPTURE === "1"
    ? DEMO_SESSIONS.operator.statePath
    : BSM_DEMO_ADMIN.statePath;
const operatorEmail =
  process.env.DEMO_CAPTURE === "1"
    ? process.env.DEMO_OPERATOR_EMAIL ?? BSM_DEMO_ADMIN.email
    : BSM_DEMO_ADMIN.email;

test.describe("clean BSM demo admin walkthrough", () => {
  test.use({ storageState: operatorStatePath });

  test("admin can set up and manage the BSM demo account", async ({ page }) => {
    await page.goto("/ops", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Internal Operations" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Companies & ROs/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Production", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "BSM Content Approvals", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Superadmin/ })).toBeVisible();
    await shoot(page, "focused-bsm-ops-home");

    await page.goto("/ops/companies", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Companies", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New company" })).toBeVisible();
    await shoot(page, "focused-bsm-ops-companies");

    await page.goto("/ops/production", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Production", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Print queue" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent documents" })).toBeVisible();
    await expect(page.getByLabel("Search production history")).toBeAttached();
    await shoot(page, "focused-bsm-ops-production");

    await page.goto("/ops/bsm-content-approvals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Content Approvals" })).toBeVisible();
    await expect(page.getByLabel("Shop", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Review title")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
    await shoot(page, "focused-bsm-ops-bsm-content-approvals");

    await page.goto("/ops/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "User Access" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite user" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invite" })).toBeVisible();
    await expect(page.getByText("Users and shop access")).toBeVisible();
    await expect(page.getByPlaceholder("Search users")).toBeVisible();
    await expect(page.getByRole("link", { name: /Create it in Companies first/ })).toBeVisible();
    const demoAdminCard = page.locator("article").filter({
      hasText: BSM_DEMO_ADMIN.displayName,
    });
    await expect(demoAdminCard.getByText(operatorEmail)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save role" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add shop access" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save tier" }).first()).toBeVisible();
    await expect(demoAdminCard.getByText("Current shop access").first()).toBeVisible();
    await expect(page.getByRole("option", { name: /Growth/ }).first()).toBeAttached();
    await expect(page.getByRole("option", { name: /Performance/ }).first()).toBeAttached();
    await shoot(page, "focused-bsm-ops-admin-users");

    await page.goto("/ops/admin/modules", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Module Access Matrix" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New module" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Deny" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Inherit" }).first()).toBeVisible();
    await shoot(page, "focused-bsm-ops-admin-modules");

    await page.goto("/ops/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Access Audit" })).toBeVisible();
    await expect(page.getByText("Append-only history of every privileged change")).toBeVisible();
    await shoot(page, "focused-bsm-ops-admin-audit");
  });
});
