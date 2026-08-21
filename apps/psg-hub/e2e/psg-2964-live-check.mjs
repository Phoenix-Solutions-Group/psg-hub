import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(appDir, ".env.test.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = "https://hub.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2964-retest");
fs.mkdirSync(evidenceDir, { recursive: true });
const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  expectedCommit: "b99762147858ad53e153b8d235679aee38c024aa",
  expectedDeployment: "dpl_2RjNqsBHsReZYnMKyLY2xVLyQwSV",
  servedDeployment: null,
  viewport: "1366x900",
  signedIn: false,
  onboardingOpened: false,
  fieldsUnderstandable: false,
  completionStatus: null,
  progressSaved: false,
  dashboardReached: false,
  usefulDashboardState: false,
  finalPath: null,
  visibleError: null,
  consoleErrors: [],
  failedResponses: [],
};

const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") result.consoleErrors.push(message.text());
});
page.on("response", (response) => {
  const deployment = response.headers()["link"]?.match(/[?&]dpl=([^>;]+)/)?.[1];
  if (deployment) result.servedDeployment = deployment;
  if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() });
  if (response.request().method() === "POST" && response.url().endsWith("/api/onboarding")) {
    result.completionStatus = response.status();
  }
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(env.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(env.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/onboarding)?(?:\/|$)/, { timeout: 20_000 });
  result.signedIn = true;

  await page.goto(`${baseUrl}/dashboard/onboarding`, { waitUntil: "networkidle" });
  await page.getByText("Your shop", { exact: true }).waitFor();
  result.onboardingOpened = true;
  result.fieldsUnderstandable =
    await page.getByLabel("Shop name").isVisible() &&
    await page.getByText("Step 1 of 3", { exact: true }).isVisible();
  await page.screenshot({ path: path.join(evidenceDir, "step-1.png"), fullPage: true });

  await page.getByLabel("Shop name").fill("Riverside Collision");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Street address").fill("1500 Center Park Rd");
  await page.getByLabel("City").fill("Lincoln");
  await page.getByLabel("State").fill("NE");
  await page.screenshot({ path: path.join(evidenceDir, "step-2.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Website URL").fill("https://example.com");
  await page.getByLabel("Phone").fill("(402) 555-0100");
  await page.screenshot({ path: path.join(evidenceDir, "step-3.png"), fullPage: true });

  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/onboarding")),
    page.getByRole("button", { name: "Complete setup", exact: true }).click(),
  ]);
  await page.waitForURL(/\/dashboard\/?$/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  result.finalPath = new URL(page.url()).pathname;
  result.dashboardReached = result.finalPath === "/dashboard" || result.finalPath === "/dashboard/";
  result.progressSaved = result.completionStatus === 200 && result.dashboardReached;
  result.usefulDashboardState =
    await page.getByText("Dashboard", { exact: true }).first().isVisible() &&
    (await page.locator("main").innerText()).trim().length > 100;
  await page.screenshot({ path: path.join(evidenceDir, "dashboard.png"), fullPage: true });
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  result.finalPath = new URL(page.url()).pathname;
  result.visibleError = await page.locator(".text-destructive, [role=alert]").allTextContents().catch(() => []);
  await page.screenshot({ path: path.join(evidenceDir, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed = result.signedIn && result.onboardingOpened && result.fieldsUnderstandable &&
  result.completionStatus === 200 && result.progressSaved && result.dashboardReached &&
  result.usefulDashboardState && result.servedDeployment === result.expectedDeployment;
if (!passed) process.exitCode = 1;
