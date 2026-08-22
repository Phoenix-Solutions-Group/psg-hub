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
  await expect(page.getByRole("heading", { name: "Review Workspace", exact: true })).toBeVisible();
});

test("Content Wireframe Round Trip", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const shopId = await ensureContentApprovalsShopOption();
  const runId = Date.now();
  const workspaceTitle = `Content wireframe ${runId}`;
  const documentTitle = `Homepage content ${runId}`;
  const reviewerEmail = `wireframe-${runId}@e2e.test`;
  const initialMarkdown = "# Repairs without surprises\n\nClear updates from estimate through delivery.\n\n[CTA: Request an estimate](/estimate)";
  const revisedMarkdown = "# Collision repair with clear updates\n\nKnow what happens from estimate through delivery.\n\n[CTA: Request an estimate](/estimate)";
  const secondMarkdown = "# Collision repair with clear updates\n\nKnow what happens from estimate through delivery, with one point of contact.\n\n[CTA: Request an estimate](/estimate)";

  await page.goto("/ops/bsm-content-approvals");
  const manualShopInput = page.locator("input#bsm-approval-shop");
  if (await manualShopInput.isVisible()) await manualShopInput.fill(shopId);
  await page.getByLabel("Review name").fill(workspaceTitle);
  await page.getByLabel(/Client instructions/).fill("Review copy and structure before design production.");
  await page.getByRole("button", { name: "Continue to upload" }).click();
  await expect(page.getByText("The Review Workspace is ready for documents and reviewers.")).toBeVisible({ timeout: 15_000 });

  await page.locator("#bsm-approval-file").setInputFiles({
    name: "homepage.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(initialMarkdown),
  });
  await page.getByLabel("Proof title").fill(documentTitle);
  await page.getByRole("button", { name: "Add to review" }).click();
  await expect(page.getByText(documentTitle).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Edit Markdown" }).click();
  await expect(page.getByRole("heading", { name: "Create Content Draft" })).toBeVisible();
  await page.getByRole("button", { name: "Clone current Markdown version" }).click();
  await expect(page.getByLabel("Markdown source")).toHaveValue(initialMarkdown);

  const editorUrl = page.url();
  const [, projectId, documentId] = /bsm-content-approvals\/([^/]+)\/documents\/([^/]+)\/edit/.exec(editorUrl) ?? [];
  expect(projectId).toBeTruthy();
  expect(documentId).toBeTruthy();
  const secondAdmin = await context.newPage();
  await secondAdmin.goto(editorUrl);
  await expect(secondAdmin.getByLabel("Markdown source")).toHaveValue(initialMarkdown);

  await page.getByLabel("Markdown source").fill(revisedMarkdown);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
  await secondAdmin.getByLabel("Markdown source").fill(`${revisedMarkdown}\n\nStale second session.`);
  const conflictAlert = secondAdmin.getByRole("alert").filter({ hasText: "Conflict" });
  await expect(conflictAlert).toBeVisible({ timeout: 10_000 });
  await expect(conflictAlert.locator("pre").first()).toContainText("Stale second session.");
  await expect(conflictAlert.locator("pre").nth(1)).toContainText("Collision repair with clear updates");
  await secondAdmin.close();

  await page.getByLabel("Upload image").setInputFiles({
    name: "shop.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await expect(page.getByText("shop.png")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Publish check" }).click();
  await page.getByLabel(/Version note/).fill("Clarified the hero and added the selected shop image.");
  await expect(
    page.getByRole("region", { name: "Publish check" }).locator("p").filter({ hasText: "does not approve final design or production launch" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish immutable version" }).click();
  await expect(page.getByText(/No Review Invitations were sent/)).toBeVisible({ timeout: 15_000 });

  const admin = adminClient();
  const beforeSend = await admin.from("bsm_content_review_invitations").select("id").eq("project_id", projectId!);
  expect(beforeSend.error, beforeSend.error?.message).toBeNull();
  expect(beforeSend.data).toHaveLength(0);
  const storedAsset = await admin.from("bsm_content_review_assets").select("id, storage_bucket, storage_path").eq("review_item_id", documentId!).single();
  expect(storedAsset.error, storedAsset.error?.message).toBeNull();
  expect(storedAsset.data!.storage_bucket).toBe("bsm-content-approvals");
  expect(storedAsset.data!.storage_path).toContain(`/${projectId}/${documentId}/assets/`);

  await page.getByRole("link", { name: "Back to Content Approvals" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(reviewerEmail);
  await page.getByLabel(/Name/).fill("Wireframe Reviewer");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Send review" }).click();
  const firstInvitation = page.getByRole("group", { name: "Invitation for Wireframe Reviewer" });
  const firstInvitePath = await firstInvitation.getByRole("link", { name: "Private review link" }).getAttribute("href");
  const firstCode = (await firstInvitation.getByLabel("One-time code").textContent())?.trim();
  expect(firstCode).toMatch(/^\d{6}$/);

  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await reviewerContext.newPage();
    await reviewer.goto(new URL(firstInvitePath!, page.url()).toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    await expect(reviewer.getByLabel("One-time code")).toBeVisible({ timeout: 15_000 });
    await reviewer.getByLabel("One-time code").fill(firstCode!);
    await reviewer.getByRole("button", { name: "Open review" }).click();
    await expect(reviewer.getByRole("heading", { name: "Collision repair with clear updates", exact: true })).toBeVisible();
    await expect(reviewer.getByText("Clarified the hero and added the selected shop image.")).toBeVisible();
    await expect(reviewer.getByText("Content and structure review only")).toBeVisible();

    await reviewer.getByLabel("Request changes").check();
    await reviewer.getByRole("button", { name: "Place pin" }).click();
    await reviewer.getByRole("button", { name: "Place comment pin on document" }).click({ position: { x: 200, y: 150 } });
    await reviewer.getByLabel("Private comment").fill("Pin: strengthen the CTA placement.");
    await reviewer.getByRole("button", { name: "Save private comment" }).click();

    await reviewer.getByRole("button", { name: "Highlight text" }).click();
    await reviewer.locator('[data-review-block="hero:1"]').evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await expect(reviewer.getByText(/Highlighted:/)).toBeVisible();
    await reviewer.getByLabel("Private comment").fill("Highlight: use more customer-centered wording.");
    await reviewer.getByRole("button", { name: "Save private comment" }).click();
    await reviewer.getByLabel("Decision note for this document").fill("Please update both copy points.");
    await reviewer.getByRole("button", { name: "Submit completed review" }).click();
    await expect(reviewer.getByText("Read-only after submit")).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.getByRole("button", { name: "Open review workspace" }).click();
    for (const comment of ["Pin: strengthen the CTA placement.", "Highlight: use more customer-centered wording."]) {
      const note = page.locator("article").filter({ hasText: comment });
      await note.getByRole("button", { name: "Resolved" }).click();
      await expect(note).toContainText("resolved");
    }
    await page.getByRole("button", { name: "Manage files" }).click();
    await page.getByRole("link", { name: "Edit Markdown" }).click();
    await page.getByLabel("Markdown source").fill(secondMarkdown);
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Publish check" }).click();
    await page.getByLabel(/Version note/).fill("Adds the single point-of-contact promise.");
    await expect(page.getByText("Blocking").locator(".." )).toContainText("0");
    await page.getByRole("button", { name: "Publish immutable version" }).click();
    await expect(page.getByText(/No Review Invitations were sent/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole("link", { name: "Back to Content Approvals" }).click();
    await page.getByRole("button", { name: "Open review workspace" }).click();
    await page.getByRole("button", { name: "Manage files" }).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByRole("button", { name: "Send next round" }).click();
    const secondInvitation = page.getByRole("group", { name: "Invitation for Wireframe Reviewer" });
    const secondInvitePath = await secondInvitation.getByRole("link", { name: "Private review link" }).getAttribute("href");
    const secondCode = (await secondInvitation.getByLabel("One-time code").textContent())?.trim();
    const laterReviewer = await reviewerContext.newPage();
    await laterReviewer.goto(new URL(secondInvitePath!, page.url()).toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    await expect(laterReviewer.getByLabel("One-time code")).toBeVisible({ timeout: 15_000 });
    await laterReviewer.getByLabel("One-time code").fill(secondCode!);
    await laterReviewer.getByRole("button", { name: "Open review" }).click();
    await expect(laterReviewer.getByText("Adds the single point-of-contact promise.")).toBeVisible();
    await expect(laterReviewer.getByText("Markdown changes from the base version")).toBeVisible();
    await expect(laterReviewer.getByText("Know what happens from estimate through delivery, with one point of contact.", { exact: true })).toBeVisible();

    const rounds = await admin.from("bsm_content_review_rounds").select("id, round_number").eq("project_id", projectId!).order("round_number");
    expect(rounds.error, rounds.error?.message).toBeNull();
    expect(rounds.data).toHaveLength(2);
    const roundDocuments = await admin.from("bsm_content_review_round_documents").select("round_id, version_id").eq("review_item_id", documentId!);
    expect(roundDocuments.error, roundDocuments.error?.message).toBeNull();
    expect(new Set((roundDocuments.data ?? []).map((row) => row.version_id)).size).toBe(2);
    const annotations = await admin.from("bsm_content_review_comments").select("version_id, comment_kind, selection_jsonb").eq("review_item_id", documentId!);
    expect(annotations.error, annotations.error?.message).toBeNull();
    const annotationRows = annotations.data ?? [];
    expect(annotationRows.some((row) => row.comment_kind === "pin")).toBe(true);
    expect(annotationRows.some((row) => row.comment_kind === "highlight" && row.selection_jsonb)).toBe(true);
    expect(new Set(annotationRows.map((row) => row.version_id)).size).toBe(1);
  } finally {
    await reviewerContext.close();
  }
});

test("BSM content approvals release gate: admin creates, reviewer comments and submits once", async ({ page, context }) => {
  const shopId = await ensureContentApprovalsShopOption();
  const runId = Date.now();
  const workspaceTitle = `E2E review workspace ${runId}`;
  const documentTitle = `Homepage release proof ${runId}`;

  await page.goto("/ops/bsm-content-approvals");
  await expect(page.getByRole("heading", { name: "Review Workspace", exact: true })).toBeVisible();
  await checkA11y(page, "bsm-content-approvals-admin-empty");

  if (!(await page.getByLabel("Review name").isVisible())) {
    await page.getByRole("button", { name: "New review" }).click();
  }

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

  await page.getByRole("button", { name: "Open review workspace" }).click();
  await page.getByRole("button", { name: "Comment mode" }).click();
  await page.getByRole("button", { name: "Place comment pin on document" }).click({ position: { x: 220, y: 160 } });
  await page.getByLabel("Comment text").fill("PSG shared note for the client reviewer.");
  await page.getByRole("button", { name: "Save comment" }).click();
  await expect(page.getByText("PSG shared note for the client reviewer.")).toBeVisible();

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
  await expect(reviewer.getByText("PSG shared note for the client reviewer.")).toBeVisible();
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
  await page.getByRole("button", { name: "Open review workspace" }).click();
  await expect(page.getByText("Review notes", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Please update the warranty offer wording before approval.").first()).toBeVisible();
  await expect(page.getByText("changes requested", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("The page is close, but the warranty offer needs clearer wording.").first()).toBeVisible();
  await checkA11y(page, "bsm-content-approvals-admin-result");
});
