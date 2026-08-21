import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const envFile = path.join(appDir, ".env.test.local");
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

for (const key of ["DEMO_BASE_URL", "DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2850-production");
fs.mkdirSync(evidenceDir, { recursive: true });

const browser = await chromium.launch({ chromiumSandbox: false });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const consoleErrors = [];
const failedResponses = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) {
    failedResponses.push({ status: response.status(), url: response.url() });
  }
});

const expectedTitle = "Riverside Collision July repair tips";
const result = {
  checkedAt: new Date().toISOString(),
  baseUrl: env.DEMO_BASE_URL,
  viewport: "1366x768",
  listUrl: null,
  detailUrl: null,
  titleVisible: false,
  reviewStatus: null,
  detailCopyVisible: false,
  loginFailureMessage: null,
  contentLinks: [],
  consoleErrors,
  failedResponses,
};

try {
  await page.goto(new URL("/login", env.DEMO_BASE_URL).href, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(env.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(env.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  try {
    await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
  } catch (error) {
    const pageText = await page.locator("body").innerText();
    result.loginFailureMessage =
      pageText.match(/invalid login credentials|email and password don't match|sign-in link.*|too many requests/i)?.[0] ??
      "Login returned to the sign-in page without a visible reason.";
    await page.getByLabel("Email").fill("").catch(() => undefined);
    await page.getByLabel("Password").fill("").catch(() => undefined);
    await page.screenshot({ path: path.join(evidenceDir, "login-failure-redacted.png"), fullPage: true });
    throw error;
  }

  await page.goto(new URL("/dashboard/content", env.DEMO_BASE_URL).href, {
    waitUntil: "networkidle",
  });
  result.listUrl = page.url();
  const articleLink = page.getByRole("link", { name: expectedTitle, exact: true });
  await articleLink.waitFor({ state: "visible", timeout: 20_000 });
  result.titleVisible = true;
  result.contentLinks = await page.locator('a[href^="/dashboard/content/"]').allTextContents();

  const bodyText = await page.locator("body").innerText();
  const statusMatch = bodyText.match(/pending review|ready for review|in review/i);
  if (!statusMatch) throw new Error("Expected review-ready status was not visible on the content list.");
  result.reviewStatus = statusMatch[0];
  await page.screenshot({ path: path.join(evidenceDir, "content-list.png"), fullPage: true });

  await articleLink.click();
  await page.waitForLoadState("networkidle");
  result.detailUrl = page.url();
  await page.getByRole("heading", { name: expectedTitle }).first().waitFor({ state: "visible" });
  await page.getByText("PSG prepared this customer-facing article", { exact: false }).waitFor({
    state: "visible",
  });
  result.detailCopyVisible = true;
  await page.screenshot({ path: path.join(evidenceDir, "content-detail.png"), fullPage: true });
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

if (failedResponses.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
