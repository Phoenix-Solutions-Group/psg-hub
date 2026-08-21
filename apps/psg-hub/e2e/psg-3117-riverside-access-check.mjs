import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const app = path.resolve(import.meta.dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(app, ".env.preview.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const base = "https://psg-86j2sa8zh-psg-digital.vercel.app";
const out = path.join(import.meta.dirname, "screenshots", "psg-3117");
fs.mkdirSync(out, { recursive: true });
const result = { checkedAt: new Date().toISOString(), base, checks: {}, consoleErrors: [], failedResponses: [] };
const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(app, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
page.on("console", message => { if (message.type() === "error") result.consoleErrors.push(message.text()); });
page.on("response", response => {
  if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() });
});

try {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(env.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(env.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
  result.checks.login = true;

  const switcher = page.getByLabel("Active shop");
  const option = switcher.locator("option", { hasText: "Riverside Collision" });
  result.checks.riversideAvailable = await option.count() === 1;
  if (!result.checks.riversideAvailable) throw new Error("Riverside Collision is missing from Active shop");
  await switcher.selectOption(await option.getAttribute("value"));
  await page.waitForLoadState("networkidle");
  result.checks.riversideSelected = (await switcher.locator("option:checked").innerText()).includes("Riverside Collision");

  await page.goto(`${base}/dashboard/invoices`, { waitUntil: "networkidle" });
  const listText = await page.locator("body").innerText();
  result.checks.allInvoicesVisible = ["RIV-DEMO-1001", "RIV-DEMO-1002", "RIV-DEMO-1003"].every(number => listText.includes(number));
  await page.screenshot({ path: path.join(out, "riverside-invoices.png"), fullPage: true });

  const href = await page.getByRole("link", { name: "RIV-DEMO-1003", exact: true }).getAttribute("href");
  if (!href) throw new Error("RIV-DEMO-1003 has no detail link");
  await page.goto(new URL(href, base).href, { waitUntil: "networkidle" });
  const detail = await page.locator("body").innerText();
  result.checks.invoiceDetail = {
    heading: detail.includes("RIV-DEMO-1003"),
    creativeLine: detail.includes("August campaign creative"),
    managementLine: detail.includes("Local advertising management"),
    subtotal: detail.includes("$1,200.00"),
    total: detail.includes("$1,250.00"),
    paid: detail.includes("$0.00"),
    balance: /balance/i.test(detail) && detail.includes("$1,250.00"),
    noPaymentAction: await page.getByRole("link", { name: /pay invoice|view in stripe|download pdf/i }).count() === 0,
  };
  await page.screenshot({ path: path.join(out, "RIV-DEMO-1003.png"), fullPage: true });

  const invoiceId = new URL(href, base).pathname.split("/").at(-1);
  await page.goto(`${base}/dashboard/shop/00000000-0000-4000-8000-000000000099/invoices/${invoiceId}`, { waitUntil: "networkidle" });
  result.checks.crossShopDenied = await page.getByText("This page could not be found.", { exact: true }).count() === 1;
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
  result.failureUrl = page.url();
  await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed = !result.failure && result.checks.login && result.checks.riversideAvailable &&
  result.checks.riversideSelected && result.checks.allInvoicesVisible &&
  Object.values(result.checks.invoiceDetail ?? {}).every(Boolean);
if (!passed) process.exitCode = 1;
