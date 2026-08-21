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
fs.mkdirSync(out, { recursive: true });
const result = { checkedAt: new Date().toISOString(), base, owner: {}, staff: {}, isolated: {}, errors: [] };
const browser = await chromium.launch({ chromiumSandbox: false, executablePath: path.resolve(app, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome") });

async function login(email, password, viewport = { width: 1366, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("console", m => { if (m.type() === "error") result.errors.push(m.text()); });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  try {
    await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20000 });
  } catch (error) {
    const alert = await page.locator('[role="alert"]').allInnerTexts();
    throw new Error(`Sign-in did not reach the dashboard (${page.url()}); message: ${alert.join(" | ") || "none shown"}`);
  }
  return { context, page };
}

try {
  const { context, page } = await login(env.DEMO_SHOP_EMAIL, env.DEMO_SHOP_PASSWORD);
  const shopSwitcher = page.getByLabel("Active shop");
  if (await shopSwitcher.count()) {
    const riversideOption = shopSwitcher.locator("option", { hasText: "Riverside Collision" });
    if (await riversideOption.count()) {
      await shopSwitcher.selectOption(await riversideOption.getAttribute("value"));
      await page.waitForLoadState("networkidle");
    }
  }
  await page.goto(`${base}/dashboard/ads`, { waitUntil: "networkidle" });
  const requestTypes = ["budget_change", "campaign_status_change", "new_campaign", "ad_copy_change", "location_change", "destination_change", "performance_review", "problem_report"];
  const forms = [];
  if (await page.getByRole("button", { name: "Request a change" }).count() === 0) {
    throw new Error("Owner Ads page does not show the required Request a change button");
  }
  for (const type of requestTypes) {
    await page.getByRole("button", { name: "Request a change" }).click();
    await page.getByLabel("Request type").selectOption(type);
    const dialog = page.getByRole("dialog");
    const required = await dialog.locator("input[required], textarea[required], select[required]").count();
    await dialog.getByRole("button", { name: "Review request" }).click();
    forms.push({ type, required, stayedOnForm: await dialog.getByRole("button", { name: "Review request" }).isVisible() });
    await page.keyboard.press("Escape");
  }
  result.owner.ads = { requestTypes: forms };
  await page.screenshot({ path: path.join(out, "owner-ads-desktop.png"), fullPage: true });

  await page.goto(`${base}/dashboard/invoices`, { waitUntil: "networkidle" });
  const invoiceBody = await page.locator("body").innerText();
  result.owner.invoices = { hasThree: ["RIV-DEMO-1001", "RIV-DEMO-1002", "RIV-DEMO-1003"].every(x => invoiceBody.includes(x)) };
  const targetInvoice = page.getByRole("link", { name: "RIV-DEMO-1003", exact: true });
  const invoiceHref = await targetInvoice.getAttribute("href");
  result.owner.invoices.detailHref = invoiceHref;
  if (!invoiceHref) throw new Error("Seeded invoice has no detail link");
  await page.goto(new URL(invoiceHref, base).href, { waitUntil: "networkidle" });
  const detail = await page.locator("body").innerText();
  result.owner.invoices.detail = {
    lineItems: /line items/i.test(detail),
    creativeItem: detail.includes("August campaign creative"),
    managementItem: detail.includes("Local advertising management"),
    quantities: detail.includes("2") && detail.includes("1"),
    unitPricesAndAmounts: detail.includes("$400.00") && detail.includes("$800.00"),
    subtotal: detail.includes("$1,200.00"),
    total: /total/i.test(detail) && detail.includes("$1,250.00"),
    paid: /amount paid/i.test(detail) && detail.includes("$0.00"),
    balance: /balance/i.test(detail) && detail.includes("$1,250.00"),
  };
  await page.screenshot({ path: path.join(out, "owner-invoice-detail.png"), fullPage: true });

  await page.goto(`${base}/dashboard/reviews`, { waitUntil: "networkidle" });
  const draft = page.getByRole("button", { name: /Draft v\d+/ }).first();
  await draft.click();
  const dialog = page.getByRole("dialog");
  const comments = dialog.getByText(/Team comments/i);
  result.owner.reviews = { commentsVisible: await comments.isVisible() };
  const toggle = dialog.getByRole("button", { name: /team comments|comments/i }).first();
  if (await toggle.count()) { await toggle.click(); result.owner.reviews.collapsed = !(await dialog.locator("textarea").last().isVisible()); await toggle.click(); result.owner.reviews.restored = await comments.isVisible(); }
  await page.screenshot({ path: path.join(out, "owner-review-comments.png"), fullPage: true });
  await context.close();

  const staffSession = await login(env.DEMO_STAFF_EMAIL, env.DEMO_STAFF_PASSWORD);
  await staffSession.page.goto(`${base}/dashboard/ads`, { waitUntil: "networkidle" });
  const staffText = await staffSession.page.locator("body").innerText();
  result.staff = { explanation: /owner|manager|ask.*manager|permission/i.test(staffText), requestButtonCount: await staffSession.page.getByRole("button", { name: "Request a change" }).count() };
  await staffSession.page.screenshot({ path: path.join(out, "staff-ads.png"), fullPage: true });
  await staffSession.context.close();

  const isolatedSession = await login(env.DEMO_ISOLATED_SHOP_EMAIL, env.DEMO_ISOLATED_SHOP_PASSWORD);
  await isolatedSession.page.goto(`${base}/dashboard/invoices?shop_id=d5e00000-0000-4000-8000-000000000010`, { waitUntil: "networkidle" });
  const isolatedText = await isolatedSession.page.locator("body").innerText();
  result.isolated = { riversideInvoicesHidden: !/RIV-DEMO-100[123]/.test(isolatedText), finalUrl: isolatedSession.page.url() };
  await isolatedSession.page.screenshot({ path: path.join(out, "isolated-invoices.png"), fullPage: true });
  await isolatedSession.context.close();
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
  for (const context of browser.contexts()) {
    const page = context.pages().at(-1);
    if (page) await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
}
const invoiceDetailPassed = result.owner.invoices?.detail &&
  Object.values(result.owner.invoices.detail).every(Boolean);
if (result.failure || !invoiceDetailPassed) process.exitCode = 1;
