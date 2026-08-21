import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-3135");
const baseUrl = "https://hub.psgweb.me";
for (const key of ["DEMO_OPERATOR_EMAIL", "DEMO_OPERATOR_PASSWORD"]) {
  if (!process.env[key]) throw new Error(`Missing required QA setting: ${key}`);
}
fs.mkdirSync(evidenceDir, { recursive: true });

const result = { checkedAt: new Date().toISOString(), baseUrl, deployment: "dpl_4WvDz7DLZgtRXttzBAA19nbx5ure", buildSha: "102dcab1f5c7b393c2dd206be72ee6d650889930", freshContext: true, role: "approved Riverside QA account", login: {}, months: [], consoleErrors: [], failedResponses: [] };
const browser = await chromium.launch({ chromiumSandbox: false, executablePath: path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome") });
const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on("console", m => { if (m.type() === "error") result.consoleErrors.push(m.text()); });
page.on("response", r => { if (r.status() >= 400) result.failedResponses.push({ status: r.status(), url: r.url() }); });

async function redactAccount() {
  await page.locator(`text=${process.env.DEMO_OPERATOR_EMAIL}`).evaluateAll(nodes => nodes.forEach(node => { node.textContent = "QA account redacted"; })).catch(() => {});
}

async function verifyMonth(label, start, end, expected) {
  await page.getByLabel("Start").fill(start);
  await page.getByLabel("End").fill(end);
  await page.getByRole("button", { name: "Run report" }).click();
  const rows = page.locator("tbody tr");
  await rows.first().waitFor();
  await page.waitForFunction(
    values => document.querySelector("tbody tr")?.textContent?.includes(values.opened) && document.querySelector("tbody tr")?.textContent?.includes(values.closed) && document.querySelector("tbody tr")?.textContent?.includes(values.processed),
    { opened: String(expected.opened), closed: String(expected.closed), processed: expected.processed },
  );
  const rowCount = await rows.count();
  const cells = (await rows.first().locator("td").allInnerTexts()).map(v => v.trim());
  const expectedScreen = ["Riverside Collision", String(expected.opened), String(expected.closed), expected.processed];
  await redactAccount();
  await page.screenshot({ path: path.join(evidenceDir, `${label.toLowerCase()}-redacted.png`), fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = path.join(evidenceDir, `${label.toLowerCase()}-processing-recap.csv`);
  await download.saveAs(downloadPath);
  const csvLines = fs.readFileSync(downloadPath, "utf8").trim().split(/\r?\n/);
  const dataRows = csvLines.slice(1).filter(Boolean);
  const expectedCsv = `Riverside Collision,${expected.opened},${expected.closed},${expected.csvProcessed}`;
  const url = new URL(download.url());
  result.months.push({ label, start, end, rowCount, visibleCells: cells, expectedScreen, screenMatches: cells.every((v, i) => v === expectedScreen[i]), csvHeader: csvLines[0], csvDataRows: dataRows, csvMatches: dataRows.length === 1 && dataRows[0] === expectedCsv, exportFilterMatches: url.searchParams.get("start") === start && url.searchParams.get("end") === end, onlyRiversideVisible: rowCount === 1 && cells[0] === "Riverside Collision" });
}

try {
  const response = await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  result.login.status = response?.status() ?? null;
  await page.getByLabel("Email").fill(process.env.DEMO_OPERATOR_EMAIL);
  await page.getByLabel("Password").fill(process.env.DEMO_OPERATOR_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(?:ops|dashboard)(?:\/|$)/, { timeout: 20_000 });
  result.login.postSignInPath = new URL(page.url()).pathname;
  await page.goto(`${baseUrl}/ops/reports`, { waitUntil: "networkidle" });
  result.login.reportsPath = new URL(page.url()).pathname;
  result.login.reportsVisible = await page.getByRole("heading", { name: /reports/i }).count() > 0;
  await page.goto(`${baseUrl}/ops/reports/processing-recap`, { waitUntil: "networkidle" });
  await verifyMonth("July", "2026-07-01", "2026-07-31", { opened: 3, closed: 2, processed: "$8,500.00", csvProcessed: 8500 });
  await verifyMonth("August", "2026-08-01", "2026-08-31", { opened: 2, closed: 1, processed: "$4,750.00", csvProcessed: 4750 });
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
} finally {
  await context.close();
  await browser.close();
}
result.monthChanged = result.months.length === 2 && JSON.stringify(result.months[0].visibleCells) !== JSON.stringify(result.months[1].visibleCells);
result.passed = !result.failure && result.login.status === 200 && result.login.reportsPath === "/ops/reports" && result.login.reportsVisible && result.monthChanged && result.months.length === 2 && result.months.every(m => m.screenMatches && m.csvMatches && m.exportFilterMatches && m.onlyRiversideVisible) && result.consoleErrors.length === 0 && result.failedResponses.length === 0;
fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.passed) process.exitCode = 1;
