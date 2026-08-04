export const BSM_CONTENT_APPROVALS_BUCKET = "bsm-content-approvals";
export const MAX_APPROVAL_FILE_BYTES = 25 * 1024 * 1024;

export const SUPPORTED_APPROVAL_FILE_TYPES = {
  "application/pdf": { extension: "pdf", contentType: "pdf" },
  "image/png": { extension: "png", contentType: "image" },
  "image/jpeg": { extension: "jpg", contentType: "image" },
  "image/webp": { extension: "webp", contentType: "image" },
  "text/markdown": { extension: "md", contentType: "document" },
  "text/html": { extension: "html", contentType: "document" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extension: "docx",
    contentType: "document",
  },
  "text/plain": { extension: "txt", contentType: "document" },
} as const;

export type BsmApprovalContentType =
  (typeof SUPPORTED_APPROVAL_FILE_TYPES)[keyof typeof SUPPORTED_APPROVAL_FILE_TYPES]["contentType"];
export type BsmApprovalUploadMimeType = keyof typeof SUPPORTED_APPROVAL_FILE_TYPES;

const APPROVAL_FILE_EXTENSION_MIME_TYPES: Record<string, BsmApprovalUploadMimeType> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  markdown: "text/markdown",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
};

export function normalizeApprovalMimeType(
  fileName: unknown,
  contentType: unknown,
): BsmApprovalUploadMimeType | null {
  const extension = typeof fileName === "string" ? fileName.trim().toLowerCase().split(".").pop() : null;
  const extensionContentType = extension ? APPROVAL_FILE_EXTENSION_MIME_TYPES[extension] ?? null : null;

  if (typeof contentType === "string") {
    const normalized = contentType.trim().toLowerCase();
    if ((normalized === "text/plain" || normalized === "application/octet-stream") && extensionContentType) {
      return extensionContentType;
    }
    if (normalized in SUPPORTED_APPROVAL_FILE_TYPES) {
      return normalized as BsmApprovalUploadMimeType;
    }
  }

  return extensionContentType;
}

export type BsmContentApprovalListItem = {
  id: string;
  shopId: string;
  customerProfileId: string | null;
  title: string;
  status: string;
  processingStatus: string;
  contentType: string;
  sourceKind: "uploaded_file" | "generated_page";
  contextNote: string | null;
  updatedAt: string;
  currentVersion: {
    id: string;
    originalFilename: string | null;
    contentType: string;
    byteSize: number;
    storagePath: string | null;
    previewType: string;
    sourceMetadata: Record<string, unknown>;
    createdAt: string;
  } | null;
  latestDecision: {
    decision: string;
    message: string | null;
    createdAt: string;
  } | null;
  replyAttachments: Array<{
    id: string;
    originalFilename: string;
    byteSize: number;
    screeningStatus: string;
    createdAt: string;
  }>;
  commentCount: number;
  reviewWorkspace: {
    projectId: string;
    projectTitle: string | null;
    roundId: string | null;
  } | null;
};

export type BsmContentApprovalWorkspaceOption = {
  id: string;
  shopId: string;
  title: string;
  status: string;
  currentRoundId: string | null;
  documentCount: number;
};
