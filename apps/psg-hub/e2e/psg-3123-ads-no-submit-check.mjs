import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const app = path.resolve(import.meta.dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(app, ".env.preview.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DEMO_STAFF_EMAIL", "DEMO_STAFF_PASSWORD"]) {
  if (!env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const base = "https://psg-mqfxfkbzm-psg-digital.vercel.app";
const shopId = "d5e00000-0000-4000-8000-000000000010";
const out = path.join(import.meta.dirname, "screenshots", "psg-3123");
fs.mkdirSync(out, { recursive: true });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const requests = [
  { type: "budget_change", fields: { "Requested monthly budget": "3000", "Why do you want this change?": "QA preview only", "When would you like it?": "2026-09-01" } },
  { type: "campaign_status_change", fields: { "Pause or restart?": "Pause", "Why?": "QA preview only", "Requested date": "2026-09-02", "If pausing, until when?": "September 15" } },
  { type: "new_campaign", fields: { "Service to promote": "Fleet repair", "Offer or message": "QA preview only", "Area to cover": "Riverside", "Start date": "2026-09-03", "Monthly budget guidance": "2500" } },
  { type: "ad_copy_change", fields: { "What is wrong?": "QA preview only", "Exact new wording": "Certified aluminum repair", "Why should it change?": "QA preview only" } },
  { type: "location_change", fields: { "Current area": "Riverside", "Requested cities, ZIP codes, or radius": "Riverside and Moreno Valley" } },
  { type: "destination_change", fields: { "New phone number": "951-555-0100" } },
  { type: "performance_review", fields: { "What would you like us to review?": "QA preview only", "Which time period?": "Last 30 days" } },
  { type: "problem_report", fields: { "What is wrong?": "QA preview only", Example: "Yesterday and today match exactly", "When did it happen?": "This morning" } },
];

async function snapshot() {
  const [requestRows, campaigns] = await Promise.all([
    admin.from("google_ads_customer_requests").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    admin.from("google_ads_campaigns").select("id,status,daily_budget_micros").eq("shop_id", shopId).order("id"),
  ]);
  if (requestRows.error) throw requestRows.error;
  if (campaigns.error) throw campaigns.error;
  return { requestCount: requestRows.count, campaignCount: campaigns.data.length, campaignHash: crypto.createHash("sha256").update(JSON.stringify(campaigns.data)).digest("hex") };
}

const result = { checkedAt: new Date().toISOString(), base, shop: "Riverside Collision", before: await snapshot(), viewports: [] };
const browser = await chromium.launch({ chromiumSandbox: false, executablePath: path.resolve(app, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome") });
try {
  for (const viewport of [{ name: "desktop", width: 1366, height: 768 }, { name: "phone", width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const item = { viewport: `${viewport.width}x${viewport.height}`, checks: [], consoleErrors: [], failedResponses: [] };
    page.on("console", message => { if (message.type() === "error") item.consoleErrors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) item.failedResponses.push({ status: response.status(), url: response.url().replace(/\?.*$/, "") }); });
    try {
      await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
      await page.getByLabel("Email").fill(env.DEMO_STAFF_EMAIL);
      await page.getByLabel("Password").fill(env.DEMO_STAFF_PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
      const switcher = page.getByLabel("Active shop");
      const option = switcher.locator("option", { hasText: "Riverside Collision" });
      if (await option.count()) await switcher.selectOption(await option.getAttribute("value"));
      await page.goto(`${base}/dashboard/ads`, { waitUntil: "networkidle" });
      item.finalPath = new URL(page.url()).pathname;
      item.riversideVisible = /Riverside Collision/i.test(await page.locator("body").innerText());
      item.requestButtonVisible = await page.getByRole("button", { name: "Request a change" }).isVisible();
      await page.screenshot({ path: path.join(out, `${viewport.name}-ads-page.png`), fullPage: true });

      for (const request of requests) {
        await page.getByRole("button", { name: "Request a change" }).click();
        await page.getByLabel("Request type").selectOption(request.type);
        if (!["new_campaign", "performance_review", "problem_report"].includes(request.type)) {
          await page.getByRole("combobox", { name: "Campaign", exact: true }).selectOption({ index: 1 });
        }
        const requiredFields = [];
        for (const [label, value] of Object.entries(request.fields)) {
          const field = page.getByLabel(label);
          requiredFields.push({ label, required: await field.getAttribute("required") !== null });
          await field.fill(value);
        }
        await page.getByRole("button", { name: "Review request" }).click();
        const sendVisible = await page.getByRole("button", { name: "Send for PSG review" }).isVisible();
        const acknowledgementVisible = await page.getByText("I understand this is a request").isVisible();
        item.checks.push({ type: request.type, requiredFields, reviewReached: sendVisible && acknowledgementVisible });
        if (request.type === "budget_change" || request.type === "problem_report") {
          await page.screenshot({ path: path.join(out, `${viewport.name}-${request.type}-review.png`), fullPage: true });
        }
        await page.getByRole("button", { name: "Back" }).click();
        await page.getByRole("button", { name: "Cancel" }).click();
      }
    } catch (error) {
      item.failure = error instanceof Error ? error.message : String(error);
      item.failurePath = new URL(page.url()).pathname;
      await page.screenshot({ path: path.join(out, `${viewport.name}-failure.png`), fullPage: true }).catch(() => {});
    }
    result.viewports.push(item);
    await context.close();
  }
} finally {
  await browser.close();
}
result.after = await snapshot();
result.unchanged = JSON.stringify(result.before) === JSON.stringify(result.after);
result.passed = result.unchanged && result.viewports.every(item => !item.failure && item.finalPath === "/dashboard/ads" && item.riversideVisible && item.requestButtonVisible && item.checks.length === 8 && item.checks.every(check => check.reviewReached && check.requiredFields.every(field => field.required)) && item.consoleErrors.length === 0 && item.failedResponses.length === 0);
fs.writeFileSync(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
