import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const repoDir = path.resolve(appDir, "../..");
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-3096");
const executablePath = path.join(repoDir, ".playwright-browsers/chromium-1223/chrome-linux64/chrome");
const baseUrl = process.env.DEMO_BASE_URL ?? "https://hub.psgweb.me";
const shopId = "d5e00000-0000-4000-8000-000000000010";

for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

fs.mkdirSync(evidenceDir, { recursive: true });
const result = { checkedAt: new Date().toISOString(), baseUrl, shopId, viewports: [] };
const browser = await chromium.launch({ chromiumSandbox: false, executablePath });

try {
  for (const viewport of [{ name: "desktop", width: 1366, height: 768 }, { name: "phone", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedResponses = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
    });

    await page.goto(new URL("/login", baseUrl).href, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(process.env.DEMO_SHOP_EMAIL);
    await page.getByLabel("Password").fill(process.env.DEMO_SHOP_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    try {
      await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
    } catch {
      result.viewports.push({
        viewport: `${viewport.width}x${viewport.height}`,
        requestedUrl: new URL("/login", baseUrl).href,
        finalUrl: page.url(),
        loginPassed: false,
        bodyTextExcerpt: (await page.locator("body").innerText()).slice(0, 500),
        consoleErrors,
        failedResponses,
      });
      await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}-login-failure.png`), fullPage: true });
      await context.close();
      continue;
    }

    const requestedUrl = new URL(`/dashboard/ads?shop_id=${shopId}`, baseUrl).href;
    const response = await page.goto(requestedUrl, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    const bodyHtml = await page.locator("body").innerHTML();
    const item = {
      viewport: `${viewport.width}x${viewport.height}`,
      loginPassed: true,
      requestedUrl,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      contentType: response?.headers()["content-type"] ?? null,
      riversideVisible: /Riverside Collision/i.test(bodyText),
      adsVisible: /Your Google Ads/i.test(bodyText),
      safeRequestCopyVisible: /Nothing you submit here changes a live campaign or your spending/i.test(bodyText),
      rawMarkupVisible: /<!doctype html|<html[\s>]|<body[\s>]|__next_f\.push/i.test(bodyText),
      bodyTextExcerpt: bodyText.slice(0, 500),
      bodyHtmlLength: bodyHtml.length,
      consoleErrors,
      failedResponses,
    };
    result.viewports.push(item);
    await page.screenshot({ path: path.join(evidenceDir, `${viewport.name}.png`), fullPage: true });

    if (viewport.name === "desktop") {
      const requestResponse = page.waitForResponse((candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().includes(`/api/shops/${shopId}/google-ads/requests`),
      );
      await page.getByRole("button", { name: "Request a change" }).click();
      await page.getByLabel("Request type").selectOption("performance_review");
      await page.getByLabel("What would you like us to review?").fill("DEMO QA — confirm Riverside advertising summary is clear");
      await page.getByLabel("Which time period?").fill("July 2026");
      await page.getByRole("button", { name: "Review request" }).click();
      await page.getByText("I understand this is a request").click();
      await page.getByRole("button", { name: "Send for PSG review" }).click();
      const submitted = await requestResponse;
      const successMessage = "Request received — waiting for PSG review. Nothing changed in Google Ads.";
      await page.getByRole("status").filter({ hasText: successMessage }).waitFor({ state: "visible" });
      item.submission = {
        status: submitted.status(),
        successMessageVisible: await page.getByText(successMessage, { exact: true }).isVisible(),
        finalUrl: page.url(),
      };
      await page.screenshot({ path: path.join(evidenceDir, "desktop-request-result.png"), fullPage: true });
    }
    await context.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

const passed = result.viewports.every((item) =>
  item.status === 200 &&
  item.loginPassed &&
  item.finalUrl === item.requestedUrl &&
  item.contentType?.startsWith("text/html") &&
  item.riversideVisible &&
  item.adsVisible &&
  item.safeRequestCopyVisible &&
  !item.rawMarkupVisible &&
  item.consoleErrors.length === 0 &&
  item.failedResponses.length === 0
) && result.viewports.find((item) => item.viewport === "1366x768")?.submission?.status < 300 &&
  result.viewports.find((item) => item.viewport === "1366x768")?.submission?.successMessageVisible;

if (!passed) process.exitCode = 1;
