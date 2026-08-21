import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const settings = {};
for (const line of fs.readFileSync(path.join(appDir, ".env.test.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) settings[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!settings[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = "https://hub.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2938");
fs.mkdirSync(evidenceDir, { recursive: true });

const routes = [
  ["analytics", "/dashboard/analytics", /Organic traffic|Marketing Analytics/i],
  ["ads", "/dashboard/ads", /Your Google Ads/i],
  ["settings", "/dashboard/settings", /Shop profile/i],
  ["content", "/dashboard/content", /Content/i],
  ["billing", "/dashboard/billing", /Manage your subscription and billing/i],
  ["approvals", "/dashboard/approvals", /Approvals|Content Review/i],
  ["reviews", "/dashboard/reviews", /Reviews/i],
];

const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  expectedBuild: "c543f1856a90a0ca9a3575b616c5a761f78ef95d",
  health: null,
  login: null,
  routes: [],
  crossShopApproval: null,
};

const browser = await chromium.launch({ chromiumSandbox: false });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();

try {
  const health = await page.request.get(`${baseUrl}/api/health`);
  result.health = {
    status: health.status(),
    contentType: health.headers()["content-type"] ?? null,
    approvedBuildIdentified: (await health.text()).includes(result.expectedBuild),
  };

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
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
    for (const [name, route, expected] of routes) {
      const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      const item = {
        name,
        path: route,
        status: response?.status() ?? null,
        stayedAuthenticated: !new URL(page.url()).pathname.startsWith("/login"),
        expectedContentVisible: expected.test(body),
      };
      result.routes.push(item);
      await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
    }

    const otherApprovalId = "22222222-bbbb-4bbb-8bbb-222222222222";
    const response = await page.goto(`${baseUrl}/dashboard/approvals/content/${otherApprovalId}`, {
      waitUntil: "networkidle",
    });
    const body = await page.locator("body").innerText();
    result.crossShopApproval = {
      status: response?.status() ?? null,
      denied: response?.status() === 404 && /404|not found/i.test(body),
      finalPath: new URL(page.url()).pathname,
    };
    await page.screenshot({ path: path.join(evidenceDir, "cross-shop-denied.png"), fullPage: true });
  }
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed =
  result.health?.status === 200 &&
  result.health.approvedBuildIdentified &&
  result.login?.passed &&
  result.routes.length === routes.length &&
  result.routes.every((route) => route.status === 200 && route.stayedAuthenticated && route.expectedContentVisible) &&
  result.crossShopApproval?.denied;

if (!passed) process.exitCode = 1;
