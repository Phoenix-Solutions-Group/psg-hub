import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { OPS_STAFF, OWNER, SHOTS_DIR } from "./fixtures";

test.use({ storageState: OPS_STAFF.statePath });

const PROJECT_ID = "26530000-0000-4000-8000-000000000001";
const SECTION_ID = "26530000-0000-4000-8000-000000000002";
const ITEM_IDS = [
  "26530000-0000-4000-8000-000000000011",
  "26530000-0000-4000-8000-000000000012",
  "26530000-0000-4000-8000-000000000013",
  "26530000-0000-4000-8000-000000000014",
] as const;
const VERSION_IDS = [
  "26530000-0000-4000-8000-000000000021",
  "26530000-0000-4000-8000-000000000022",
  "26530000-0000-4000-8000-000000000023",
  "26530000-0000-4000-8000-000000000024",
] as const;

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedPreviewWorkspace() {
  const admin = adminClient();
  const { data: shop, error: shopError } = await admin
    .from("shops")
    .select("id")
    .eq("slug", "riverside-collision")
    .single();
  expect(shopError, shopError?.message).toBeNull();
  expect(shop?.id).toBeTruthy();

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const opsUser = users.users.find((user) => user.email === OPS_STAFF.email);
  expect(opsUser?.id, "ops staff user id").toBeTruthy();

  await admin.from("companies").upsert(
    {
      name: OWNER.shopName,
      shop_id: shop!.id,
      status: "active",
    },
    { onConflict: "name" },
  );

  await admin.from("bsm_content_review_items").delete().eq("project_id", PROJECT_ID);
  await admin.from("bsm_content_review_sections").delete().eq("project_id", PROJECT_ID);
  await admin.from("bsm_content_review_projects").delete().eq("id", PROJECT_ID);

  const { error: projectError } = await admin.from("bsm_content_review_projects").insert({
    id: PROJECT_ID,
    shop_id: shop!.id,
    title: "PSG-2653 preview rendering workspace",
    description: "Browser QA workspace for Content Approvals preview rendering.",
    status: "draft",
    owner_profile_id: opsUser!.id,
    created_by_profile_id: opsUser!.id,
    metadata_jsonb: { e2e: "PSG-2653" },
  });
  expect(projectError, projectError?.message).toBeNull();

  const { error: collaboratorError } = await admin.from("bsm_content_review_project_collaborators").insert({
    project_id: PROJECT_ID,
    shop_id: shop!.id,
    profile_id: opsUser!.id,
    role: "owner",
    added_by_profile_id: opsUser!.id,
  });
  expect(collaboratorError, collaboratorError?.message).toBeNull();

  const { error: sectionError } = await admin.from("bsm_content_review_sections").insert({
    id: SECTION_ID,
    project_id: PROJECT_ID,
    shop_id: shop!.id,
    title: "QA proof screens",
    position: 1,
  });
  expect(sectionError, sectionError?.message).toBeNull();

  const rows = [
    {
      title: "Generated page proof",
      itemContentType: "generated_page",
      contentType: "generated_page",
      filename: "Generated page",
      previewType: "generated_page",
      url: "/e2e-content-approval-generated.html",
    },
    {
      title: "Uploaded HTML proof",
      itemContentType: "document",
      contentType: "text/html",
      filename: "proof.html",
      previewType: "html",
      url: "/e2e-content-approval-proof.html",
    },
    {
      title: "Uploaded PDF proof",
      itemContentType: "pdf",
      contentType: "application/pdf",
      filename: "proof.pdf",
      previewType: "pdf",
      url: "/e2e-content-approval-proof.pdf",
    },
    {
      title: "Uploaded image proof",
      itemContentType: "image",
      contentType: "image/svg+xml",
      filename: "proof.svg",
      previewType: "image",
      url: "/e2e-content-approval-proof.svg",
    },
  ];

  const { error: itemError } = await admin.from("bsm_content_review_items").insert(
    rows.map((row, index) => ({
      id: ITEM_IDS[index],
      shop_id: shop!.id,
      project_id: PROJECT_ID,
      section_id: SECTION_ID,
      position: index + 1,
      required: true,
      title: row.title,
      source_kind: row.contentType === "generated_page" ? "generated_page" : "uploaded_file",
      content_type: row.itemContentType,
      status: "in_review",
      admin_context_note: "Confirm this proof renders in the staff preview.",
      processing_status: "ready",
      current_version_id: null,
      created_by_profile_id: opsUser!.id,
      metadata_jsonb: { e2e: "PSG-2653" },
    })),
  );
  expect(itemError, itemError?.message).toBeNull();

  const { error: versionError } = await admin.from("bsm_content_review_versions").insert(
    rows.map((row, index) => ({
      id: VERSION_IDS[index],
      review_item_id: ITEM_IDS[index],
      shop_id: shop!.id,
      project_id: PROJECT_ID,
      version_number: 1,
      status: "current",
      storage_bucket: null,
      storage_path: null,
      original_filename: row.filename,
      content_type: row.contentType,
      byte_size: 1,
      preview_type: row.previewType,
      preview_url: row.url,
      generated_page_path: row.contentType === "generated_page" ? row.url : null,
      processed_content_type: row.contentType === "generated_page" ? "text/html" : row.contentType,
      scan_status: "clean",
      conversion_status: "not_needed",
      sanitization_status: "complete",
      source_metadata_jsonb: {
        sourceKind: row.contentType === "generated_page" ? "generated_page" : "uploaded_file",
        previewUrl: row.url,
        generatedPagePath: row.contentType === "generated_page" ? row.url : null,
      },
      created_by_profile_id: opsUser!.id,
    })),
  );
  expect(versionError, versionError?.message).toBeNull();

  await Promise.all(
    ITEM_IDS.map(async (itemId, index) => {
      const { error } = await admin
        .from("bsm_content_review_items")
        .update({ current_version_id: VERSION_IDS[index] })
        .eq("id", itemId);
      expect(error, error?.message).toBeNull();
    }),
  );

  return { shopId: shop!.id as string };
}

async function expectSelectedScreen(page: Page, screenName: string, proofText: string) {
  await page.getByRole("button", { name: new RegExp(screenName) }).click();
  await expect(page.getByText(proofText).first()).toBeVisible();
}

test("PSG-2653 staff preview renders selectable generated, HTML, PDF, and image screens", async ({ page }) => {
  const { shopId } = await seedPreviewWorkspace();

  await page.goto(`/ops/bsm-content-approvals?shopId=${shopId}&workspaceId=${PROJECT_ID}`);
  await expect(page.getByRole("heading", { name: "Content Approvals" })).toBeVisible();
  await expect(page.getByLabel("Review Workspace for these documents")).toContainText(
    "PSG-2653 preview rendering workspace",
  );

  await page.getByRole("button", { name: "Preview read-only" }).click();
  await expect(page.getByText("Preview mode")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  fs.mkdirSync(path.join(SHOTS_DIR, "psg-2653"), { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "psg-2653", "content-approval-preview-after-open.png"),
    fullPage: true,
  });
  await expect(page.getByRole("button", { name: /Screen 1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Screen 4/ })).toBeVisible();

  await expect(page.frameLocator('iframe[title="Generated page proof proof"]').getByText("Generated approval page rendered")).toBeVisible();
  await expectSelectedScreen(page, "Screen 2", "Uploaded HTML proof");
  await expect(page.frameLocator('iframe[title="Uploaded HTML proof proof"]').getByText("HTML approval proof rendered")).toBeVisible();
  await expectSelectedScreen(page, "Screen 3", "Uploaded PDF proof");
  await expect(page.locator('iframe[title="Uploaded PDF proof proof"]')).toHaveAttribute("src", "/e2e-content-approval-proof.pdf");
  await expectSelectedScreen(page, "Screen 4", "Uploaded image proof");
  await expect(page.getByRole("img", { name: "Uploaded image proof proof" })).toBeVisible();

  await expect(page.getByText("<!doctype html>")).toHaveCount(0);
  await expect(page.getByText("This proof does not have a working preview yet")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  fs.mkdirSync(path.join(SHOTS_DIR, "psg-2653"), { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, "psg-2653", "content-approval-preview-rendering.png"),
    fullPage: true,
  });
});
