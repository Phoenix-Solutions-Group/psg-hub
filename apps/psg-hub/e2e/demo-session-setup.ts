import { expect, test as setup } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  DEMO_SESSIONS,
  getDemoSessionCredentials,
  type DemoSessionRole,
  type DemoSessionFixture,
} from "./demo-fixtures";

async function typeIntoField(
  page: import("@playwright/test").Page,
  label: string,
  value: string,
): Promise<void> {
  const locator = page.getByLabel(label).or(page.getByPlaceholder(label));
  await expect(locator).toBeVisible();
  await locator.fill(value);
}

async function login(page: import("@playwright/test").Page, role: DemoSessionRole): Promise<void> {
  const creds = getDemoSessionCredentials(role);
  const session = DEMO_SESSIONS[role];

  await page.goto("/login");
  await page.waitForLoadState("domcontentloaded");
  await typeIntoField(page, "Email", creds.email);
  await typeIntoField(page, "Password", creds.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(ops|dashboard)\b/, { timeout: 20_000 });
  await page.goto(session.defaultPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 });
}

setup("create short-lived demo sessions", async ({ browser }) => {
  fs.mkdirSync(path.dirname(DEMO_SESSIONS.operator.statePath), { recursive: true });

  for (const role of Object.values(DEMO_SESSIONS) as DemoSessionFixture[]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, role.role);
    await context.storageState({ path: role.statePath });
    await context.close();
  }
});
