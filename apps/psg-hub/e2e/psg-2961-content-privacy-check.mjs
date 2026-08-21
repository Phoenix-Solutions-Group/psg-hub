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
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2961");
fs.mkdirSync(evidenceDir, { recursive: true });

const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  role: "BSM shared demo shop user",
  build: null,
  login: null,
  contentList: null,
  openedDraft: null,
  changeRequest: null,
  approval: null,
  anonymousPrivacy: null,
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

try {
  const health = await page.request.get(`${baseUrl}/api/health`);
  const healthText = await health.text();
  result.build = {
    status: health.status(),
    deploymentId: healthText.match(/data-dpl-id="([^"]+)"/)?.[1] ?? null,
    commit: healthText.match(/[a-f0-9]{40}/i)?.[0] ?? null,
  };

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByLabel("Email").fill(settings.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(settings.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
  result.login = { passed: true, finalPath: new URL(page.url()).pathname };

  const response = await page.goto(`${baseUrl}/dashboard/content`, { waitUntil: "networkidle", timeout: 30_000 });
  const rows = await page.locator("tbody tr").allTextContents();
  const links = await page.locator('a[href^="/dashboard/content/"]').evaluateAll((nodes) =>
    nodes.map((node) => ({ title: node.textContent?.trim() ?? "", href: node.getAttribute("href") })),
  );
  result.contentList = { status: response?.status() ?? null, rows, links };
  await page.screenshot({ path: path.join(evidenceDir, "01-content-list.png"), fullPage: true });

  const draftLink = links.find((link) => link.title === "Riverside August reputation post") ?? links[0];
  if (draftLink?.href) {
    const reviewPath = draftLink.href.replace("/dashboard/content/", "/dashboard/approvals/content/");
    const detailResponse = await page.goto(`${baseUrl}${reviewPath}`, { waitUntil: "networkidle", timeout: 30_000 });
    const body = await page.locator("body").innerText();
    const previewHref = await page.getByRole("link", { name: /open preview/i }).getAttribute("href").catch(() => null);
    result.openedDraft = {
      status: detailResponse?.status() ?? null,
      path: new URL(page.url()).pathname,
      title: draftLink.title,
      body,
      buttons: await page.getByRole("button").allTextContents(),
      previewHref,
    };
    await page.screenshot({ path: path.join(evidenceDir, "02-draft-detail.png"), fullPage: true });

    const note = page.getByLabel("Decision note");
    await note.fill("QA check: request one wording review; keep this content private.");
    const changeResponsePromise = page.waitForResponse((candidate) =>
      candidate.url().includes(`/api/bsm/content-approvals/`) && candidate.url().endsWith("/decision"),
    );
    await page.getByRole("button", { name: "Request updates" }).click();
    const changeResponse = await changeResponsePromise;
    await page.waitForTimeout(500);
    const changedBody = await page.locator("body").innerText();
    result.changeRequest = {
      responseStatus: changeResponse.status(),
      statusVisible: /Updates Requested/i.test(changedBody),
      publishControlVisible: await page.getByRole("button", { name: /publish/i }).count(),
    };
    await page.screenshot({ path: path.join(evidenceDir, "03-updates-requested-private.png"), fullPage: true });

    await note.fill("QA check: human review approval only; publication remains a separate step.");
    const approveResponsePromise = page.waitForResponse((candidate) =>
      candidate.url().includes(`/api/bsm/content-approvals/`) && candidate.url().endsWith("/decision"),
    );
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const approveResponse = await approveResponsePromise;
    await page.waitForTimeout(500);
    const approvedBody = await page.locator("body").innerText();
    result.approval = {
      responseStatus: approveResponse.status(),
      approvedVisible: /Approved/i.test(approvedBody),
      publishedVisible: /Published/i.test(approvedBody),
      publishControlVisible: await page.getByRole("button", { name: /publish/i }).count(),
    };
    await page.screenshot({ path: path.join(evidenceDir, "04-approved-not-published.png"), fullPage: true });

    const anonymous = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const anonymousPage = await anonymous.newPage();
    const privatePaths = [draftLink.href, reviewPath, ...(previewHref?.startsWith("/") ? [previewHref] : [])];
    const checks = [];
    for (const privatePath of privatePaths) {
      const privateResponse = await anonymousPage.goto(`${baseUrl}${privatePath}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      checks.push({
        requestedPath: privatePath,
        status: privateResponse?.status() ?? null,
        finalPath: new URL(anonymousPage.url()).pathname,
        redirectedToLogin: new URL(anonymousPage.url()).pathname === "/login",
      });
    }
    result.anonymousPrivacy = { checks };
    await anonymousPage.screenshot({ path: path.join(evidenceDir, "05-anonymous-login-wall.png"), fullPage: true });
    await anonymous.close();
  }
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

if (
  !result.login?.passed ||
  result.contentList?.status !== 200 ||
  !result.openedDraft ||
  result.changeRequest?.responseStatus !== 200 ||
  !result.changeRequest.statusVisible ||
  result.approval?.responseStatus !== 200 ||
  !result.approval.approvedVisible ||
  result.approval.publishedVisible ||
  result.approval.publishControlVisible !== 0 ||
  !result.anonymousPrivacy?.checks.every((check) => check.redirectedToLogin)
) process.exitCode = 1;
