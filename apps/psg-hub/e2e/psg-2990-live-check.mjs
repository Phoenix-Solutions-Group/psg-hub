import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const env = {};
for (const line of fs.readFileSync(path.join(appDir, ".env.test.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!env[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = "https://hub.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2990-live");
fs.mkdirSync(evidenceDir, { recursive: true });
const uniqueComment = `PSG-2990 private QA note ${new Date().toISOString()}`;
const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  deployment: "dpl_62eWqZUqDr5BgZnLfChq8WqR3DaZ",
  commit: "f0db7145e1403875f2f5121daf2f878ade406f34",
  viewport: "1366x900",
  role: "BSM Riverside quality-assurance shop user",
  target: "Danielle Brooks — Draft v1",
  signedIn: false,
  targetOpened: false,
  teamCommentsVisible: false,
  addCommentVisible: false,
  commentPostStatus: null,
  commentVisibleAfterPost: false,
  commentVisibleAfterReload: false,
  unintendedMutationRequests: [],
  mutationRequests: [],
  decisionControlsUnchanged: false,
  consoleErrors: [],
  failedResponses: [],
  crossTenantCheck: "not-run-no-approved-second-shop-account",
  visibleError: null,
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
  if (response.request().method() === "POST" && /\/api\/reviews\/[^/]+\/comments/.test(response.url())) {
    result.commentPostStatus = response.status();
  }
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  const emailField = page.getByLabel("Email");
  const passwordField = page.getByLabel("Password");
  await emailField.waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  await emailField.fill(env.DEMO_SHOP_EMAIL);
  await passwordField.fill(env.DEMO_SHOP_PASSWORD);
  if (await emailField.inputValue() !== env.DEMO_SHOP_EMAIL) {
    throw new Error("QA email was not retained by the hydrated login form");
  }
  if (await passwordField.inputValue() !== env.DEMO_SHOP_PASSWORD) {
    throw new Error("QA password was not retained by the hydrated login form");
  }
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
  result.signedIn = true;

  await page.goto(`${baseUrl}/dashboard/reviews`, { waitUntil: "networkidle" });
  const row = page.locator("tbody tr").filter({ hasText: "Danielle Brooks" }).first();
  await row.waitFor();
  await row.getByRole("button", { name: "Draft v1", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Draft response" });
  await dialog.waitFor();
  result.targetOpened = true;
  result.teamCommentsVisible = await dialog.getByRole("heading", { name: "Team comments" }).isVisible();
  const commentField = dialog.locator("textarea").last();
  result.addCommentVisible = await commentField.isVisible() &&
    await dialog.getByRole("button", { name: "Add comment", exact: true }).isVisible();
  const approveBefore = await dialog.getByRole("button", { name: "Approve", exact: true }).isVisible();
  const rejectBefore = await dialog.getByRole("button", { name: "Reject", exact: true }).isVisible();
  const regenerateBefore = await dialog.getByRole("button", { name: "Regenerate", exact: true }).isVisible();
  await page.screenshot({ path: path.join(evidenceDir, "before-comment.png"), fullPage: true });

  const mutations = [];
  const listener = (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      mutations.push({ method: request.method(), url: request.url() });
    }
  };
  page.on("request", listener);
  await commentField.fill(uniqueComment);
  const [commentResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" &&
      /\/api\/reviews\/[^/]+\/comments/.test(response.url())),
    dialog.getByRole("button", { name: "Add comment", exact: true }).click(),
  ]);
  result.commentPostStatus = commentResponse.status();
  await dialog.getByText(uniqueComment, { exact: true }).waitFor();
  result.commentVisibleAfterPost = true;
  await page.screenshot({ path: path.join(evidenceDir, "after-comment.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.reload({ waitUntil: "networkidle" });
  const reloadedRow = page.locator("tbody tr").filter({ hasText: "Danielle Brooks" }).first();
  await reloadedRow.getByRole("button", { name: "Draft v1", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Draft response" });
  await dialog.waitFor();
  await dialog.getByText(uniqueComment, { exact: true }).waitFor({ timeout: 10_000 });
  result.commentVisibleAfterReload = true;
  result.decisionControlsUnchanged =
    approveBefore === await dialog.getByRole("button", { name: "Approve", exact: true }).isVisible() &&
    rejectBefore === await dialog.getByRole("button", { name: "Reject", exact: true }).isVisible() &&
    regenerateBefore === await dialog.getByRole("button", { name: "Regenerate", exact: true }).isVisible();
  page.off("request", listener);
  result.mutationRequests = mutations;
  result.unintendedMutationRequests = mutations.filter(({ url }) => !/\/api\/reviews\/[^/]+\/comments/.test(url));
  await page.screenshot({ path: path.join(evidenceDir, "after-reload.png"), fullPage: true });
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  result.visibleError = await page.locator('[role="alert"]').allTextContents().catch(() => []);
  await page.screenshot({ path: path.join(evidenceDir, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed = result.signedIn && result.targetOpened && result.teamCommentsVisible &&
  result.addCommentVisible && result.commentPostStatus === 200 && result.commentVisibleAfterPost &&
  result.commentVisibleAfterReload && result.decisionControlsUnchanged &&
  result.unintendedMutationRequests.length === 0;
if (!passed) process.exitCode = 1;
