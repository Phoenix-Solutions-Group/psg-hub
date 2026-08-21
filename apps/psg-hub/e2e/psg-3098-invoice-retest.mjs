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
const out = path.join(import.meta.dirname, "screenshots", "psg-3098");
const result = { checkedAt: new Date().toISOString(), base, consoleErrors: [], failedResponses: [] };
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
  const shopSwitcher = page.getByLabel("Active shop");
  const riversideOption = shopSwitcher.locator("option", { hasText: "Riverside Collision" });
  if (!(await riversideOption.count())) throw new Error("Riverside Collision is missing from Active shop");
  await shopSwitcher.selectOption(await riversideOption.getAttribute("value"));
  await page.waitForLoadState("networkidle");
  result.activeShop = await shopSwitcher.locator("option:checked").textContent();
  await page.goto(`${base}/dashboard/invoices`, { waitUntil: "networkidle" });
  const invoiceBody = await page.locator("body").innerText();
  result.invoiceList = ["RIV-DEMO-1001", "RIV-DEMO-1002", "RIV-DEMO-1003"].map(number => ({
    number,
    visible: invoiceBody.includes(number),
  }));
  await page.screenshot({ path: path.join(out, "Riverside-invoice-list-retest.png"), fullPage: true });
  const href = await page.getByRole("link", { name: "RIV-DEMO-1003", exact: true }).getAttribute("href");
  if (!href) throw new Error("RIV-DEMO-1003 is missing from the invoice list");
  await page.goto(new URL(href, base).href, { waitUntil: "networkidle" });
  const body = await page.locator("body").innerText();
  result.url = page.url();
  result.checks = {
    lineItemsTable: ["DESCRIPTION", "QTY.", "UNIT PRICE", "AMOUNT"].every(label => body.includes(label)),
    creativeItem: body.includes("August campaign creative"),
    managementItem: body.includes("Local advertising management"),
    total: /total/i.test(body) && body.includes("$1,250.00"),
    amountPaid: /amount paid/i.test(body) && body.includes("$0.00"),
    remainingBalance: /remaining balance|balance due|balance/i.test(body) && body.includes("$1,250.00"),
  };
  await page.screenshot({ path: path.join(out, "RIV-DEMO-1003-retest.png"), fullPage: true });
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
  result.failureUrl = page.url();
  result.failureBody = (await page.locator("body").innerText().catch(() => "")).slice(0, 2_000);
  await page.screenshot({ path: path.join(out, "invoice-retest-failure.png"), fullPage: true }).catch(() => {});
} finally {
  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(out, "invoice-retest-result.json"), `${JSON.stringify(result, null, 2)}\n`);
}

if (result.failure || result.activeShop?.trim() !== "Riverside Collision" ||
  !result.invoiceList?.every(item => item.visible) || !result.checks ||
  !Object.values(result.checks).every(Boolean)) process.exitCode = 1;
