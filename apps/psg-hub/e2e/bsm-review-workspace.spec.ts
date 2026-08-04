import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { OPS_STAFF, OWNER, SHOTS_DIR } from "./fixtures";
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

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureContentApprovalsShopOption() {
  const admin = adminClient();
  const { data: shop, error: shopError } = await admin
    .from("shops")
    .select("id")
    .eq("slug", "riverside-collision")
    .single();
  expect(shopError, shopError?.message).toBeNull();
  expect(shop?.id, "seeded Riverside shop id").toBeTruthy();

  const { data: existing, error: existingError } = await admin
    .from("companies")
    .select("id, status")
    .eq("shop_id", shop!.id)
    .eq("name", OWNER.shopName)
    .limit(1);
  expect(existingError, existingError?.message).toBeNull();
  if (existing?.[0]) {
    if (existing[0].status !== "active") {
      const { error: updateError } = await admin
        .from("companies")
        .update({ status: "active" })
        .eq("id", existing[0].id);
      expect(updateError, updateError?.message).toBeNull();
    }
    return shop!.id as string;
  }

  const { error: insertError } = await admin.from("companies").insert({
    name: OWNER.shopName,
    shop_id: shop!.id,
    status: "active",
  });
  expect(insertError, insertError?.message).toBeNull();
  return shop!.id as string;
}

test("retired BSM review workspace route redirects to Content Approvals", async ({ page }) => {
  await page.goto("/ops/bsm-review-workspace");
  await expect(page).toHaveURL(/\/ops\/bsm-content-approvals$/);
  await expect(page.getByRole("heading", { name: "Content Approvals" })).toBeVisible();
});

test("BSM content approvals release gate: admin creates, reviewer comments and submits once", async ({ page, context }) => {
  const shopId = await ensureContentApprovalsShopOption();
  const runId = Date.now();
  const workspaceTitle = `E2E review workspace ${runId}`;
  const documentTitle = `Homepage release proof ${runId}`;

  await page.goto("/ops/bsm-content-approvals");
  await expect(page.getByRole("heading", { name: "Content Approvals" })).toBeVisible();
  await checkA11y(page, "bsm-content-approvals-admin-empty");

  const manualShopInput = page.locator("input#bsm-approval-shop");
  if (await manualShopInput.isVisible()) {
    await manualShopInput.fill(shopId);
  }

  await page.getByLabel("Workspace title").fill(workspaceTitle);
  await page.getByLabel("Reviewer instructions").fill("Confirm the homepage proof before customer release.");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("The Review Workspace is ready for documents and reviewers.")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Generated page" }).click();
  await page.getByLabel("Review title").fill(documentTitle);
  await page.getByLabel("Context note for the customer").fill("Confirm the homepage proof before customer release.");
  await page.getByLabel("Generated page path").fill(`/generated/e2e/homepage-release-proof-${runId}`);
  await page.getByLabel("Preview URL").fill(`https://example.com/generated/e2e/homepage-release-proof-${runId}`);
  await page.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(page.getByText("The item is attached to the selected Review Workspace.")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Reviewer email").fill("reviewer@e2e.test");
  await page.getByLabel("Reviewer name").fill("E2E Reviewer");
  await page.getByRole("button", { name: "Add reviewer" }).click();
  await page.getByRole("button", { name: "Start review" }).click();

  const inviteLink = page.getByRole("link", { name: /\/review-workspace\?invite=/ });
  await expect(inviteLink).toBeVisible({ timeout: 15_000 });
  const invitePath = await inviteLink.textContent();
  const code = await page.getByText(/^\d{6}$/).last().textContent();
  expect(invitePath).toContain("/review-workspace?invite=");
  expect(code).toMatch(/^\d{6}$/);
  await screenshotEvidence(page, "bsm-content-approvals-admin");

  const reviewer = await context.newPage();
  await reviewer.goto(invitePath!);
  await expect(reviewer.getByRole("heading", { name: "Enter your review code" })).toBeVisible();
  await reviewer.getByLabel("One-time code").fill(code!);
  await reviewer.getByRole("button", { name: "Open review" }).click();
  await expect(reviewer.getByRole("heading", { name: workspaceTitle })).toBeVisible();
  await expect(reviewer.getByText(documentTitle).first()).toBeVisible();
  await checkA11y(reviewer, "bsm-review-workspace-reviewer-open");

  await reviewer.getByRole("button", { name: "Submit review" }).click();
  await expect(reviewer.getByText("Add at least one private comment before requesting changes.")).toBeVisible();

  await reviewer.getByLabel("Private comment").fill("Please update the warranty offer wording before approval.");
  await reviewer.getByRole("button", { name: "Add comment to selected document" }).click();
  await expect(reviewer.getByText("Please update the warranty offer wording before approval.")).toBeVisible();
  await reviewer.getByLabel("Decision note").fill("The page is close, but the warranty offer needs clearer wording.");
  await reviewer.getByRole("button", { name: "Submit review" }).click();

  await expect(reviewer.getByText("Read-only after submit")).toBeVisible({ timeout: 15_000 });
  await expect(reviewer.getByRole("button", { name: "Submit review" })).toHaveCount(0);
  await screenshotEvidence(reviewer, "bsm-review-workspace-reviewer-submitted");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Content Approvals" })).toBeVisible();
  const resultRow = page.getByRole("row", { name: new RegExp(documentTitle) });
  await expect(resultRow.getByText("changes requested")).toBeVisible({ timeout: 15_000 });
  await expect(resultRow.getByText("1 comments")).toBeVisible();
  await checkA11y(page, "bsm-content-approvals-admin-result");
});
