import { describe, expect, it } from "vitest";
import {
  REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION,
  buildProcessingIdempotencyKey,
  classifyReviewWorkspaceFile,
  inspectHtmlSafety,
  inspectHtmlZipManifest,
  isReviewCopySafeForReviewer,
  processReviewFileInSandbox,
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
    expect(() => classifyReviewWorkspaceFile({ fileName: "huge.pdf", contentType: "application/pdf", byteSize: 26 * 1024 * 1024 })).toThrow(
      "25 MB",
    );
  });

  it("scans PDFs in an isolated network-locked sandbox and returns the clean review copy", async () => {
    const commands: Array<{ cmd: string; args?: string[] }> = [];
    let locked = false;
    let stopped = false;
    const source = Buffer.from("%PDF-1.7 clean proof");
    const sandbox = {
      name: "sandbox-clean-pdf",
      fs: {
        mkdir: async () => undefined,
        writeFile: async () => undefined,
        readFile: async () => Buffer.alloc(0),
      },
      async runCommand(input: { cmd: string; args?: string[] }) {
        commands.push(input);
        return {
          exitCode: 0,
          stdout: async () => input.args?.includes("--version") ? "ClamAV 1.5.2" : "",
          stderr: async () => "",
        };
      },
      async updateNetworkPolicy() {
        locked = true;
      },
      async stop() {
        stopped = true;
      },
    };

    const result = await processReviewFileInSandbox(
      { fileName: "proof.pdf", contentType: "application/pdf", data: source },
      { createSandbox: async () => sandbox },
    );

    expect(result.data).toEqual(source);
    expect(result.scanEngine).toBe("ClamAV 1.5.2");
    expect(result.converter).toBeNull();
    expect(commands.some((command) => command.cmd === "dnf")).toBe(true);
    expect(commands.some((command) => command.cmd.includes("soffice"))).toBe(false);
    expect(locked).toBe(true);
    expect(stopped).toBe(true);
  });

  it("converts DOCX files to an inert PDF after the malware scan", async () => {
    const commands: Array<{ cmd: string; args?: string[] }> = [];
    const converted = Buffer.from("%PDF converted review copy");
    const sandbox = {
      name: "sandbox-docx",
      fs: {
        mkdir: async () => undefined,
        writeFile: async () => undefined,
        readFile: async () => converted,
      },
      async runCommand(input: { cmd: string; args?: string[] }) {
        commands.push(input);
        return {
          exitCode: 0,
          stdout: async () => input.args?.includes("--version")
            ? input.cmd.includes("soffice") ? "LibreOffice 26.2.5" : "ClamAV 1.5.2"
            : "",
          stderr: async () => "",
        };
      },
      async updateNetworkPolicy() {},
      async stop() {},
    };

    const result = await processReviewFileInSandbox(
      {
        fileName: "brief.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
      },
      { createSandbox: async () => sandbox },
    );

    expect(result.data).toEqual(converted);
    expect(result.converter).toBe("LibreOffice 26.2.5");
    expect(commands.some((command) =>
      command.cmd === "bash" &&
      command.args?.[1]?.includes("LibreOffice_26.2.5") &&
      command.args[1].includes("libXinerama nss"),
    )).toBe(true);
    expect(commands.some((command) => command.cmd.includes("soffice") && command.args?.includes("--convert-to"))).toBe(true);
  });

  it("returns safe HTML unchanged for native sandboxed rendering after the malware scan", async () => {
    const commands: Array<{ cmd: string; args?: string[] }> = [];
    let locked = false;
    let stopped = false;
    const source = Buffer.from("<!doctype html><style>main{color:#c2410c}</style><main>Review proof</main>");
    const sandbox = {
      name: "sandbox-clean-html",
      fs: {
        mkdir: async () => undefined,
        writeFile: async () => undefined,
        readFile: async () => Buffer.alloc(0),
      },
      async runCommand(input: { cmd: string; args?: string[] }) {
        commands.push(input);
        return {
          exitCode: 0,
          stdout: async () => input.args?.includes("--version") ? "ClamAV 1.5.2" : "",
          stderr: async () => "",
        };
      },
      async updateNetworkPolicy() {
        locked = true;
      },
      async stop() {
        stopped = true;
      },
    };

    const result = await processReviewFileInSandbox(
      { fileName: "proof.html", contentType: "text/html", data: source },
      { createSandbox: async () => sandbox },
    );

    expect(result).toMatchObject({ data: source, contentType: "text/html", converter: null });
    expect(commands.some((command) => command.cmd === "bash" || command.cmd.includes("soffice"))).toBe(false);
    expect(locked).toBe(true);
    expect(stopped).toBe(true);
  });

  it("rejects active HTML before provisioning a sandbox", async () => {
    let created = false;
    await expect(processReviewFileInSandbox(
      { fileName: "unsafe.html", contentType: "text/html", data: Buffer.from("<script>alert(1)</script>") },
      { createSandbox: async () => {
        created = true;
        throw new Error("should not create");
      } },
    )).rejects.toThrow("active or external content");
    expect(created).toBe(false);
  });

  it("rejects renamed files whose bytes do not match the selected document type", async () => {
    await expect(processReviewFileInSandbox(
      { fileName: "not-really.pdf", contentType: "application/pdf", data: Buffer.from("MZ executable") },
      { createSandbox: async () => { throw new Error("should not create"); } },
    )).rejects.toThrow("does not match its PDF type");
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
