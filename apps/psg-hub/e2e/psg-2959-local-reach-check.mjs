import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const settings = {};
for (const file of [".env.preview.local", ".env.test.local"]) {
  const filePath = path.join(appDir, file);
  if (!fs.existsSync(filePath)) continue;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) settings[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!settings[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = (process.env.DEMO_BASE_URL || settings.DEMO_BASE_URL || "https://demo.psgweb.me").replace(/\/$/, "");
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2959");
fs.mkdirSync(evidenceDir, { recursive: true });

const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  testRole: "BSM shared demo shop user",
  build: null,
  login: null,
  page: null,
  consoleErrors: [],
  failedResponses: [],
};

const repoChromium = path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome");
const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: fs.existsSync(repoChromium) ? repoChromium : undefined,
});
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

try {
  try {
    const health = await page.request.get(`${baseUrl}/api/health`, { maxRedirects: 0 });
    const healthText = await health.text();
    result.build = {
      healthStatus: health.status(),
      location: health.headers().location ?? null,
      deploymentId: health.headers()["x-vercel-id"] ?? null,
      deploymentBuild: healthText.match(/data-dpl-id="([^"]+)"/)?.[1] ?? null,
      commit: healthText.match(/[a-f0-9]{40}/i)?.[0] ?? null,
      responseExcerpt: healthText.slice(0, 300),
    };
  } catch (error) {
    result.build = { error: error instanceof Error ? error.message : String(error) };
  }

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Email").fill(settings.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(settings.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  try {
    await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
    result.login = { passed: true, finalPath: new URL(page.url()).pathname };
  } catch {
    result.login = { passed: false, finalPath: new URL(page.url()).pathname };
  }

  if (result.login.passed) {
    const response = await page.goto(`${baseUrl}/dashboard/local-reach`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    const body = await page.locator("body").innerText();
    result.page = {
      status: response?.status() ?? null,
      finalPath: new URL(page.url()).pathname,
      title: await page.title(),
      body,
    };
    await page.screenshot({ path: path.join(evidenceDir, "local-reach-full.png"), fullPage: true });
    await page.locator("body").screenshot({ path: path.join(evidenceDir, "local-reach-viewport.png") });
  }
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

if (!result.login?.passed || result.page?.status !== 200 || result.page?.finalPath !== "/dashboard/local-reach") {
  process.exitCode = 1;
}
