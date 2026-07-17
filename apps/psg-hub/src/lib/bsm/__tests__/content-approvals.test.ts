import { describe, expect, it, vi } from "vitest";
import {
  ApprovalUploadInputError,
  BSM_CONTENT_APPROVALS_BUCKET,
  approvalStoragePath,
  createBsmGeneratedPageApproval,
  createBsmContentApprovalUpload,
  normalizeApprovalFileName,
  validateApprovalFile,
} from "@/lib/bsm/content-approvals";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";

function createFakeClient() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown>; id: string }> = [];
  const client = {
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return Promise.resolve({ error: null });
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, id: string) {
              expect(column).toBe("id");
              updates.push({ table, payload, id });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client, inserts, updates };
}

describe("BSM content approval upload helpers", () => {
  it("accepts only supported file types and size limits", () => {
    expect(validateApprovalFile("application/pdf", 1024)).toEqual({
      extension: "pdf",
      contentType: "pdf",
    });

    expect(() => validateApprovalFile("application/zip", 1024)).toThrow(
      ApprovalUploadInputError,
    );
    expect(() => validateApprovalFile("application/pdf", 26 * 1024 * 1024)).toThrow(
      "under 25 MB",
    );
  });

  it("normalizes safe file names and rejects path traversal", () => {
    expect(normalizeApprovalFileName(" July Proof.pdf ")).toBe("July-Proof.pdf");
    expect(() => normalizeApprovalFileName("../secret.pdf")).toThrow(
      "Rename the file",
    );
  });

  it("creates the review item, version, reviewer, event, and signed upload token", async () => {
    const { client, inserts, updates } = createFakeClient();
    const createSignedUploadUrl = vi.fn(async (path: string) => ({
      data: { path, signedUrl: "https://upload.example", token: "token-1" },
      error: null,
    }));
    const storage = {
      from: vi.fn(() => ({ createSignedUploadUrl })),
    };

    const result = await createBsmContentApprovalUpload(
      {
        shopId: SHOP_ID,
        customerProfileId: PROFILE_ID,
        actorProfileId: ACTOR_ID,
        title: "July homepage proof",
        contextNote: "Please confirm the offer and phone number.",
        fileName: "proof.pdf",
        contentType: "application/pdf",
        byteSize: 2048,
      },
      { client: client as never, storage },
    );

    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_items",
      "bsm_content_review_versions",
      "bsm_content_review_reviewers",
      "bsm_content_review_events",
    ]);
    expect(updates).toHaveLength(1);
    expect(storage.from).toHaveBeenCalledWith(BSM_CONTENT_APPROVALS_BUCKET);
    expect(result.upload.token).toBe("token-1");
    expect(result.item.title).toBe("July homepage proof");
    expect(result.item.currentVersion?.storagePath).toBe(result.upload.path);

    const item = inserts[0].payload;
    const version = inserts[1].payload;
    expect(item.shop_id).toBe(SHOP_ID);
    expect(item.customer_profile_id).toBe(PROFILE_ID);
    expect(item.content_type).toBe("pdf");
    expect(version.storage_path).toBe(
      approvalStoragePath({
        shopId: SHOP_ID,
        itemId: item.id as string,
        versionId: version.id as string,
        fileName: "proof.pdf",
      }),
    );
  });

  it("creates generated page review items without a storage upload", async () => {
    const { client, inserts, updates } = createFakeClient();

    const result = await createBsmGeneratedPageApproval(
      {
        shopId: SHOP_ID,
        customerProfileId: PROFILE_ID,
        actorProfileId: ACTOR_ID,
        title: "July landing page",
        contextNote: "Please review the offer and hero section.",
        generatedPagePath: "/generated/wallace/july-landing-page",
        previewUrl: "https://preview.example/wallace/july",
        sourceContentItemId: "44444444-4444-4444-8444-444444444444",
        snapshot: { campaign: "July" },
      },
      { client: client as never },
    );

    expect(inserts.map((entry) => entry.table)).toEqual([
      "bsm_content_review_items",
      "bsm_content_review_versions",
      "bsm_content_review_reviewers",
      "bsm_content_review_events",
    ]);
    expect(updates).toHaveLength(1);
    expect(result.item.sourceKind).toBe("generated_page");
    expect(result.item.currentVersion?.previewType).toBe("generated_page");
    expect(result.item.currentVersion?.sourceMetadata).toMatchObject({
      sourceKind: "generated_page",
      generatedPagePath: "/generated/wallace/july-landing-page",
      previewUrl: "https://preview.example/wallace/july",
      campaign: "July",
    });

    const item = inserts[0].payload;
    const version = inserts[1].payload;
    expect(item.content_type).toBe("generated_page");
    expect(item.source_content_item_id).toBe("44444444-4444-4444-8444-444444444444");
    expect(version.storage_path).toBeNull();
    expect(version.source_metadata_jsonb).toMatchObject({
      generatedPagePath: "/generated/wallace/july-landing-page",
    });
  });
});
