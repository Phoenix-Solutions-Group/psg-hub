import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const repoDir = path.resolve(appDir, "../..");
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-3151");
const executablePath = path.join(
  repoDir,
  ".playwright-browsers/chromium-1223/chrome-linux64/chrome",
);
const baseUrl = process.env.PREVIEW_BASE_URL ?? process.env.DEMO_BASE_URL;
const email = process.env.PREVIEW_DEMO_SHOP_EMAIL ?? process.env.DEMO_SHOP_EMAIL;
const password =
  process.env.PREVIEW_DEMO_SHOP_PASSWORD ?? process.env.DEMO_SHOP_PASSWORD;
const shopId = process.env.PREVIEW_SHOP_ID ?? "d5e00000-0000-4000-8000-000000000010";

for (const [name, value] of Object.entries({ baseUrl, email, password })) {
  if (!value) throw new Error(`Missing required QA setting: ${name}`);
}

fs.mkdirSync(evidenceDir, { recursive: true });
const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  loginPassed: false,
  adsPagePassed: false,
  adsFinalUrl: null,
  adsBodyExcerpt: null,
  authorizeStatus: null,
  googlePageReached: false,
  redirectMismatchVisible: false,
  missingSecretVisible: false,
  consoleErrors: [],
  failedResponses: [],
};

const browser = await chromium.launch({ chromiumSandbox: false, executablePath });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") result.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      result.failedResponses.push({ status: response.status(), url: response.url() });
    }
  });

  await page.goto(new URL("/login", baseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
  result.loginPassed = true;

  await page.goto(
    new URL(`/dashboard/ads?shop_id=${encodeURIComponent(shopId)}`, baseUrl).href,
    { waitUntil: "networkidle" },
  );
  result.adsFinalUrl = page.url();
  result.adsBodyExcerpt = (await page.locator("body").innerText()).slice(0, 500);
  await page.screenshot({ path: path.join(evidenceDir, "ads-page.png"), fullPage: true });
  await page.getByRole("button", { name: "Link Google Ads" }).waitFor();
  result.adsPagePassed = true;

  const authorizeResponse = page.waitForResponse((response) =>
    response.url().includes("/api/ads/google/authorize") &&
    response.request().method() === "POST"
  );
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Link Google Ads" }).click();
  const [response, popup] = await Promise.all([authorizeResponse, popupPromise]);
  result.authorizeStatus = response.status();

  await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  const popupText = await popup.locator("body").innerText().catch(() => "");
  result.googlePageReached = popup.url().startsWith("https://accounts.google.com/");
  result.redirectMismatchVisible = /redirect_uri_mismatch/i.test(popupText);
  result.missingSecretVisible = /missing_secret|state missing_secret/i.test(popupText);
  await popup.screenshot({
    path: path.join(evidenceDir, "google-sign-in.png"),
    fullPage: true,
  });
  await context.close();
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(evidenceDir, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

if (
  !result.loginPassed ||
  !result.adsPagePassed ||
  result.authorizeStatus !== 200 ||
  !result.googlePageReached ||
  result.redirectMismatchVisible ||
  result.missingSecretVisible
) {
  process.exitCode = 1;
}
