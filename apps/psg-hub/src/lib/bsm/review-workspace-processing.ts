import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BSM_CONTENT_APPROVALS_BUCKET } from "@/lib/bsm/content-approvals-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const MAX_REVIEW_WORKSPACE_FILE_BYTES = 100 * 1024 * 1024;
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
    throw new ReviewWorkspaceProcessingError("The file is too large for the 100 MB review-workspace processing limit");
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
      error_code: input.errorCode ?? null,
      error_message: input.errorMessage ?? null,
      completed_at: completedAt,
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
