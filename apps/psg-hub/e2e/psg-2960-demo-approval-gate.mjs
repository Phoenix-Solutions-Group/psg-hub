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

const baseUrl = "https://demo.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2960");
fs.mkdirSync(evidenceDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  reviewAddress: `${baseUrl}/dashboard/approvals`,
  role: "BSM shared demo shop owner",
  build: null,
  login: null,
  preparedItem: null,
  checks: [],
  mutationRequests: [],
  consoleErrors: [],
  failedResponses: [],
};

const browser = await chromium.launch({ chromiumSandbox: false });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") result.consoleErrors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() });
});
page.on("request", (request) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
    result.mutationRequests.push({ method: request.method(), path: new URL(request.url()).pathname });
  }
});

async function capture(label) {
  await page.screenshot({ path: path.join(evidenceDir, `${label}.png`), fullPage: true });
}

async function record(name, action, expected) {
  try {
    await action();
    result.checks.push({ name, passed: true, expected });
  } catch (error) {
    result.checks.push({
      name,
      passed: false,
      expected,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

try {
  const health = await page.request.get(`${baseUrl}/api/health`, { maxRedirects: 0 });
  const healthText = await health.text();
  result.build = {
    healthStatus: health.status(),
    deploymentId: health.headers()["x-vercel-id"] ?? null,
    deploymentBuild: healthText.match(/data-dpl-id="([^"]+)"/)?.[1] ?? null,
    commit: healthText.match(/[a-f0-9]{40}/i)?.[0] ?? null,
  };

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Email").fill(settings.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(settings.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
  result.login = { passed: true, finalPath: new URL(page.url()).pathname };

  await page.goto(result.reviewAddress, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByRole("heading", { name: "Content Review" }).waitFor();
  await capture("01-approval-list");

  const reviewLinks = page.locator('a[href^="/dashboard/approvals/content/"]');
  const count = await reviewLinks.count();
  if (count === 0) throw new Error("No prepared content item was available on the shared demo build.");
  const link = reviewLinks.first();
  result.preparedItem = { title: (await link.innerText()).trim(), href: await link.getAttribute("href") };
  await link.click();
  await page.getByRole("heading", { name: "Review content" }).waitFor();
  await capture("02-prepared-item");

  const comment = `PSG-2960 QA comment ${stamp}`;
  await record("Comment saves", async () => {
    await page.getByLabel("Comment").fill(comment);
    await page.getByRole("button", { name: "Add comment" }).click();
    await page.getByText(comment).first().waitFor();
    await capture("03-comment-saved");
  }, "The shop owner's comment appears in the review history.");

  await record("Request updates changes status", async () => {
    await page.getByLabel("Decision note").fill(`PSG-2960 request updates ${stamp}`);
    await page.getByRole("button", { name: "Request updates" }).click();
    await page.getByText("Request Updates").first().waitFor();
    await capture("04-updates-requested");
  }, "The item records a Request Updates decision.");

  await record("Approve changes status", async () => {
    await page.getByLabel("Decision note").fill(`PSG-2960 safe demo approval ${stamp}`);
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByText("Approve").first().waitFor();
    await capture("05-approved");
  }, "The safe demo item records an Approve decision without initiating publication.");

  await record("Decline changes status", async () => {
    await page.getByLabel("Decision note").fill(`PSG-2960 decline duplicate demo copy ${stamp}`);
    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByText("Decline").first().waitFor();
    await capture("06-declined");
  }, "The item records a Decline decision.");

  await record("Restore request saves", async () => {
    const reason = `PSG-2960 restore prior demo proof ${stamp}`;
    await page.getByLabel("Restore request").fill(reason);
    await page.getByRole("button", { name: "Request restore" }).click();
    await page.getByText(reason).first().waitFor();
    await capture("07-restore-requested");
  }, "The shop owner can request a prior version be restored; the request does not restore or publish automatically.");

  await record("Approval remains separate from publication", async () => {
    const body = await page.locator("body").innerText();
    const publicationRequests = result.mutationRequests.filter(({ path: requestPath }) =>
      /publish|release|deploy/i.test(requestPath),
    );
    if (publicationRequests.length > 0) {
      throw new Error(`Review actions unexpectedly called publication endpoints: ${JSON.stringify(publicationRequests)}`);
    }
    if (!/Declined/i.test(body)) {
      throw new Error("The item did not remain in the final safe demo decision state.");
    }
    await capture("08-publication-gate");
  }, "Comment, request-updates, approve, decline, and restore actions call only review endpoints; no publish, release, or deploy request occurs.");
} catch (error) {
  if (!result.login) result.login = { passed: false, error: error instanceof Error ? error.message : String(error) };
  result.fatalError = error instanceof Error ? error.message : String(error);
  await capture("fatal-state").catch(() => undefined);
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

if (result.fatalError || result.checks.length !== 6 || result.checks.some((check) => !check.passed)) {
  process.exitCode = 1;
}
