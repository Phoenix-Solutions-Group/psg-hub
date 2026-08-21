import type {
  ContentWireframeDiagnostic,
  ContentWireframeManifest,
  MarkdownDiffLine,
} from "@/lib/bsm/content-wireframe";

export type ReviewContentDraft = {
  id: string;
  projectId: string;
  shopId: string;
  documentId: string;
  markdown: string;
  revision: number;
  baseVersionId: string | null;
  createdByProfileId: string;
  lastWriterProfileId: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewContentAsset = {
  id: string;
  projectId: string;
  shopId: string;
  documentId: string;
  originalFilename: string;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  createdAt: string;
};

export type ContentDraftFeedbackReference = {
  id: string;
  threadId: string;
  kind: "pin" | "highlight";
  pinNumber: number | null;
  body: string;
  selectedText: string | null;
  status: string;
  createdAt: string;
};

export type ContentDraftWorkspacePayload = {
  draft: ReviewContentDraft | null;
  currentVersionId: string | null;
  assets: ReviewContentAsset[];
  manifest: ContentWireframeManifest | null;
  diagnostics: ContentWireframeDiagnostic[];
  baseMarkdown: string;
  diff: MarkdownDiffLine[];
  feedbackStatuses: string[];
  feedbackReferences: ContentDraftFeedbackReference[];
  approvalStatement: string;
};
