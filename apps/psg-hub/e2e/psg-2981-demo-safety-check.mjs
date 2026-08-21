import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2981");
fs.mkdirSync(evidenceDir, { recursive: true });

const settings = {};
for (const name of [".env.preview.local", ".env.test.local"]) {
  const file = path.join(appDir, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) settings[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
if (!settings.DEMO_OPERATOR_EMAIL || !settings.DEMO_OPERATOR_PASSWORD) {
  throw new Error("Missing approved QA demo operator settings");
}

const baseUrl = "https://demo.psgweb.me";
const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  role: "BSM demo admin",
  consoleErrors: [],
  failedResponses: [],
  mutations: [],
};
const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") result.consoleErrors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() });
  if (response.request().method() !== "GET") {
    result.mutations.push({ method: response.request().method(), status: response.status(), url: response.url() });
  }
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Email").fill(settings.DEMO_OPERATOR_EMAIL);
  await page.getByLabel("Password").fill(settings.DEMO_OPERATOR_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(ops|dashboard)(?:\/|$)/, { timeout: 20_000 });

  await page.goto(`${baseUrl}/ops/production/templates`, { waitUntil: "networkidle", timeout: 30_000 });
  const templateBody = await page.locator("body").innerText();
  const liveReleaseButtons = await page.getByRole("button", { name: /live release disabled in demo/i }).count();
  result.templates = {
    finalPath: new URL(page.url()).pathname,
    body: templateBody,
    build: templateBody.match(/Main-branch build:\s*([^\s]+)/i)?.[1] ?? null,
    safeModeVisible: /Safe review mode is on/i.test(templateBody),
    paidLobBlockedVisible: /cannot .*create a paid Lob mail order/i.test(templateBody),
    historyVisible: /Approval and status history/i.test(templateBody),
    liveReleaseButtons,
    allLiveReleaseButtonsDisabled:
      liveReleaseButtons > 0 &&
      (await page.getByRole("button", { name: /live release disabled in demo/i }).evaluateAll((buttons) =>
        buttons.every((button) => button.disabled),
      )),
  };
  await page.screenshot({ path: path.join(evidenceDir, "mail-template-safe-mode.png"), fullPage: true });

  await page.goto(`${baseUrl}/ops/data-import/ros`, { waitUntil: "networkidle", timeout: 30_000 });
  const importHref = await page.locator("tr", { hasText: "Riverside Collision" }).getByRole("link", { name: /open wizard/i }).getAttribute("href");
  if (!importHref) throw new Error("Riverside import wizard link missing");
  await page.goto(`${baseUrl}${importHref}`, { waitUntil: "networkidle", timeout: 30_000 });

  const fixtureUrl = `${baseUrl}/demo-fixtures/riverside-import-safety-demo.csv`;
  const fixtureResponse = await context.request.get(fixtureUrl);
  const fixtureBody = await fixtureResponse.body();
  result.fixture = { url: fixtureUrl, status: fixtureResponse.status(), bytes: fixtureBody.length };
  if (!fixtureResponse.ok()) throw new Error(`Fixture download failed (${fixtureResponse.status()})`);

  await page.locator('input[type="file"]').setInputFiles({
    name: "riverside-import-safety-demo.csv",
    mimeType: "text/csv",
    buffer: fixtureBody,
  });
  await page.getByRole("button", { name: /parse & validate/i }).click();
  await page.getByText(/1 ready .* 1 invalid .* 2 safely excluded .* 4 total/i).waitFor({ timeout: 20_000 });
  const previewBody = await page.locator("body").innerText();
  result.preview = { body: previewBody };
  await page.screenshot({ path: path.join(evidenceDir, "riverside-import-preview.png"), fullPage: true });

  const commitButton = page.getByRole("button", { name: /^Commit 1 valid RO$/i });
  result.preview.exactCommitButton = (await commitButton.count()) === 1;
  if (result.preview.exactCommitButton) {
    await commitButton.click();
    await page.getByText(/Imported\s+\d+\s+·\s+skipped/i).waitFor({ timeout: 20_000 });
    result.commit = { body: await page.locator("body").innerText() };
    await page.screenshot({ path: path.join(evidenceDir, "riverside-import-commit.png"), fullPage: true });
  }
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  await page.screenshot({ path: path.join(evidenceDir, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

if (result.error) process.exitCode = 1;
