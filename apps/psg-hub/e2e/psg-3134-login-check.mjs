import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-3134");
const baseUrl = "https://hub.psgweb.me";
const buildSha = "102dcab1f5c7b393c2dd206be72ee6d650889930";

for (const key of ["DEMO_OPERATOR_EMAIL", "DEMO_OPERATOR_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

fs.mkdirSync(evidenceDir, { recursive: true });
const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  buildSha,
  browser: "Playwright Chromium",
  freshContext: true,
  viewport: "1366x900",
  loginPageStatus: null,
  postSignInPath: null,
  finalPath: null,
  reportsVisible: false,
  returnedToLogin: null,
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
  if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() });
});

try {
  const response = await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  result.loginPageStatus = response?.status() ?? null;
  await page.getByLabel("Email").fill(process.env.DEMO_OPERATOR_EMAIL);
  await page.getByLabel("Password").fill(process.env.DEMO_OPERATOR_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(?:ops|dashboard)(?:\/|$)/, { timeout: 20_000 });
  result.postSignInPath = new URL(page.url()).pathname;
  await page.goto(`${baseUrl}/ops/reports`, { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  result.finalPath = new URL(page.url()).pathname;
  result.returnedToLogin = result.finalPath.startsWith("/login");
  result.reportsVisible = (await page.getByRole("heading", { name: /reports/i }).count()) > 0;
  await page.screenshot({ path: path.join(evidenceDir, "reports-after-login.png"), fullPage: true });
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
  result.finalPath = new URL(page.url()).pathname;
  result.returnedToLogin = result.finalPath.startsWith("/login");
  await page.screenshot({ path: path.join(evidenceDir, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  await context.close();
  await browser.close();
}

result.passed = !result.failure && result.loginPageStatus === 200 && result.finalPath === "/ops/reports" &&
  result.reportsVisible && result.returnedToLogin === false && result.failedResponses.length === 0;
fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
