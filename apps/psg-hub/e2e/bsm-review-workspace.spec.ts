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
  const { data: existingShop, error: shopError } = await admin
    .from("shops")
    .select("id")
    .eq("slug", "riverside-collision")
    .maybeSingle();
  expect(shopError, shopError?.message).toBeNull();
  let shop = existingShop;
  if (!shop) {
    const fallback = await admin
      .from("shops")
      .select("id")
      .eq("name", OWNER.shopName)
      .limit(1)
      .maybeSingle();
    expect(fallback.error, fallback.error?.message).toBeNull();
    shop = fallback.data;
  }
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

test("retired BSM review workspace route redirects to Review Workspace", async ({ page }) => {
  await page.goto("/ops/bsm-review-workspace");
  await expect(page).toHaveURL(/\/ops\/bsm-content-approvals(?:\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Review Workspace" })).toBeVisible();
});

test("BSM content approvals release gate: admin creates, reviewer comments and submits once", async ({ page, context }) => {
  const shopId = await ensureContentApprovalsShopOption();
  const runId = Date.now();
  const workspaceTitle = `E2E review workspace ${runId}`;
  const documentTitle = `Homepage release proof ${runId}`;

  await page.goto("/ops/bsm-content-approvals");
  await expect(page.getByRole("heading", { name: "Review Workspace" })).toBeVisible();
  await checkA11y(page, "bsm-content-approvals-admin-empty");

  const manualShopInput = page.locator("input#bsm-approval-shop");
  if (await manualShopInput.isVisible()) {
    await manualShopInput.fill(shopId);
  }

  await page.getByLabel("Review name").fill(workspaceTitle);
  await page.getByLabel(/Client instructions/).fill("Confirm the homepage proof before customer release.");
  await page.getByRole("button", { name: "Continue to upload" }).click();
  await expect(page.getByText("The Review Workspace is ready for documents and reviewers.")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: "Generated page" }).click();
  await page.getByLabel("Proof title").fill(documentTitle);
  await page.getByLabel("Note for the reviewer").fill("Confirm the homepage proof before customer release.");
  await page.getByLabel("PSG page path").fill(`/generated/e2e/homepage-release-proof-${runId}`);
  await page.getByLabel(/Preview URL/).fill(`https://example.com/generated/e2e/homepage-release-proof-${runId}`);
  await page.getByRole("button", { name: "Add to review" }).click();
  await expect(page.getByText(documentTitle).first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("reviewer@e2e.test");
  await page.getByLabel(/Name/).fill("E2E Reviewer");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Send review" }).click();

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link and code" }).click();
  const invitation = await page.evaluate(() => navigator.clipboard.readText());
  const [invitePath, codeLine] = invitation.split("\n");
  const code = codeLine?.match(/^One-time code: (\d{6})$/)?.[1] ?? null;
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

  await reviewer.getByRole("button", { name: "Submit completed review" }).click();
  await expect(reviewer.getByText(`Choose Approve or Request changes for ${documentTitle}.`)).toBeVisible();

  await reviewer.getByLabel("Request changes").check();
  await reviewer.getByRole("button", { name: "Place pin" }).click();
  await reviewer.getByRole("button", { name: "Place comment pin on document" }).click({ position: { x: 260, y: 180 } });
  await reviewer.getByLabel("Private comment").fill("Please update the warranty offer wording before approval.");
  await reviewer.getByRole("button", { name: "Save private comment" }).click();
  await expect(reviewer.getByText("Please update the warranty offer wording before approval.")).toBeVisible();
  await reviewer.getByLabel("Decision note for this document").fill("The page is close, but the warranty offer needs clearer wording.");
  await reviewer.getByRole("button", { name: "Submit completed review" }).click();

  await expect(reviewer.getByText("Read-only after submit")).toBeVisible({ timeout: 15_000 });
  await expect(reviewer.getByRole("button", { name: "Submit completed review" })).toHaveCount(0);
  await screenshotEvidence(reviewer, "bsm-review-workspace-reviewer-submitted");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Review Workspace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByText("1 of 1 submitted")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Submitted feedback")).toBeVisible();
  const resultRow = page.getByRole("row", { name: new RegExp(documentTitle) });
  await expect(resultRow.getByText("changes requested")).toBeVisible({ timeout: 15_000 });
  await expect(resultRow.getByText("1 comments")).toBeVisible();
  await checkA11y(page, "bsm-content-approvals-admin-result");
});
