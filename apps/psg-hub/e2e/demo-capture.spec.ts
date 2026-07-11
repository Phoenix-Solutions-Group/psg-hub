import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  DEMO_SESSIONS,
  DEMO_SHOTS_DIR,
  getDemoCapturePlan,
} from "./demo-fixtures";

const capturePlan = getDemoCapturePlan();
const operatorPlan = capturePlan.filter((entry) => entry.session === "operator");
const shopPlan = capturePlan.filter((entry) => entry.session === "shop");

test.describe.configure({ mode: "parallel" });

if (capturePlan.length === 0) {
  test.skip(true, "[PSG-986] Set DEMO_CAPTURE_PLAN or DEMO_CAPTURE_OPS_ROUTES/DEMO_CAPTURE_SHOP_ROUTES.");
}

if (capturePlan.length > 0 && capturePlan.length !== 14) {
  test.skip(
    true,
    `[PSG-986] Expected 14 capture entries for PSG-351 dry-run, got ${capturePlan.length}.`,
  );
}

test.describe("PSG-986 demo capture (operator session)", () => {
  if (operatorPlan.length === 0) {
    test.skip(true, "No operator routes for this plan.");
  }

  test.use({ storageState: DEMO_SESSIONS.operator.statePath });

  test.beforeEach(async () => {
    fs.mkdirSync(DEMO_SHOTS_DIR, { recursive: true });
    const state = DEMO_SESSIONS.operator.statePath;
    expect(fs.existsSync(state), `missing storage state at ${state}`).toBeTruthy();
  });

  for (const route of operatorPlan) {
    test(`operator ${route.name}`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("PSG Internal Operations")).toBeVisible();
      await page.screenshot({
        path: path.join(DEMO_SHOTS_DIR, `${route.name}.png`),
        fullPage: true,
      });
    });
  }
});

test.describe("PSG-986 demo capture (shop session)", () => {
  if (shopPlan.length === 0) {
    test.skip(true, "No shop routes for this plan.");
  }

  test.use({ storageState: DEMO_SESSIONS.shop.statePath });

  test.beforeEach(async () => {
    fs.mkdirSync(DEMO_SHOTS_DIR, { recursive: true });
    const state = DEMO_SESSIONS.shop.statePath;
    expect(fs.existsSync(state), `missing storage state at ${state}`).toBeTruthy();
  });

  for (const route of shopPlan) {
    test(`shop ${route.name}`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      await page.screenshot({
        path: path.join(DEMO_SHOTS_DIR, `${route.name}.png`),
        fullPage: true,
      });
    });
  }
});
