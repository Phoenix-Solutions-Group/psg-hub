import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const required = [
  "PSG_2968_REVIEWER_A_URL",
  "PSG_2968_REVIEWER_A_CODE",
  "PSG_2968_REVIEWER_B_URL",
  "PSG_2968_REVIEWER_B_CODE",
  "PSG_2968_DENIED_PROJECT_ID",
  "PSG_2968_DENIED_ROUND_ID",
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required secret reference: ${name}`);
}

const evidenceDir = "artifacts/PSG-2962";
await mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

async function exerciseReviewer(label, url, code, decision) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const failedResponses = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().replaceAll(/https?:\/\/[^\s]+/g, "[private URL]"));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
  });

  await page.goto(url, { waitUntil: "networkidle" });
  const codeField = page.getByLabel("One-time code");
  if ((await codeField.count()) === 0) {
    const safeHeadings = await page.locator("h1, h2").allTextContents();
    await page.screenshot({ path: `${evidenceDir}/${label}-unexpected-entry.png`, fullPage: true });
    throw new Error(
      `${label}: invitation did not open the code-entry screen (title=${JSON.stringify(await page.title())}, headings=${JSON.stringify(safeHeadings)})`,
    );
  }
  await codeField.fill(code);
  await page.getByRole("button", { name: "Open review" }).click();
  try {
    await page.getByRole("heading", { name: "PSG-2744 QA upload visibility 1786345705187" }).waitFor();
  } catch (error) {
    const safeHeadings = await page.locator("h1, h2").allTextContents();
    const safeAlerts = await page.locator('[role="alert"]').allTextContents();
    await page.screenshot({ path: `${evidenceDir}/${label}-code-submit-failed.png`, fullPage: true });
    throw new Error(
      `${label}: code submission did not open the workspace (headings=${JSON.stringify(safeHeadings)}, alerts=${JSON.stringify(safeAlerts)})`,
      { cause: error },
    );
  }

  const projectTitle = (await page.locator("h1").textContent())?.trim();
  const originalBody = await page.locator("body").innerText();
  if (!projectTitle || projectTitle !== "PSG-2744 QA upload visibility 1786345705187") {
    throw new Error(`${label}: unexpected project title`);
  }
  if ((await page.getByText("Review document · ready", { exact: true }).count()) !== 1) {
    throw new Error(`${label}: expected one prepared document`);
  }

  await page.screenshot({ path: `${evidenceDir}/${label}-intended-workspace.png`, fullPage: true });

  const tampered = new URL(page.url());
  tampered.searchParams.set("projectId", process.env.PSG_2968_DENIED_PROJECT_ID);
  tampered.searchParams.set("roundId", process.env.PSG_2968_DENIED_ROUND_ID);
  await page.goto(tampered.toString(), { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Enter your review code" }).waitFor();
  const tamperedBody = await page.locator("body").innerText();
  if (tamperedBody.includes(process.env.PSG_2968_DENIED_PROJECT_ID) || tamperedBody.includes(process.env.PSG_2968_DENIED_ROUND_ID)) {
    throw new Error(`${label}: denied target identifier was exposed`);
  }
  await page.screenshot({ path: `${evidenceDir}/${label}-denied-target.png`, fullPage: true });

  await page.getByLabel("One-time code").fill(code);
  await page.getByRole("button", { name: "Open review" }).click();
  await page.getByRole("heading", { name: "PSG-2744 QA upload visibility 1786345705187" }).waitFor();
  if ((await page.locator("h1").textContent())?.trim() !== projectTitle) throw new Error(`${label}: tampering changed the project`);
  const comment = `PSG-2962 ${label} private QA comment ${new Date().toISOString()}`;
  await page.getByLabel("Private comment").fill(comment);
  await page.getByRole("button", { name: "Add suggestion" }).click();
  await page.getByText(comment).waitFor();

  if (decision === "approved") await page.getByLabel("Approve", { exact: true }).check();
  else await page.getByLabel("Request changes", { exact: true }).check();
  await page.getByRole("button", { name: "Submit review" }).click();
  await page.getByText("Read-only after submit").waitFor();

  const submittedBody = await page.locator("body").innerText();
  const publishControlCount = await page.getByRole("button", { name: /publish/i }).count();
  if (publishControlCount !== 0 || /published publicly|make public/i.test(submittedBody)) {
    throw new Error(`${label}: reviewer was offered a publishing action`);
  }
  if (!submittedBody.includes(decision === "approved" ? "approved" : "changes requested")) {
    throw new Error(`${label}: submitted decision is not understandable in the summary`);
  }

  const submittedBy = page.getByText(/^Submitted by /);
  await page.screenshot({
    path: `${evidenceDir}/${label}-submitted-read-only.png`,
    fullPage: true,
    mask: (await submittedBy.count()) ? [submittedBy] : [],
  });

  results.push({
    reviewer: label,
    intendedProjectOnly: true,
    documentCount: 1,
    deniedTargetNotExposed: true,
    commentSaved: true,
    decision,
    readOnlyAfterSubmit: true,
    publishControls: publishControlCount,
    consoleErrors: errors.length,
    failedResponses,
  });
  await context.close();
}

try {
  await exerciseReviewer("reviewer-a", process.env.PSG_2968_REVIEWER_A_URL, process.env.PSG_2968_REVIEWER_A_CODE, "changes_requested");
  await exerciseReviewer("reviewer-b", process.env.PSG_2968_REVIEWER_B_URL, process.env.PSG_2968_REVIEWER_B_CODE, "approved");
  process.stdout.write(`${JSON.stringify({ result: "PASS", target: "https://hub.psgweb.me", results }, null, 2)}\n`);
} finally {
  await browser.close();
}
