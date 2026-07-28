import { describe, expect, it } from "vitest";
import {
  REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION,
  buildProcessingIdempotencyKey,
  classifyReviewWorkspaceFile,
  inspectHtmlSafety,
  inspectHtmlZipManifest,
  isReviewCopySafeForReviewer,
  recordReviewWorkspaceProcessingResult,
  reviewWorkspaceStoragePath,
} from "@/lib/bsm/review-workspace-processing";
import { BSM_CONTENT_APPROVALS_BUCKET } from "@/lib/bsm/content-approvals-shared";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

function createFakeClient() {
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];

  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          return {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return this;
            },
            then(resolve: (value: { error: null }) => unknown) {
              updates.push({ table, payload, filters });
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
        },
      };
    },
  };

  return { client, updates };
}

describe("review workspace processing contract", () => {
  it("accepts approved v2 file types only into quarantine plans", () => {
    expect(classifyReviewWorkspaceFile({ fileName: "proof.pdf", contentType: "application/pdf", byteSize: 1024 })).toMatchObject({
      fileKind: "pdf",
      requiredCapabilities: ["malware_scan", "pdf_passthrough"],
      reviewerAccessibleBeforeProcessing: false,
      scanStatus: "pending",
      conversionStatus: "not_needed",
    });
    expect(classifyReviewWorkspaceFile({ fileName: "brief.doc", contentType: "application/msword", byteSize: 1024 })).toMatchObject({
      fileKind: "doc",
      requiredCapabilities: ["malware_scan", "doc_to_pdf"],
      conversionStatus: "pending",
    });
    expect(classifyReviewWorkspaceFile({ fileName: "site.zip", contentType: "application/zip", byteSize: 1024 })).toMatchObject({
      fileKind: "html_zip",
      requiredCapabilities: ["malware_scan", "html_zip_inspect", "html_sanitize"],
      sanitizationStatus: "pending",
    });

    expect(() => classifyReviewWorkspaceFile({ fileName: "image.png", contentType: "image/png", byteSize: 1024 })).toThrow(
      "Unsupported file type",
    );
    expect(() => classifyReviewWorkspaceFile({ fileName: "huge.pdf", contentType: "application/pdf", byteSize: 101 * 1024 * 1024 })).toThrow(
      "100 MB",
    );
  });

  it("builds private v2 storage paths with separate original and review-copy artifacts", () => {
    expect(
      reviewWorkspaceStoragePath({
        shopId: SHOP_ID,
        projectId: PROJECT_ID,
        documentId: ITEM_ID,
        versionId: VERSION_ID,
        artifactKind: "review-copy",
        fileName: "proof.pdf",
      }),
    ).toBe(`${SHOP_ID}/${PROJECT_ID}/${ITEM_ID}/${VERSION_ID}/review-copy/proof.pdf`);

    expect(() =>
      reviewWorkspaceStoragePath({
        shopId: SHOP_ID,
        projectId: PROJECT_ID,
        documentId: ITEM_ID,
        versionId: VERSION_ID,
        artifactKind: "original",
        fileName: "../secret.pdf",
      }),
    ).toThrow("safe path segment");
  });

  it("fails HTML that can run code, submit data, or call external URLs", () => {
    const result = inspectHtmlSafety(`
      <html>
        <body onload="alert(1)">
          <script>alert(1)</script>
          <form action="https://evil.example/collect"></form>
          <a href="javascript:alert(1)" download>open</a>
        </body>
      </html>
    `);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsafe_html");
      expect(result.findings.map((finding) => finding.code)).toEqual(
        expect.arrayContaining(["script", "event_handler", "form", "unsafe_url", "external_url", "download"]),
      );
    }
  });

  it("fails HTML ZIP manifests with traversal, symlinks, executables, nested archives, or zip-bomb expansion", () => {
    const result = inspectHtmlZipManifest([
      { path: "index.html", compressedBytes: 10, expandedBytes: 10 },
      { path: "../secret.html", compressedBytes: 10, expandedBytes: 10 },
      { path: "assets/link", type: "symlink", compressedBytes: 1, expandedBytes: 1 },
      { path: "bin/run.exe", compressedBytes: 10, expandedBytes: 10 },
      { path: "nested/archive.zip", compressedBytes: 10, expandedBytes: 10 },
      { path: "large.css", compressedBytes: 1, expandedBytes: 1000 },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsafe_html_zip");
      expect(result.findings.map((finding) => finding.code)).toEqual(
        expect.arrayContaining(["unsafe_path", "symlink", "executable", "nested_archive", "zip_bomb_risk"]),
      );
    }
  });

  it("requires a clean scan and complete manifest before reviewer access", () => {
    expect(
      isReviewCopySafeForReviewer({
        scanStatus: "clean",
        conversionStatus: "complete",
        sanitizationStatus: "not_needed",
        processedStoragePath: `${SHOP_ID}/${PROJECT_ID}/${ITEM_ID}/${VERSION_ID}/review-copy/proof.pdf`,
        manifest: {
          contractVersion: REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION,
        },
      }),
    ).toBe(true);

    expect(
      isReviewCopySafeForReviewer({
        scanStatus: "pending",
        conversionStatus: "complete",
        sanitizationStatus: "not_needed",
        processedStoragePath: `${SHOP_ID}/${PROJECT_ID}/${ITEM_ID}/${VERSION_ID}/review-copy/proof.pdf`,
        manifest: {
          contractVersion: REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION,
        },
      }),
    ).toBe(false);
  });

  it("records processing results with shop and idempotency filters so retries update the same job", async () => {
    const { client, updates } = createFakeClient();
    const completedAt = "2026-07-28T17:45:00.000Z";
    const idempotencyKey = buildProcessingIdempotencyKey({ shopId: SHOP_ID, versionId: VERSION_ID });

    await recordReviewWorkspaceProcessingResult(client as never, {
      shopId: SHOP_ID,
      reviewItemId: ITEM_ID,
      versionId: VERSION_ID,
      idempotencyKey,
      status: "succeeded",
      scanStatus: "clean",
      conversionStatus: "not_needed",
      sanitizationStatus: "not_needed",
      completedAt,
      resultManifest: {
        contractVersion: REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION,
        processedStoragePath: `${SHOP_ID}/${PROJECT_ID}/${ITEM_ID}/${VERSION_ID}/review-copy/proof.pdf`,
        processedContentType: "application/pdf",
      },
    });

    await recordReviewWorkspaceProcessingResult(client as never, {
      shopId: SHOP_ID,
      reviewItemId: ITEM_ID,
      versionId: VERSION_ID,
      idempotencyKey,
      status: "succeeded",
      scanStatus: "clean",
      conversionStatus: "not_needed",
      sanitizationStatus: "not_needed",
      completedAt,
      resultManifest: {
        contractVersion: REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION,
        processedStoragePath: `${SHOP_ID}/${PROJECT_ID}/${ITEM_ID}/${VERSION_ID}/review-copy/proof.pdf`,
        processedContentType: "application/pdf",
      },
    });

    expect(updates).toHaveLength(6);
    expect(updates[0]).toMatchObject({
      table: "bsm_content_review_processing_jobs",
      filters: { shop_id: SHOP_ID, idempotency_key: idempotencyKey },
      payload: { status: "succeeded", scan_status: "clean", output_jsonb: expect.any(Object), finished_at: completedAt },
    });
    expect(updates[1]).toMatchObject({
      table: "bsm_content_review_versions",
      filters: { id: VERSION_ID, shop_id: SHOP_ID },
      payload: {
        processed_storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
        processed_storage_path: `${SHOP_ID}/${PROJECT_ID}/${ITEM_ID}/${VERSION_ID}/review-copy/proof.pdf`,
      },
    });
    expect(updates[2]).toMatchObject({
      table: "bsm_content_review_items",
      filters: { id: ITEM_ID, shop_id: SHOP_ID },
      payload: { processing_status: "ready" },
    });
    expect(updates.slice(0, 3).map((entry) => entry.filters)).toEqual(updates.slice(3).map((entry) => entry.filters));
  });
});
