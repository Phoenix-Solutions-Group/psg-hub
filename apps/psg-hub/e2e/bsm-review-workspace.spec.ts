import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { OPS_STAFF, SHOTS_DIR } from "./fixtures";
import { checkA11y } from "./_helpers";

test.use({ storageState: OPS_STAFF.statePath });

async function screenshotEvidence(page: Page, name: string) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const [label, size] of [
    ["desktop", { width: 1280, height: 900 }],
    ["tablet", { width: 768, height: 1024 }],
    ["phone", { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(SHOTS_DIR, `${name}-${label}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("BSM review workspace release gate: admin creates, reviewer comments and submits once", async ({ page, context }) => {
  await page.goto("/ops/bsm-review-workspace");
  await expect(page.getByRole("heading", { name: "BSM Review Workspace" })).toBeVisible();
  await checkA11y(page, "bsm-review-workspace-admin-empty");

  await page.getByLabel("Workspace title").fill(`E2E review workspace ${Date.now()}`);
  await page.getByLabel("Reviewer email").fill("reviewer@e2e.test");
  await page.getByLabel("Reviewer name").fill("E2E Reviewer");
  await page.getByLabel("Document title").fill("Homepage release proof");
  await page.getByLabel("Review note").fill("Confirm the homepage proof before customer release.");
  await page.getByRole("button", { name: "Create workspace" }).click();

  const inviteLink = page.getByRole("link", { name: /\/review-workspace\?invite=/ });
  await expect(inviteLink).toBeVisible({ timeout: 15_000 });
  const invitePath = await inviteLink.textContent();
  const code = await page.getByTestId("invite-code").textContent();
  expect(invitePath).toContain("/review-workspace?invite=");
  expect(code).toMatch(/^\d{6}$/);
  await screenshotEvidence(page, "bsm-review-workspace-admin");

  const reviewer = await context.newPage();
  await reviewer.goto(invitePath!);
  await expect(reviewer.getByRole("heading", { name: "Enter your review code" })).toBeVisible();
  await reviewer.getByLabel("One-time code").fill(code!);
  await reviewer.getByRole("button", { name: "Open review" }).click();
  await expect(reviewer.getByRole("heading", { name: /E2E review workspace/ })).toBeVisible();
  await expect(reviewer.getByText("Homepage release proof")).toBeVisible();
  await checkA11y(reviewer, "bsm-review-workspace-reviewer-open");

  await reviewer.getByRole("button", { name: "Submit review" }).click();
  await expect(reviewer.getByText("Add at least one private comment before requesting changes.")).toBeVisible();

  await reviewer.getByLabel("Private comment").fill("Please update the warranty offer wording before approval.");
  await reviewer.getByRole("button", { name: "Add private comment" }).click();
  await expect(reviewer.getByText("Please update the warranty offer wording before approval.")).toBeVisible();
  await reviewer.getByLabel("Decision note").fill("The page is close, but the warranty offer needs clearer wording.");
  await reviewer.getByRole("button", { name: "Submit review" }).click();

  await expect(reviewer.getByText("Read-only after submit")).toBeVisible({ timeout: 15_000 });
  await expect(reviewer.getByRole("button", { name: "Submit review" })).toHaveCount(0);
  await screenshotEvidence(reviewer, "bsm-review-workspace-reviewer-submitted");

  await page.getByRole("button", { name: "Load result" }).click();
  await expect(page.getByText("changes requested")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Please update the warranty offer wording before approval.")).toBeVisible();
  await checkA11y(page, "bsm-review-workspace-admin-result");
});
