import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BSM_CONTENT_APPROVALS_BUCKET } from "@/lib/bsm/content-approvals-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const MAX_REVIEW_WORKSPACE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_HTML_BYTES = 15 * 1024 * 1024;
const MAX_HTML_ZIP_ENTRIES = 250;
const MAX_HTML_ZIP_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_EXPANSION_RATIO = 20;

export const REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION = 1;

export type ReviewWorkspaceFileKind = "pdf" | "doc" | "docx" | "html" | "html_zip";
export type ReviewWorkspaceArtifactKind =
  | "original"
  | "quarantine"
  | "review-copy"
  | "sanitized-html"
  | "summary";
export type ProcessingStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "quarantined"
  | "blocked_runtime"
  | "retry_scheduled"
  | "dead_letter";
export type ScanStatus = "pending" | "clean" | "infected" | "failed";
export type ConversionStatus = "not_needed" | "pending" | "complete" | "failed" | "blocked_runtime";
export type SanitizationStatus = "not_needed" | "pending" | "complete" | "failed";

export type ProcessingCapability = "malware_scan" | "pdf_passthrough" | "doc_to_pdf" | "html_sanitize" | "html_zip_inspect";

export type ReviewWorkspaceFilePlan = {
  fileKind: ReviewWorkspaceFileKind;
  normalizedMimeType: string;
  byteSize: number;
  maxBytes: number;
  acceptedForQuarantine: true;
  reviewerAccessibleBeforeProcessing: false;
  requiredCapabilities: ProcessingCapability[];
  scanStatus: ScanStatus;
  conversionStatus: ConversionStatus;
  sanitizationStatus: SanitizationStatus;
  reviewCopyExpectation: "original_pdf_after_clean_scan" | "converted_pdf" | "sanitized_static_html";
};

export type HtmlSafetyFinding = {
  code:
    | "script"
    | "event_handler"
    | "form"
    | "external_url"
    | "unsafe_url"
    | "download"
    | "iframe"
    | "object_embed";
  detail: string;
};

export type HtmlZipEntry = {
  path: string;
  compressedBytes: number;
  expandedBytes: number;
  type?: "file" | "directory" | "symlink";
};

export type UnsafeFileGateResult =
  | { ok: true; warnings: string[] }
  | { ok: false; code: string; message: string; findings: Array<HtmlSafetyFinding | { code: string; detail: string }> };

export type ProcessingResultInput = {
  shopId: string;
  reviewItemId: string;
  versionId: string;
  idempotencyKey: string;
  status: ProcessingStatus;
  scanStatus: ScanStatus;
  conversionStatus: ConversionStatus;
  sanitizationStatus: SanitizationStatus;
  resultManifest: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  completedAt?: string;
};

export class ReviewWorkspaceProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewWorkspaceProcessingError";
  }
}

function assertUuid(label: string, value: string): string {
  if (!UUID_RE.test(value)) throw new ReviewWorkspaceProcessingError(`${label} is required`);
  return value;
}

function safeSegment(label: string, value: string): string {
  const segment = value.trim().replace(/\s+/g, "-");
  if (segment.includes("..") || segment.includes("/") || segment.includes("\\") || !SAFE_SEGMENT_RE.test(segment)) {
    throw new ReviewWorkspaceProcessingError(`${label} must be one safe path segment`);
  }
  return segment;
}

function extensionOf(fileName: string): string {
  return fileName.trim().toLowerCase().split(".").pop() ?? "";
}

export function classifyReviewWorkspaceFile(input: {
  fileName: string;
  contentType?: string | null;
  byteSize: number;
}): ReviewWorkspaceFilePlan {
  const fileName = safeSegment("fileName", input.fileName);
  const extension = extensionOf(fileName);
  const mime = input.contentType?.trim().toLowerCase() ?? "";
  const byteSize = input.byteSize;

  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    throw new ReviewWorkspaceProcessingError("The selected file is empty");
  }
  if (byteSize > MAX_REVIEW_WORKSPACE_FILE_BYTES) {
    throw new ReviewWorkspaceProcessingError("The file is too large for the 25 MB review-workspace processing limit");
  }

  const detectedFileKind =
    extension === "pdf" || mime === "application/pdf"
      ? "pdf"
      : extension === "doc" || mime === "application/msword"
        ? "doc"
        : extension === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ? "docx"
          : extension === "html" || extension === "htm" || mime === "text/html"
            ? "html"
            : extension === "zip" || mime === "application/zip" || mime === "application/x-zip-compressed"
              ? "html_zip"
              : null;

  if (!detectedFileKind) {
    throw new ReviewWorkspaceProcessingError("Unsupported file type. Use PDF, DOC, DOCX, HTML, or an HTML ZIP package.");
  }
  const fileKind: ReviewWorkspaceFileKind = detectedFileKind;

  if (fileKind === "html" && byteSize > MAX_HTML_BYTES) {
    throw new ReviewWorkspaceProcessingError("HTML files must be 15 MB or smaller before sanitization");
  }

  const common: Pick<
    ReviewWorkspaceFilePlan,
    "fileKind" | "byteSize" | "maxBytes" | "acceptedForQuarantine" | "reviewerAccessibleBeforeProcessing" | "scanStatus"
  > = {
    fileKind,
    byteSize,
    maxBytes: MAX_REVIEW_WORKSPACE_FILE_BYTES,
    acceptedForQuarantine: true,
    reviewerAccessibleBeforeProcessing: false,
    scanStatus: "pending" as const,
  };

  if (fileKind === "pdf") {
    return {
      ...common,
      normalizedMimeType: "application/pdf",
      requiredCapabilities: ["malware_scan", "pdf_passthrough"],
      conversionStatus: "not_needed",
      sanitizationStatus: "not_needed",
      reviewCopyExpectation: "original_pdf_after_clean_scan",
    };
  }
  if (fileKind === "doc" || fileKind === "docx") {
    return {
      ...common,
      normalizedMimeType:
        fileKind === "doc" ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      requiredCapabilities: ["malware_scan", "doc_to_pdf"],
      conversionStatus: "pending",
      sanitizationStatus: "not_needed",
      reviewCopyExpectation: "converted_pdf",
    };
  }
  if (fileKind === "html") {
    return {
      ...common,
      normalizedMimeType: "text/html",
      requiredCapabilities: ["malware_scan", "html_sanitize"],
      conversionStatus: "not_needed",
      sanitizationStatus: "pending",
      reviewCopyExpectation: "sanitized_static_html",
    };
  }
  return {
    ...common,
    normalizedMimeType: "application/zip",
    requiredCapabilities: ["malware_scan", "html_zip_inspect", "html_sanitize"],
    conversionStatus: "not_needed",
    sanitizationStatus: "pending",
    reviewCopyExpectation: "sanitized_static_html",
  };
}

export function reviewWorkspaceStoragePath(input: {
  shopId: string;
  projectId: string;
  documentId: string;
  versionId: string;
  artifactKind: ReviewWorkspaceArtifactKind;
  fileName: string;
}): string {
  return [
    assertUuid("shopId", input.shopId),
    assertUuid("projectId", input.projectId),
    assertUuid("documentId", input.documentId),
    assertUuid("versionId", input.versionId),
    input.artifactKind,
    safeSegment("fileName", input.fileName),
  ].join("/");
}

export function inspectHtmlSafety(html: string): UnsafeFileGateResult {
  const findings: HtmlSafetyFinding[] = [];
  const text = html.toLowerCase();
  if (/<\s*script\b/i.test(html)) findings.push({ code: "script", detail: "script tag" });
  if (/\son[a-z]+\s*=/i.test(html)) findings.push({ code: "event_handler", detail: "inline event handler" });
  if (/<\s*form\b/i.test(html)) findings.push({ code: "form", detail: "form element" });
  if (/<\s*iframe\b/i.test(html)) findings.push({ code: "iframe", detail: "iframe element" });
  if (/<\s*(object|embed)\b/i.test(html)) findings.push({ code: "object_embed", detail: "object or embed element" });
  if (/\sdownload(?:\s|=|>)/i.test(html)) findings.push({ code: "download", detail: "download attribute" });
  if (/(href|src|srcset|action)\s*=\s*["']?\s*(javascript:|data:|vbscript:)/i.test(html)) {
    findings.push({ code: "unsafe_url", detail: "unsafe URL protocol" });
  }
  if (/(href|src|srcset|action)\s*=\s*["']?\s*https?:\/\//i.test(html) || text.includes("@import url(")) {
    findings.push({ code: "external_url", detail: "external network reference" });
  }
  if (findings.length > 0) {
    return { ok: false, code: "unsafe_html", message: "HTML contains active or external content", findings };
  }
  return { ok: true, warnings: [] };
}

export function inspectHtmlZipManifest(entries: HtmlZipEntry[]): UnsafeFileGateResult {
  const findings: Array<{ code: string; detail: string }> = [];
  let compressedTotal = 0;
  let expandedTotal = 0;
  let htmlCount = 0;

  if (entries.length > MAX_HTML_ZIP_ENTRIES) {
    findings.push({ code: "too_many_entries", detail: `${entries.length} entries` });
  }

  for (const entry of entries) {
    const path = entry.path;
    compressedTotal += Math.max(0, entry.compressedBytes);
    expandedTotal += Math.max(0, entry.expandedBytes);

    if (!path || path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.split(/[\\/]/).includes("..")) {
      findings.push({ code: "unsafe_path", detail: path || "(empty path)" });
    }
    if (entry.type === "symlink") findings.push({ code: "symlink", detail: path });
    if (/\.(exe|dll|bat|cmd|com|scr|ps1|sh|app|jar|msi)$/i.test(path)) {
      findings.push({ code: "executable", detail: path });
    }
    if (/\.(zip|7z|rar|tar|gz|bz2|xz)$/i.test(path)) {
      findings.push({ code: "nested_archive", detail: path });
    }
    if (/\.(html|htm)$/i.test(path)) htmlCount += 1;
  }

  if (htmlCount === 0) findings.push({ code: "missing_html", detail: "No HTML entry found" });
  if (expandedTotal > MAX_HTML_ZIP_EXPANDED_BYTES) {
    findings.push({ code: "expanded_too_large", detail: `${expandedTotal} expanded bytes` });
  }
  if (compressedTotal > 0 && expandedTotal / compressedTotal > MAX_ZIP_EXPANSION_RATIO) {
    findings.push({ code: "zip_bomb_risk", detail: `Expansion ratio ${Math.round(expandedTotal / compressedTotal)}x` });
  }

  if (findings.length > 0) {
    return { ok: false, code: "unsafe_html_zip", message: "HTML ZIP package failed safety checks", findings };
  }
  return { ok: true, warnings: [] };
}

export function isReviewCopySafeForReviewer(input: {
  scanStatus: ScanStatus;
  conversionStatus: ConversionStatus;
  sanitizationStatus: SanitizationStatus;
  processedStoragePath?: string | null;
  manifest?: Record<string, unknown> | null;
}): boolean {
  return (
    input.scanStatus === "clean" &&
    (input.conversionStatus === "not_needed" || input.conversionStatus === "complete") &&
    (input.sanitizationStatus === "not_needed" || input.sanitizationStatus === "complete") &&
    typeof input.processedStoragePath === "string" &&
    input.processedStoragePath.length > 0 &&
    Boolean(input.manifest && input.manifest.contractVersion === REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION)
  );
}

export function buildProcessingIdempotencyKey(input: { shopId: string; versionId: string; purpose?: string }): string {
  return `bsm-review-processing:${assertUuid("shopId", input.shopId)}:${assertUuid("versionId", input.versionId)}:${input.purpose ?? "review-copy"}`;
}

export async function recordReviewWorkspaceProcessingResult(
  client: SupabaseClient,
  input: ProcessingResultInput,
): Promise<void> {
  const completedAt = input.completedAt ?? new Date().toISOString();
  const reviewerSafe = isReviewCopySafeForReviewer({
    scanStatus: input.scanStatus,
    conversionStatus: input.conversionStatus,
    sanitizationStatus: input.sanitizationStatus,
    processedStoragePath: input.resultManifest.processedStoragePath as string | null | undefined,
    manifest: input.resultManifest,
  });
  const itemStatus = reviewerSafe ? "ready" : input.status === "quarantined" ? "quarantined" : "failed";

  const { error: jobError } = await client
    .from("bsm_content_review_processing_jobs")
    .update({
      status: input.status,
      scan_status: input.scanStatus,
      conversion_status: input.conversionStatus,
      sanitization_status: input.sanitizationStatus,
      result_manifest_jsonb: input.resultManifest,
      output_jsonb: input.resultManifest,
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ?? null,
      completed_at: completedAt,
      finished_at: completedAt,
      updated_at: completedAt,
    })
    .eq("shop_id", assertUuid("shopId", input.shopId))
    .eq("idempotency_key", input.idempotencyKey);
  if (jobError) throw new Error(`Could not update processing job: ${jobError.message}`);

  const { error: versionError } = await client
    .from("bsm_content_review_versions")
    .update({
      processed_storage_bucket: reviewerSafe ? BSM_CONTENT_APPROVALS_BUCKET : null,
      processed_storage_path: reviewerSafe ? input.resultManifest.processedStoragePath : null,
      processed_content_type: reviewerSafe ? input.resultManifest.processedContentType : null,
      artifact_manifest_jsonb: input.resultManifest,
      scan_status: input.scanStatus,
      conversion_status: input.conversionStatus,
      sanitization_status: input.sanitizationStatus,
    })
    .eq("id", assertUuid("versionId", input.versionId))
    .eq("shop_id", input.shopId);
  if (versionError) throw new Error(`Could not update review version processing result: ${versionError.message}`);

  const { error: itemError } = await client
    .from("bsm_content_review_items")
    .update({
      processing_status: itemStatus,
      processing_error_code: input.errorCode ?? null,
      processing_error_message: input.errorMessage ?? null,
      updated_at: completedAt,
    })
    .eq("id", assertUuid("reviewItemId", input.reviewItemId))
    .eq("shop_id", input.shopId);
  if (itemError) throw new Error(`Could not update review item processing result: ${itemError.message}`);
}

type SandboxCommandResult = {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
};

export type ReviewWorkspaceSandbox = {
  name: string;
  fs: {
    writeFile(path: string, data: Buffer | Uint8Array): Promise<void>;
    readFile(path: string): Promise<Buffer>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  };
  runCommand(input: {
    cmd: string;
    args?: string[];
    sudo?: boolean;
    timeoutMs?: number;
  }): Promise<SandboxCommandResult>;
  updateNetworkPolicy(policy: "deny-all"): Promise<unknown>;
  stop(): Promise<unknown>;
};

export type ReviewWorkspaceSandboxResult = {
  data: Buffer;
  contentType: "application/pdf";
  scanEngine: string;
  converter: string | null;
  sandboxId: string;
};

const LIBREOFFICE_VERSION = "26.2.5";
const LIBREOFFICE_ARCHIVE = `LibreOffice_${LIBREOFFICE_VERSION}_Linux_x86-64_rpm.tar.gz`;
const LIBREOFFICE_URL = `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/rpm/x86_64/${LIBREOFFICE_ARCHIVE}`;

function assertExpectedFileSignature(plan: ReviewWorkspaceFilePlan, data: Buffer): void {
  const prefix = data.subarray(0, 8);
  const matches = plan.fileKind === "pdf"
    ? prefix.subarray(0, 5).toString("ascii") === "%PDF-"
    : plan.fileKind === "doc"
      ? prefix.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
      : plan.fileKind === "docx"
        ? prefix[0] === 0x50 && prefix[1] === 0x4b
        : true;
  if (!matches) throw new ReviewWorkspaceProcessingError(`The uploaded file content does not match its ${plan.fileKind.toUpperCase()} type`);
}

async function commandOutput(result: SandboxCommandResult): Promise<string> {
  return (await result.stdout()).trim();
}

async function requireSuccessfulCommand(
  sandbox: ReviewWorkspaceSandbox,
  input: Parameters<ReviewWorkspaceSandbox["runCommand"]>[0],
  label: string,
): Promise<SandboxCommandResult> {
  const result = await sandbox.runCommand(input);
  if (result.exitCode !== 0) {
    const error = (await result.stderr()).trim();
    throw new ReviewWorkspaceProcessingError(`${label} failed${error ? `: ${error.slice(-600)}` : ""}`);
  }
  return result;
}

export async function processReviewFileInSandbox(
  input: { fileName: string; contentType: string; data: Buffer },
  deps: { createSandbox?: () => Promise<ReviewWorkspaceSandbox> } = {},
): Promise<ReviewWorkspaceSandboxResult> {
  const plan = classifyReviewWorkspaceFile({
    fileName: input.fileName,
    contentType: input.contentType,
    byteSize: input.data.byteLength,
  });
  if (plan.fileKind === "html_zip") {
    throw new ReviewWorkspaceProcessingError("HTML ZIP packages are not supported in this review workspace");
  }
  assertExpectedFileSignature(plan, input.data);
  if (plan.fileKind === "html") {
    const safety = inspectHtmlSafety(input.data.toString("utf8"));
    if (!safety.ok) throw new ReviewWorkspaceProcessingError(safety.message);
  }

  const createSandbox = deps.createSandbox ?? (async () => {
    const { Sandbox } = await import("@vercel/sandbox");
    return await Sandbox.create({ runtime: "node24", timeout: 290_000, networkPolicy: "allow-all" }) as ReviewWorkspaceSandbox;
  });
  const sandbox = await createSandbox();
  const extension = plan.fileKind === "html" ? "html" : plan.fileKind;
  const inputPath = `/vercel/sandbox/input/source.${extension}`;
  const outputPath = "/vercel/sandbox/output/source.pdf";

  try {
    await sandbox.fs.mkdir("/vercel/sandbox/input", { recursive: true });
    await sandbox.fs.mkdir("/vercel/sandbox/output", { recursive: true });
    await sandbox.fs.writeFile(inputPath, input.data);

    await requireSuccessfulCommand(
      sandbox,
      { cmd: "dnf", args: ["install", "-y", "clamav1.5", "clamav1.5-data"], sudo: true, timeoutMs: 120_000 },
      "Malware scanner installation",
    );

    if (plan.fileKind !== "pdf") {
      const installScript = [
        `curl --fail --location --silent --show-error '${LIBREOFFICE_URL}' -o /tmp/${LIBREOFFICE_ARCHIVE}`,
        "rm -rf /tmp/libreoffice-rpms",
        "mkdir -p /tmp/libreoffice-rpms",
        `tar -xzf /tmp/${LIBREOFFICE_ARCHIVE} -C /tmp/libreoffice-rpms`,
        "dnf install -y cairo cups-libs dbus-libs fontconfig freetype libX11-xcb libXinerama nss /tmp/libreoffice-rpms/LibreOffice_*/RPMS/*.rpm",
      ].join(" && ");
      await requireSuccessfulCommand(
        sandbox,
        { cmd: "bash", args: ["-lc", installScript], sudo: true, timeoutMs: 180_000 },
        "Document converter installation",
      );
    }

    await sandbox.updateNetworkPolicy("deny-all");
    const scan = await sandbox.runCommand({ cmd: "clamscan", args: ["--no-summary", inputPath], timeoutMs: 120_000 });
    if (scan.exitCode === 1) throw new ReviewWorkspaceProcessingError("The uploaded file did not pass the malware scan");
    if (scan.exitCode !== 0) {
      const error = (await scan.stderr()).trim();
      throw new ReviewWorkspaceProcessingError(`Malware scan failed${error ? `: ${error.slice(-600)}` : ""}`);
    }
    const scanEngine = await commandOutput(await requireSuccessfulCommand(
      sandbox,
      { cmd: "clamscan", args: ["--version"] },
      "Malware scanner version check",
    ));

    if (plan.fileKind === "pdf") {
      return {
        data: input.data,
        contentType: "application/pdf",
        scanEngine,
        converter: null,
        sandboxId: sandbox.name,
      };
    }

    const converterPath = "/opt/libreoffice26.2/program/soffice";
    const converter = await commandOutput(await requireSuccessfulCommand(
      sandbox,
      { cmd: converterPath, args: ["--version"] },
      "Document converter version check",
    ));
    await requireSuccessfulCommand(
      sandbox,
      {
        cmd: converterPath,
        args: ["--headless", "--convert-to", "pdf", "--outdir", "/vercel/sandbox/output", inputPath],
        timeoutMs: 120_000,
      },
      "Document conversion",
    );
    const data = await sandbox.fs.readFile(outputPath);
    if (!data.byteLength) throw new ReviewWorkspaceProcessingError("Document conversion produced an empty review copy");
    return { data, contentType: "application/pdf", scanEngine, converter, sandboxId: sandbox.name };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}

export async function processReviewWorkspaceUploadedVersion(
  input: { projectId: string; shopId: string; reviewItemId: string; versionId: string },
  deps: { client?: SupabaseClient; createSandbox?: () => Promise<ReviewWorkspaceSandbox> } = {},
): Promise<{ processingStatus: "ready"; processedContentType: "application/pdf"; processedStoragePath: string }> {
  const projectId = assertUuid("projectId", input.projectId);
  const shopId = assertUuid("shopId", input.shopId);
  const reviewItemId = assertUuid("reviewItemId", input.reviewItemId);
  const versionId = assertUuid("versionId", input.versionId);
  if (!deps.client) throw new Error("Review workspace processing requires a service client");
  const client = deps.client;

  const { data: versionRow, error: versionError } = await client
    .from("bsm_content_review_versions")
    .select("id, review_item_id, project_id, shop_id, original_filename, content_type, byte_size, storage_bucket, storage_path, original_storage_bucket, original_storage_path")
    .eq("id", versionId)
    .eq("review_item_id", reviewItemId)
    .eq("project_id", projectId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (versionError) throw new Error(`Could not load uploaded review version: ${versionError.message}`);
  if (!versionRow) throw new ReviewWorkspaceProcessingError("Uploaded review version was not found");
  const version = versionRow as Record<string, unknown>;
  const originalFilename = safeSegment("fileName", String(version.original_filename ?? ""));
  const contentType = String(version.content_type ?? "application/octet-stream");
  const byteSize = Number(version.byte_size ?? 0);
  const plan = classifyReviewWorkspaceFile({ fileName: originalFilename, contentType, byteSize });
  const originalBucket = String(version.original_storage_bucket ?? version.storage_bucket ?? "");
  const originalPath = String(version.original_storage_path ?? version.storage_path ?? "");
  if (originalBucket !== BSM_CONTENT_APPROVALS_BUCKET || !originalPath) {
    throw new ReviewWorkspaceProcessingError("The uploaded original is not available for processing");
  }

  const idempotencyKey = buildProcessingIdempotencyKey({ shopId, versionId });
  const now = new Date().toISOString();
  const { data: job, error: jobError } = await client
    .from("bsm_content_review_processing_jobs")
    .upsert({
      project_id: projectId,
      shop_id: shopId,
      review_item_id: reviewItemId,
      version_id: versionId,
      kind: "upload_scan",
      job_type: "review_copy",
      status: "running",
      idempotency_key: idempotencyKey,
      scan_status: "pending",
      conversion_status: plan.conversionStatus,
      sanitization_status: plan.sanitizationStatus,
      requested_capabilities_jsonb: plan.requiredCapabilities,
      worker_runtime: "vercel-sandbox-node24",
      input_manifest_jsonb: { contractVersion: REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION, originalPath, fileKind: plan.fileKind },
      input_jsonb: { originalPath, fileKind: plan.fileKind },
      attempts: 1,
      attempt_count: 1,
      started_at: now,
      updated_at: now,
    }, { onConflict: "idempotency_key", ignoreDuplicates: false })
    .select("id")
    .single();
  if (jobError || !job) throw new Error(`Could not start review document processing: ${jobError?.message ?? "no job returned"}`);

  await client
    .from("bsm_content_review_items")
    .update({ processing_status: "scanning", latest_processing_job_id: job.id, updated_at: now })
    .eq("id", reviewItemId)
    .eq("shop_id", shopId);

  try {
    const { data: original, error: downloadError } = await client.storage.from(BSM_CONTENT_APPROVALS_BUCKET).download(originalPath);
    if (downloadError || !original) {
      throw new ReviewWorkspaceProcessingError(`Could not read the uploaded original: ${downloadError?.message ?? "file not found"}`);
    }
    const result = await processReviewFileInSandbox(
      { fileName: originalFilename, contentType, data: Buffer.from(await original.arrayBuffer()) },
      { createSandbox: deps.createSandbox },
    );
    const processedStoragePath = reviewWorkspaceStoragePath({
      shopId,
      projectId,
      documentId: reviewItemId,
      versionId,
      artifactKind: "review-copy",
      fileName: `${originalFilename.replace(/\.[^.]+$/, "") || "review-copy"}.pdf`,
    });
    const { error: uploadError } = await client.storage
      .from(BSM_CONTENT_APPROVALS_BUCKET)
      .upload(processedStoragePath, result.data, { contentType: result.contentType, upsert: true });
    if (uploadError) throw new ReviewWorkspaceProcessingError(`Could not save the processed review copy: ${uploadError.message}`);

    const manifest = {
      contractVersion: REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION,
      originalStoragePath: originalPath,
      processedStoragePath,
      processedContentType: result.contentType,
      sourceKind: plan.fileKind,
      scanEngine: result.scanEngine,
      converter: result.converter,
      sandboxId: result.sandboxId,
      processedAt: new Date().toISOString(),
    };
    await recordReviewWorkspaceProcessingResult(client, {
      shopId,
      reviewItemId,
      versionId,
      idempotencyKey,
      status: "succeeded",
      scanStatus: "clean",
      conversionStatus: plan.conversionStatus === "pending" ? "complete" : "not_needed",
      sanitizationStatus: plan.sanitizationStatus === "pending" ? "complete" : "not_needed",
      resultManifest: manifest,
    });
    return { processingStatus: "ready", processedContentType: result.contentType, processedStoragePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document processing failed";
    const infected = message.includes("did not pass the malware scan");
    await recordReviewWorkspaceProcessingResult(client, {
      shopId,
      reviewItemId,
      versionId,
      idempotencyKey,
      status: infected ? "quarantined" : "failed",
      scanStatus: infected ? "infected" : "failed",
      conversionStatus: plan.conversionStatus === "pending" ? "failed" : "not_needed",
      sanitizationStatus: plan.sanitizationStatus === "pending" ? "failed" : "not_needed",
      resultManifest: { contractVersion: REVIEW_WORKSPACE_PROCESSING_CONTRACT_VERSION, originalStoragePath: originalPath },
      errorCode: infected ? "malware_detected" : "processing_failed",
      errorMessage: message,
    }).catch(() => undefined);
    throw error;
  }
}
