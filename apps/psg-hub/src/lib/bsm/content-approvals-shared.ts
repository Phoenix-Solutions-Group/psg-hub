export const BSM_CONTENT_APPROVALS_BUCKET = "bsm-content-approvals";
export const MAX_APPROVAL_FILE_BYTES = 25 * 1024 * 1024;

export const SUPPORTED_APPROVAL_FILE_TYPES = {
  "application/pdf": { extension: "pdf", contentType: "pdf" },
  "image/png": { extension: "png", contentType: "image" },
  "image/jpeg": { extension: "jpg", contentType: "image" },
  "image/webp": { extension: "webp", contentType: "image" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extension: "docx",
    contentType: "document",
  },
  "text/plain": { extension: "txt", contentType: "document" },
} as const;

export type BsmApprovalContentType =
  (typeof SUPPORTED_APPROVAL_FILE_TYPES)[keyof typeof SUPPORTED_APPROVAL_FILE_TYPES]["contentType"];

export type BsmContentApprovalListItem = {
  id: string;
  shopId: string;
  customerProfileId: string | null;
  title: string;
  status: string;
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
  commentCount: number;
};
