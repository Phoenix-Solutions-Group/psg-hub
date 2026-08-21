import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loadQaEnv, projectRefFromUrl } from "./_qa-env.mjs";
import { signIn } from "./_sign-in.mjs";

const app = path.resolve(import.meta.dirname, "..");
// Credentials come from .env.test.local via the validated loader, which refuses a
// block whose Supabase URL and keys name different projects.
const qa = loadQaEnv("preview");
const email = qa.shopEmail;
const password = qa.shopPassword;

const base = "https://psg-mo8fnkjxp-psg-digital.vercel.app";
const expectedBuild = "065e696c626cc6294350de1aa83928478b5f529c";
const out = path.join(import.meta.dirname, "screenshots", "psg-2928");
fs.mkdirSync(out, { recursive: true });
const result = { checkedAt: new Date().toISOString(), base, expectedBuild, checks: {}, consoleErrors: [], failedResponses: [] };
const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(app, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
page.on("console", message => { if (message.type() === "error") result.consoleErrors.push(message.text()); });
page.on("response", response => { if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() }); });

// A preview pointed at the wrong Supabase project looks exactly like missing demo
// data. Measure the backend directly rather than inferring it from empty panels.
const observedProjects = new Set();
page.on("request", request => {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(request.url());
  if (match) observedProjects.add(match[1]);
});

try {
  const health = await page.request.get(`${base}/api/health`);
  const healthBody = await health.text();
  result.checks.health = { status: health.status(), healthy: /"status"\s*:\s*"ok"/i.test(healthBody) };

  const deployment = await page.request.get(`https://api.vercel.com/v13/deployments/${new URL(base).host}`, {
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  const deploymentBody = deployment.ok() ? await deployment.json() : {};
  result.checks.deployment = {
    status: deployment.status(),
    ready: deploymentBody.readyState === "READY",
    expectedBuild: deploymentBody.meta?.gitCommitSha === expectedBuild,
    observedBuild: deploymentBody.meta?.gitCommitSha ?? null,
  };

  const login = await signIn(page, { baseUrl: base, email, password });
  result.checks.login = login.ok;
  result.checks.backend = {
    expected: projectRefFromUrl(qa.supabaseUrl),
    observed: [...observedProjects],
  };
  result.checks.backend.matches =
    result.checks.backend.observed.length > 0 &&
    result.checks.backend.observed.every(ref => ref === result.checks.backend.expected);
  if (!login.ok) {
    result.loginFailure = {
      reason: login.reason,
      detail: login.detail,
      formError: login.formError ?? null,
      authCalls: login.authCalls?.map(({ emailPresent, status, message }) => ({ emailPresent, status, message })),
    };
    throw new Error(`Sign-in failed (${login.reason}): ${login.detail}`);
  }
  if (!result.checks.backend.matches) {
    throw new Error(
      `Preview is talking to Supabase project(s) [${result.checks.backend.observed.join(", ")}] but the ` +
        `approved demo data lives in "${result.checks.backend.expected}". Empty Analytics/Ads panels here ` +
        `mean the deployment's NEXT_PUBLIC_SUPABASE_URL is wrong, not that demo data is missing.`,
    );
  }

  const selectedShop = async () => (await page.locator("body").innerText()).includes("Riverside Collision")
    ? "Riverside Collision"
    : "not Riverside Collision";
  result.checks.dashboardShop = await selectedShop();

  await page.goto(`${base}/dashboard/analytics`, { waitUntil: "networkidle" });
  const analyticsText = await page.locator("body").innerText();
  result.checks.analytics = {
    shop: await selectedShop(),
    approvedDemoNotice: /seeded demo data/i.test(analyticsText),
    approvedMetrics: ["Organic traffic", "Keywords ranked", "Authority score", "Backlinks"].every(label => analyticsText.includes(label)),
    googleData: ["Sessions", "Users", "Key events", "Clicks", "Impressions"].every(label => analyticsText.includes(label)),
  };
  await page.screenshot({ path: path.join(out, "analytics.png"), fullPage: true });

  await page.getByRole("link", { name: /^Ads$/i }).click();
  await page.waitForURL(/\/dashboard\/ads/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  const adsText = await page.locator("body").innerText();
  result.checks.ads = {
    shop: await selectedShop(),
    connectedDemoState: ["Collision Repair Search", "Riverside Local Services", "Riverside Brand Search"].every(label => adsText.includes(label)),
    performanceMetrics: ["Spend", "Conversions", "Clicks", "Impressions"].every(label => adsText.includes(label)),
    notConnectionPrompt: !/connect (?:your )?google ads/i.test(adsText),
  };
  await page.screenshot({ path: path.join(out, "ads.png"), fullPage: true });
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
  result.failureUrl = page.url();
  await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed = !result.failure && result.checks.login && result.checks.backend?.matches && result.checks.health?.status === 200 &&
  result.checks.health.healthy && result.checks.deployment?.ready && result.checks.deployment.expectedBuild &&
  [result.checks.dashboardShop, result.checks.analytics?.shop, result.checks.ads?.shop].every(name => name === "Riverside Collision") &&
  Object.entries(result.checks.analytics ?? {}).filter(([key]) => key !== "shop").every(([, value]) => value === true) &&
  Object.entries(result.checks.ads ?? {}).filter(([key]) => key !== "shop").every(([, value]) => value === true);
if (!passed) process.exitCode = 1;
