import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const appDir = path.resolve(import.meta.dirname, "..");
const settings = {};
for (const line of fs.readFileSync(path.join(appDir, ".env.test.local"), "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match) settings[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

for (const key of ["DEMO_OPERATOR_EMAIL", "DEMO_OPERATOR_PASSWORD"]) {
  if (!settings[key]) throw new Error(`Missing required QA setting: ${key}`);
}

const baseUrl = "https://hub.psgweb.me";
const expectedBuild = "ba785d2a";
const evidenceDir = path.join(import.meta.dirname, "screenshots", "psg-2963-live");
fs.mkdirSync(evidenceDir, { recursive: true });

const result = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  handedOffBuild: expectedBuild,
  handedOffDeployment: "dpl_A1x25Tz2WtEW2ChpYFFNiX7hXwjK",
  observedBuild: "ab9e1a49859e25bba217d075eee805bea25485c9",
  observedDeployment: "dpl_E4rBRr6dYK8Y5nuo3W5FGebPGD3K",
  browser: "Playwright Chromium",
  viewport: "1366x900",
  role: "approved BSM demo operator",
  testData: "Riverside Collision demo data",
  livePage: null,
  unfinishedReportsClearlyLabeled: false,
  months: [],
  consoleErrors: [],
  failedResponses: [],
};

const browser = await chromium.launch({
  chromiumSandbox: false,
  executablePath: path.resolve(appDir, "../..", ".playwright-browsers/chromium-1223/chrome-linux64/chrome"),
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();

page.on("console", (message) => {
  if (message.type() === "error") result.consoleErrors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400) result.failedResponses.push({ status: response.status(), url: response.url() });
});

async function verifyMonth(label, start, end, expected) {
  await page.getByLabel("Start").fill(start);
  await page.getByLabel("End").fill(end);
  await page.getByRole("button", { name: "Run report" }).click();
  await page.getByRole("button", { name: "Run report" }).waitFor({ state: "visible" });
  const row = page.locator("tbody tr", { hasText: "Riverside Collision" });
  await row.waitFor();
  const cells = (await row.locator("td").allInnerTexts()).map((value) => value.trim());
  await page.screenshot({ path: path.join(evidenceDir, `${label.toLowerCase()}-onscreen.png`), fullPage: true });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV", exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = path.join(evidenceDir, `${label.toLowerCase()}-processing-recap.csv`);
  await download.saveAs(downloadPath);
  const csv = fs.readFileSync(downloadPath, "utf8").trim();
  const csvLines = csv.split(/\r?\n/);
  const csvRow = csvLines.find((line) => line.includes("Riverside Collision")) ?? null;
  const expectedCells = ["Riverside Collision", String(expected.opened), String(expected.closed), expected.processed];
  const expectedCsvCells = ["Riverside Collision", String(expected.opened), String(expected.closed), expected.csvProcessed];
  const screenMatches = expectedCells.every((value, index) => cells[index] === value);
  const csvMatches = Boolean(csvRow) && expectedCsvCells.every((value) => csvRow.includes(value));
  const exportUrl = new URL(download.url());
  const filterMatches = exportUrl.searchParams.get("start") === start && exportUrl.searchParams.get("end") === end;

  result.months.push({
    label,
    filter: { start, end },
    visibleCells: cells,
    expectedCells,
    expectedCsvCells,
    screenMatches,
    csvHeader: csvLines[0] ?? null,
    csvRow,
    csvMatches,
    exportFilterMatches: filterMatches,
  });
}

try {
  const livePageResponse = await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  result.livePage = { status: livePageResponse?.status() ?? null };
  await page.getByLabel("Email").fill(settings.DEMO_OPERATOR_EMAIL);
  await page.getByLabel("Password").fill(settings.DEMO_OPERATOR_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(?:ops|dashboard)(?:\/|$)/, { timeout: 20_000 });

  await page.goto(`${baseUrl}/ops/reports`, { waitUntil: "networkidle" });
  result.unfinishedReportsClearlyLabeled = (await page.getByText("Sample", { exact: true }).count()) > 0;
  await page.screenshot({ path: path.join(evidenceDir, "reports-index.png"), fullPage: true });

  await page.goto(`${baseUrl}/ops/reports/processing-recap`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Processing Recap" }).waitFor();
  await verifyMonth("July", "2026-07-01", "2026-07-31", {
    opened: 3,
    closed: 2,
    processed: "$8,500.00",
    csvProcessed: "8500",
  });
  await verifyMonth("August", "2026-08-01", "2026-08-31", {
    opened: 2,
    closed: 1,
    processed: "$4,750.00",
    csvProcessed: "4750",
  });
} finally {
  fs.writeFileSync(path.join(evidenceDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await context.close();
  await browser.close();
}

const passed =
  result.livePage?.status === 200 &&
  result.unfinishedReportsClearlyLabeled &&
  result.months.length === 2 &&
  result.months.every((month) => month.screenMatches && month.csvMatches && month.exportFilterMatches) &&
  result.failedResponses.length === 0;

process.stdout.write(`${JSON.stringify({ passed, ...result }, null, 2)}\n`);
if (!passed) process.exitCode = 1;
