import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const appDir = path.resolve(import.meta.dirname, "..");
const envFile = path.join(appDir, ".env.test.local");
const env = {};
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

for (const key of [
  "DEMO_SHOP_EMAIL",
  "DEMO_SHOP_PASSWORD",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  if (!env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = "https://hub.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2966-live");
fs.mkdirSync(evidenceDir, { recursive: true });

const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  viewport: "1366x900",
  role: "BSM Riverside demo shop user",
  pageUrl: null,
  reviewsLoaded: false,
  sentimentLoaded: false,
  proposedResponseLoaded: false,
  commentControlAvailable: false,
  approvalControlAvailable: false,
  openAndEditDidNotWrite: false,
  crossTenantWriteDenied: false,
  crossTenantStatus: null,
  mutatingRequestsFromOpenAndEdit: [],
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
  if (response.status() >= 400) {
    result.failedResponses.push({ status: response.status(), url: response.url() });
  }
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(env.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(env.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });

  await page.goto(`${baseUrl}/dashboard/reviews`, { waitUntil: "networkidle" });
  result.pageUrl = page.url();
  await page.getByRole("heading", { name: "Reviews", exact: true }).waitFor();

  const rows = page.locator("tbody tr");
  result.reviewsLoaded = (await rows.count()) > 0;
  if (!result.reviewsLoaded) throw new Error("No Riverside reviews were visible.");
  result.sentimentLoaded = (await rows.first().locator("td").nth(3).innerText()).trim() !== "—";
  await page.screenshot({ path: path.join(evidenceDir, "reviews-list.png"), fullPage: true });

  const existingDraftButton = page.getByRole("button", { name: /Draft v\d+/ }).first();
  if (!(await existingDraftButton.isVisible().catch(() => false))) {
    throw new Error("No existing proposed response draft was available for a non-destructive check.");
  }

  const mutating = [];
  const requestListener = (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      mutating.push({ method: request.method(), url: request.url() });
    }
  };
  page.on("request", requestListener);

  await existingDraftButton.click();
  const dialog = page.getByRole("dialog", { name: "Draft response" });
  await dialog.waitFor();
  const responseBody = dialog.getByLabel("Response body");
  const originalText = await responseBody.inputValue();
  result.proposedResponseLoaded = originalText.trim().length > 0;
  result.commentControlAvailable = await dialog.getByLabel("Add a team comment").isVisible();
  result.approvalControlAvailable = await dialog.getByRole("button", { name: "Approve", exact: true }).isVisible();
  await page.screenshot({ path: path.join(evidenceDir, "response-draft.png"), fullPage: true });

  await responseBody.fill(`${originalText} `);
  await dialog.getByRole("button", { name: "Close" }).click();
  await existingDraftButton.click();
  await dialog.waitFor();
  result.openAndEditDidNotWrite = (await dialog.getByLabel("Response body").inputValue()) === originalText;
  await dialog.getByRole("button", { name: "Close" }).click();
  page.off("request", requestListener);
  result.mutatingRequestsFromOpenAndEdit = mutating;

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: riverside } = await admin.from("shops").select("id").eq("slug", "riverside-collision").single();
  const { data: foreignReview } = await admin
    .from("review_items")
    .select("id")
    .neq("shop_id", riverside.id)
    .limit(1)
    .maybeSingle();
  if (!foreignReview) throw new Error("No non-Riverside review was available for the isolation check.");

  const crossTenantResponse = await context.request.post(
    `${baseUrl}/api/reviews/${foreignReview.id}/comments`,
    { data: { body: "PSG-2966 authorization check only" } },
  );
  result.crossTenantStatus = crossTenantResponse.status();
  result.crossTenantWriteDenied = [403, 404].includes(crossTenantResponse.status());
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed =
  result.reviewsLoaded &&
  result.sentimentLoaded &&
  result.proposedResponseLoaded &&
  result.commentControlAvailable &&
  result.approvalControlAvailable &&
  result.openAndEditDidNotWrite &&
  result.crossTenantWriteDenied &&
  result.mutatingRequestsFromOpenAndEdit.length === 0;

if (!passed) process.exitCode = 1;
