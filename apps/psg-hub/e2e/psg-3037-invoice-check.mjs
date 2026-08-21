import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const settings = {};
for (const line of fs.readFileSync(path.join(appDir, ".env.test.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) settings[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
for (const key of ["DEMO_SHOP_EMAIL", "DEMO_SHOP_PASSWORD"]) {
  if (!settings[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = "https://hub.psgweb.me";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-3037");
fs.mkdirSync(evidenceDir, { recursive: true });
const expected = [
  { number: "RIV-DEMO-1003", status: "Open", amount: "$1,250.00", date: "Aug 15, 2026", dueDate: "Aug 29, 2026", lines: ["August campaign creative", "1", "$750.00", "Local advertising management", "$450.00"], totals: ["$1,200.00", "$50.00", "$0.00", "$1,250.00"] },
  { number: "RIV-DEMO-1002", status: "Paid", amount: "$2,500.00", date: "Jul 15, 2026", dueDate: "Jul 29, 2026", lines: ["July growth marketing program", "1", "$2,000.00", "Campaign reporting and optimization", "$500.00"], totals: ["$2,500.00", "$0.00"] },
  { number: "RIV-DEMO-1001", status: "Void", amount: "$750.00", date: "Jun 15, 2026", dueDate: "Jun 29, 2026", lines: ["Campaign setup", "1", "$750.00"], totals: ["$750.00", "$0.00"] },
];
const result = {
  checkedAt: new Date().toISOString(), baseUrl, viewport: "1366x900", signedIn: false,
  shop: null, listUrl: null, listChecks: [], detailChecks: [], crossShopDenied: false, consoleErrors: [], failedResponses: [], error: null,
};
const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await context.newPage();
page.on("console", (message) => { if (message.type() === "error") result.consoleErrors.push(message.text()); });
page.on("response", (response) => {
  if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() });
});

try {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(settings.DEMO_SHOP_EMAIL);
  await page.getByLabel("Password").fill(settings.DEMO_SHOP_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 20_000 });
  result.signedIn = true;

  await page.getByText("Riverside Collision", { exact: true }).waitFor({ state: "visible" });
  const invoicesNav = page.getByRole("link", { name: "Invoices", exact: true }).first();
  const shopHref = await invoicesNav.getAttribute("href");
  const shopMatch = shopHref?.match(/\/dashboard\/shop\/([^/]+)/);
  if (!shopMatch) throw new Error(`Could not identify Riverside shop from link: ${shopHref}`);
  result.shop = "Riverside Collision";
  const listUrl = `${baseUrl}/dashboard/shop/${shopMatch[1]}/invoices`;
  result.listUrl = listUrl;
  await page.goto(listUrl, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Invoices", exact: true }).waitFor();
  for (const item of expected) {
    const row = page.locator("tbody tr").filter({ hasText: item.number }).first();
    const text = await row.innerText();
    result.listChecks.push({ ...item, found: true, statusVisible: text.includes(item.status), amountVisible: text.includes(item.amount), dateVisible: text.includes(item.date) });
  }
  await page.screenshot({ path: path.join(evidenceDir, "invoice-list.png"), fullPage: true });

  for (const item of expected) {
    const detailHref = await page.getByRole("link", { name: item.number, exact: true }).getAttribute("href");
    if (!detailHref) throw new Error(`Missing detail link for ${item.number}`);
    await page.goto(`${baseUrl}${detailHref}`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    const forbidden = await page.getByRole("link", { name: /pay invoice|view in stripe|download pdf/i }).count();
    result.detailChecks.push({
      number: item.number,
      headingVisible: body.includes(`Invoice ${item.number}`), statusVisible: body.includes(item.status),
      amountVisible: body.includes(item.amount), dateVisible: body.includes(item.date), forbiddenActionCount: forbidden,
      dueDateVisible: body.includes(item.dueDate), linesVisible: item.lines.every((value) => body.includes(value)),
      totalsVisible: item.totals.every((value) => body.includes(value)),
      stripeTextVisible: /stripe/i.test(body), testOnlyVisible: /test.only|test only|demo/i.test(body),
    });
    await page.screenshot({ path: path.join(evidenceDir, `${item.number}.png`), fullPage: true });
    await page.goto(listUrl, { waitUntil: "networkidle" });
  }

  const riversideInvoiceId = new URL(await page.getByRole("link", { name: "RIV-DEMO-1003", exact: true }).getAttribute("href"), baseUrl).pathname.split("/").at(-1);
  await page.goto(`${baseUrl}/dashboard/shop/00000000-0000-4000-8000-000000000099/invoices/${riversideInvoiceId}`, { waitUntil: "networkidle" });
  result.crossShopDenied = (await page.getByText("This page could not be found.", { exact: true }).count()) === 1;
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: path.join(evidenceDir, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed = result.signedIn && !result.error && result.listChecks.length === expected.length &&
  result.listChecks.every((check) => check.found && check.statusVisible && check.amountVisible && check.dateVisible) &&
  result.detailChecks.length === expected.length && result.detailChecks.every((check) =>
    check.headingVisible && check.statusVisible && check.amountVisible && check.dateVisible && check.dueDateVisible &&
    check.linesVisible && check.totalsVisible && check.forbiddenActionCount === 0) && result.crossShopDenied;
if (!passed) process.exitCode = 1;
