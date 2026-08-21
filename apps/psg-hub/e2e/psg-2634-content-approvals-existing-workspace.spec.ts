import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { OPS_STAFF, OWNER, SHOTS_DIR } from "./fixtures";

test.use({ storageState: OPS_STAFF.statePath });

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
  if (existing?.[0]) return shop!.id as string;

  const { error: insertError } = await admin.from("companies").insert({
    name: OWNER.shopName,
    shop_id: shop!.id,
    status: "active",
  });
  expect(insertError, insertError?.message).toBeNull();
  return shop!.id as string;
}

test("PSG-2634 allows two documents on an existing draft workspace, then blocks changes after start", async ({
  page,
}) => {
  const shopId = await ensureContentApprovalsShopOption();
  const runId = Date.now();
  const workspaceTitle = `PSG-2634 existing workspace ${runId}`;
  const firstTitle = `PSG-2634 first proof ${runId}`;
  const secondTitle = `PSG-2634 second proof ${runId}`;

  await page.goto("/ops/bsm-content-approvals");
  await expect(page.getByRole("heading", { name: "Content Approvals" })).toBeVisible();

  const manualShopInput = page.locator("input#bsm-approval-shop");
  if (await manualShopInput.isVisible()) {
    await manualShopInput.fill(shopId);
  }

  await page.getByLabel("Workspace title").fill(workspaceTitle);
  await page.getByLabel("Reviewer instructions").fill("Confirm both PSG-2634 sample proofs.");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("The Review Workspace is ready for documents and reviewers.")).toBeVisible({
    timeout: 15_000,
  });

  const workspaceSelect = page.getByLabel("Review Workspace for these documents");
  const workspaceId = await workspaceSelect.inputValue();
  expect(workspaceId, "new workspace is selected").toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  async function attachGeneratedPage(title: string, suffix: string) {
    await page.getByRole("button", { name: "Generated page" }).click();
    await page.getByLabel("Review title").fill(title);
    await page.getByLabel("Context note for the customer").fill("PSG-2634 demo-safe generated page proof.");
    await page.getByLabel("Generated page path").fill(`/generated/e2e/psg-2634-${runId}-${suffix}`);
    await page.getByLabel("Preview URL").fill(`https://example.com/generated/e2e/psg-2634-${runId}-${suffix}`);
    await page.getByRole("button", { name: "Attach", exact: true }).click();
    await expect(page.getByText("The item is attached to the selected Review Workspace.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("row", { name: new RegExp(title) })).toBeVisible();
  }

  await attachGeneratedPage(firstTitle, "first");
  await attachGeneratedPage(secondTitle, "second");
  await expect(page.getByText("2 review items")).toBeVisible();
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "psg-2634-existing-workspace-two-documents.png"),
    fullPage: true,
  });

  await page.getByLabel("Reviewer email").fill(`psg-2634-reviewer-${runId}@e2e.test`);
  await page.getByLabel("Reviewer name").fill("PSG-2634 Reviewer");
  await page.getByRole("button", { name: "Add reviewer" }).click();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText("The review has started. Share the reviewer URL and code with each reviewer.")).toBeVisible({
    timeout: 15_000,
  });

  const blockedResult = await page.evaluate(
    async ({ shopId, workspaceId, runId }) => {
      const response = await fetch("/api/ops/bsm/content-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId,
          reviewWorkspaceProjectId: workspaceId,
          title: `PSG-2634 blocked proof ${runId}`,
          contextNote: "This should be rejected after review start.",
          sourceKind: "generated_page",
          generatedPagePath: `/generated/e2e/psg-2634-${runId}-blocked`,
          previewUrl: `https://example.com/generated/e2e/psg-2634-${runId}-blocked`,
        }),
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => ({}))) as { error?: string },
      };
    },
    { shopId, workspaceId, runId },
  );

  expect(blockedResult).toEqual({
    status: 400,
    body: { error: "This Review Workspace has already been started or closed" },
  });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "psg-2634-existing-workspace-started.png"),
    fullPage: true,
  });
});
