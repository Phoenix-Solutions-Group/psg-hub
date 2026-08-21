import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const app = path.resolve(import.meta.dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(app, ".env.preview.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const base = "https://psg-86j2sa8zh-psg-digital.vercel.app";
const out = path.join(import.meta.dirname, "screenshots", "psg-3110");
fs.mkdirSync(out, { recursive: true });
const result = { checkedAt: new Date().toISOString(), base, staff: {}, isolated: {}, errors: [] };
const browser = await chromium.launch({ chromiumSandbox: false, executablePath: path.resolve(app, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome") });

async function login(email, password) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.on("console", message => { if (message.type() === "error") result.errors.push(message.text()); });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20000 });
  return { context, page };
}

try {
  const staff = await login(env.DEMO_STAFF_EMAIL, env.DEMO_STAFF_PASSWORD);
  await staff.page.goto(`${base}/dashboard/ads`, { waitUntil: "networkidle" });
  const staffText = await staff.page.locator("body").innerText();
  result.staff = {
    explanationShown: /owner or manager can send requests/i.test(staffText),
    requestButtonCount: await staff.page.getByRole("button", { name: "Request a change" }).count(),
    shop: (await staff.page.locator("aside, nav").first().innerText()).split("\n")[0],
  };
  await staff.page.screenshot({ path: path.join(out, "staff-ads.png"), fullPage: true });
  await staff.context.close();

  const isolated = await login(env.DEMO_ISOLATED_SHOP_EMAIL, env.DEMO_ISOLATED_SHOP_PASSWORD);
  await isolated.page.goto(`${base}/dashboard/invoices?shop_id=d5e00000-0000-4000-8000-000000000010`, { waitUntil: "networkidle" });
  const isolatedText = await isolated.page.locator("body").innerText();
  result.isolated = {
    riversideInvoicesHidden: !/RIV-DEMO-100[123]/.test(isolatedText),
    finalPath: new URL(isolated.page.url()).pathname,
  };
  await isolated.page.screenshot({ path: path.join(out, "isolated-invoices.png"), fullPage: true });
  await isolated.context.close();
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}
if (result.failure || !result.staff.explanationShown || result.staff.requestButtonCount !== 0 || !result.isolated.riversideInvoicesHidden) process.exitCode = 1;
