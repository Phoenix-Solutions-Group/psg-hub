import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const candidates = [];
for (const name of [".env.preview.local", ".env.test.local"]) {
  const file = path.join(appDir, name);
  if (!fs.existsSync(file)) continue;
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  if (env.DEMO_OPERATOR_EMAIL && env.DEMO_OPERATOR_PASSWORD) candidates.push({ name, env });
}
if (candidates.length === 0) throw new Error("Missing approved QA operator settings");

const baseUrl = "https://demo.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2965");
fs.mkdirSync(evidenceDir, { recursive: true });
const result = { checkedAt: new Date().toISOString(), baseUrl, role: "BSM demo admin", pages: [], consoleErrors: [], failedResponses: [] };

const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
page.on("console", (message) => { if (message.type() === "error") result.consoleErrors.push(message.text()); });
page.on("response", (response) => { if (response.status() >= 500) result.failedResponses.push({ status: response.status(), url: response.url() }); });

try {
  const health = await page.request.get(`${baseUrl}/api/health`, { maxRedirects: 0 });
  const healthText = await health.text();
  result.build = {
    status: health.status(),
    deploymentId: healthText.match(/data-dpl-id="([^"]+)"/)?.[1] ?? null,
    commit: healthText.match(/[a-f0-9]{40}/i)?.[0] ?? null,
    vercelRequestId: health.headers()["x-vercel-id"] ?? null,
  };

  result.loginAttempts = [];
  for (const candidate of candidates) {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByLabel("Email").fill(candidate.env.DEMO_OPERATOR_EMAIL);
    await page.getByLabel("Password").fill(candidate.env.DEMO_OPERATOR_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL(/\/ops(?:\/|$)/, { timeout: 12_000 }); } catch {}
    const attempt = { source: candidate.name, finalPath: new URL(page.url()).pathname, body: (await page.locator("body").innerText()).slice(0, 800) };
    result.loginAttempts.push(attempt);
    if (attempt.finalPath.startsWith("/ops") || attempt.finalPath.startsWith("/dashboard")) break;
  }
  result.login = { passed: /^(\/ops|\/dashboard)/.test(new URL(page.url()).pathname), finalPath: new URL(page.url()).pathname };
  if (!result.login.passed) throw new Error("Approved QA operator credentials did not authenticate");

  for (const [name, route] of [["ops", "/ops"], ["ro-import", "/ops/data-import/ros"], ["estimate-import", "/ops/data-import/estimates"], ["production", "/ops/production"]]) {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 30_000 });
    const body = await page.locator("body").innerText();
    result.pages.push({ name, route, status: response?.status() ?? null, finalPath: new URL(page.url()).pathname, title: await page.title(), body });
    await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
  }
  await page.goto(`${baseUrl}/ops/data-import/ros`, { waitUntil: "networkidle", timeout: 30_000 });
  const fallbackLink = page.locator("tr", { hasText: "Riverside Collision" }).getByRole("link", { name: /open wizard/i });
  const importHref = await fallbackLink.getAttribute("href");
  if (!importHref) throw new Error("Riverside import wizard link is missing");
  await page.goto(`${baseUrl}${importHref}`, { waitUntil: "networkidle", timeout: 30_000 });
  result.importWizard = { finalPath: new URL(page.url()).pathname, body: (await page.locator("body").innerText()).slice(0, 4000) };
  await page.screenshot({ path: path.join(evidenceDir, "riverside-import-wizard.png"), fullPage: true });

  await page.goto(`${baseUrl}/ops/production`, { waitUntil: "networkidle", timeout: 30_000 });
  const proofLinks = await page.getByRole("link", { name: /view proof/i }).evaluateAll((links) => links.map((link) => ({ text: link.textContent?.trim(), href: link.href })));
  result.proofLinks = proofLinks.map((link) => ({ text: link.text, available: Boolean(link.href), protocol: link.href ? new URL(link.href).protocol : null }));
  if (proofLinks[0]?.href) {
    const proofPage = await context.newPage();
    const proofResponse = await proofPage.goto(proofLinks[0].href, { waitUntil: "networkidle", timeout: 30_000 });
    result.preparedBatchProof = {
      status: proofResponse?.status() ?? null,
      title: await proofPage.title(),
      body: (await proofPage.locator("body").innerText()).slice(0, 4000),
    };
    await proofPage.screenshot({ path: path.join(evidenceDir, "prepared-batch-proof.png"), fullPage: true });
    await proofPage.close();
  }
} catch (error) {
  result.error = error instanceof Error ? error.stack : String(error);
  result.login ??= { passed: false, finalPath: new URL(page.url()).pathname };
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

if (result.error) process.exitCode = 1;
