"use client";

import {
  ArrowLeft,
  Check,
  CircleStop,
  Copy,
  ExternalLink,
  Eye,
  FilePenLine,
  FileText,
  FileUp,
  FolderOpen,
  Highlighter,
  ImageIcon,
  MapPin,
  MessageSquare,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  BSM_CONTENT_APPROVALS_BUCKET,
  MAX_APPROVAL_FILE_BYTES,
  type BsmContentApprovalListItem,
  type BsmContentApprovalWorkspaceOption,
  normalizeApprovalMimeType,
} from "@/lib/bsm/content-approvals-shared";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { StaffReviewWorkspaceResult } from "@/lib/bsm/review-workspace";
import { ContentWireframeRenderer } from "@/components/bsm/content-wireframe-renderer";

type UploadResponse =
  | {
      item: BsmContentApprovalListItem;
      upload: {
        path: string;
        token: string;
        signedUrl: string;
        bucket: string;
      };
    }
  | {
      item: BsmContentApprovalListItem;
    }
  | { error?: string };

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export const BSM_CONTENT_APPROVAL_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.md,.markdown,.html,.htm,.txt,.doc,.docx,application/pdf,image/png,image/jpeg,image/webp,text/markdown,text/html,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const BSM_CONTENT_APPROVAL_UNSUPPORTED_FILE_MESSAGE =
  "This file type is not supported. Upload a PDF, image, Markdown, HTML, text, DOC, or DOCX file.";

export type BsmContentApprovalShopOption = { id: string; name: string };
export type BsmContentApprovalReviewerContact = {
  email: string;
  name: string | null;
};

type ReviewStartResponse =
  | {
      review: {
        roundId: string;
        documentCount: number;
        invitations: Array<{
          invitationId: string;
          reviewerEmail: string;
          reviewerName: string | null;
          inviteToken: string;
          inviteCode: string;
          deliveryStatus?: "sent" | "failed";
        }>;
      };
      failedDeliveryCount?: number;
    }
  | { error?: string };

type WorkspaceCreateResponse =
  | { workspace: { id: string; shopId: string; title: string; status: string } }
  | { error?: string };

type WorkspacePreviewResponse =
  | { result: StaffReviewWorkspaceResult }
  | { error?: string };

type WorkspaceCommentResponse =
  | { comment: { id: string } }
  | { error?: string };

type WorkspaceUpdateResponse =
  | { workspace: { id: string; shopId: string; title: string; status: string } }
  | { error?: string };

type WorkspaceCloseResponse =
  | {
      closure: {
        status: string;
        outcome: string;
        nonresponders: Array<{ email: string; name: string | null }>;
      };
    }
  | { error?: string };

type InvitationRevokeResponse =
  | {
      revocation: {
        status: string;
        roundCompleted: boolean;
        outcome: string | null;
      };
    }
  | { error?: string };

export type WorkspacePreviewDocument =
  StaffReviewWorkspaceResult["documents"][number];
type WorkspacePreviewComment =
  StaffReviewWorkspaceResult["submittedComments"][number];

export function getBsmReviewWorkspaceStartBlocker(input: {
  workspaceId: string;
  workspaceStatus?: string | null;
  documents: Array<{ processingStatus: string }>;
  reviewers: Array<{ email: string }>;
}) {
  if (!input.workspaceId) return "Create or select a Review Workspace first.";
  if (
    input.workspaceStatus === "active" ||
    input.workspaceStatus === "inviting"
  ) {
    return "This review round is open. Wait for all reviewers or close the round before starting another.";
  }
  if (input.documents.length === 0)
    return "Add at least one document before starting review.";
  if (
    input.documents.some((document) => document.processingStatus !== "ready")
  ) {
    return "Start review is available after every document finishes processing successfully.";
  }
  if (
    input.reviewers.filter((reviewer) => reviewer.email.trim()).length === 0
  ) {
    return "Choose at least one reviewer before starting review.";
  }
  return null;
}

export function getBsmContentApprovalFileValidationError(
  selectedFile: File | null,
) {
  if (!selectedFile) return null;
  const contentType = normalizeApprovalMimeType(
    selectedFile.name,
    selectedFile.type,
  );
  if (!contentType) {
    return BSM_CONTENT_APPROVAL_UNSUPPORTED_FILE_MESSAGE;
  }
  if (selectedFile.size <= 0) return "The selected file is empty.";
  if (selectedFile.size > MAX_APPROVAL_FILE_BYTES)
    return "The file is too large. Upload a file under 25 MB.";
  return null;
}

export function getBsmContentApprovalStorageContentType(selectedFile: File) {
  const normalizedContentType = normalizeApprovalMimeType(
    selectedFile.name,
    selectedFile.type,
  );
  if (
    normalizedContentType === "text/html" ||
    normalizedContentType === "text/markdown"
  ) {
    return "text/plain";
  }
  return normalizedContentType ?? selectedFile.type;
}

async function prepareUploadedReviewCopy(
  item: BsmContentApprovalListItem,
): Promise<BsmContentApprovalListItem> {
  if (
    item.sourceKind !== "uploaded_file" ||
    !item.reviewWorkspace?.projectId ||
    !item.currentVersion?.id
  )
    return item;
  const response = await fetch("/api/ops/bsm/content-approvals", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: item.reviewWorkspace.projectId,
      reviewItemId: item.id,
      versionId: item.currentVersion.id,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    processingStatus?: string;
    error?: string;
  };
  if (!response.ok || body.processingStatus !== "ready") {
    throw new Error(
      body.error ??
        "The file was uploaded, but its private review copy could not be prepared.",
    );
  }
  return { ...item, processingStatus: "ready" };
}

function isPreviewImageProof(document: WorkspacePreviewDocument): boolean {
  return Boolean(document.contentType?.startsWith("image/"));
}

function isPreviewPdfProof(document: WorkspacePreviewDocument): boolean {
  return document.contentType === "application/pdf";
}

function isPreviewHtmlProof(document: WorkspacePreviewDocument): boolean {
  const filename = document.originalFilename?.trim().toLowerCase() ?? "";
  return (
    document.contentType === "text/html" ||
    filename.endsWith(".html") ||
    filename.endsWith(".htm")
  );
}

function isPreviewGeneratedPageProof(
  document: WorkspacePreviewDocument,
): boolean {
  return (
    document.contentType === "generated_page" ||
    Boolean(document.generatedPagePath)
  );
}

function canFramePreviewProof(url: string | null): url is string {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function workspacePreviewDocumentKindLabel(
  document: WorkspacePreviewDocument,
): string {
  if (document.wireframe) return "Content Wireframe";
  if (isPreviewGeneratedPageProof(document)) return "Generated page";
  if (isPreviewPdfProof(document)) return "PDF";
  if (isPreviewHtmlProof(document)) return "Website proof";
  if (document.proofContent) return "Page proof";
  if (isPreviewImageProof(document)) return "Image";
  return document.contentType ?? "Proof";
}

function workspacePreviewDocumentKey(
  document: WorkspacePreviewDocument,
): string {
  return `${document.itemId}:${document.versionId ?? "draft"}`;
}

function workspacePreviewDocumentUrl(
  document: WorkspacePreviewDocument,
): string | null {
  if (isPreviewGeneratedPageProof(document)) {
    return (
      document.previewUrl ??
      (document.proofUrl && document.proofUrl !== document.generatedPagePath
        ? document.proofUrl
        : null)
    );
  }
  return document.previewUrl ?? document.proofUrl;
}

export function workspacePreviewDocumentNeedsPreparation(
  document: WorkspacePreviewDocument,
): boolean {
  return !document.wireframe && !document.proofContent && !workspacePreviewDocumentUrl(document);
}

function workspacePreviewDocumentIcon(
  document: WorkspacePreviewDocument,
  selected: boolean,
) {
  const className = cn(
    "size-4 shrink-0",
    selected ? "text-white" : "text-ember",
  );
  if (isPreviewImageProof(document))
    return <ImageIcon className={className} aria-hidden="true" />;
  if (isPreviewGeneratedPageProof(document) || document.proofContent || document.wireframe)
    return <Monitor className={className} aria-hidden="true" />;
  return <FileText className={className} aria-hidden="true" />;
}

export function WorkspacePreviewProof({
  document,
  comments = [],
  immersive = false,
  commentMode = false,
  pendingPin = null,
  pendingPinNumber = null,
  onPlacePin,
  assetUrl,
}: {
  document: WorkspacePreviewDocument;
  comments?: WorkspacePreviewComment[];
  immersive?: boolean;
  commentMode?: boolean;
  pendingPin?: { xRatio: number; yRatio: number } | null;
  pendingPinNumber?: number | null;
  onPlacePin?: (point: { xRatio: number; yRatio: number }) => void;
  assetUrl?: (assetId: string) => string | null;
}) {
  const proofUrl = workspacePreviewDocumentUrl(document);
  const canFrame = canFramePreviewProof(proofUrl);
  const pins = comments.filter(
    (comment) =>
      comment.commentKind === "pin" &&
      comment.xRatio != null &&
      comment.yRatio != null,
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {document.originalFilename ??
              proofUrl ??
              document.generatedPagePath ??
              "Proof preview"}
          </div>
          <div className="text-xs text-muted-foreground">
            {workspacePreviewDocumentKindLabel(document)}
          </div>
        </div>
        {proofUrl && !isPreviewHtmlProof(document) ? (
          <a
            href={proofUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-ember hover:text-foreground"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open proof
          </a>
        ) : null}
      </div>
      <div className="relative">
        {document.wireframe ? (
          <ContentWireframeRenderer manifest={document.wireframe} assetUrl={assetUrl} />
        ) : document.proofContent ? (
          <article
            className={cn(
              "bg-white p-5 text-foreground sm:p-8",
              immersive && "min-h-[720px]",
            )}
          >
            <div className="text-xs font-semibold uppercase text-ember">
              {document.proofContent.eyebrow}
            </div>
            <h4 className="mt-2 font-heading text-2xl font-semibold">
              {document.proofContent.headline}
            </h4>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              {document.proofContent.body}
            </p>
            {document.proofContent.bullets.length ? (
              <ul className="mt-4 space-y-2 text-sm">
                {document.proofContent.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-ember"
                      aria-hidden="true"
                    />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-5 inline-flex rounded-md bg-ember px-3 py-2 text-sm font-medium text-white">
              {document.proofContent.cta}
            </div>
          </article>
        ) : isPreviewImageProof(document) && proofUrl ? (
          <img
            src={proofUrl}
            alt={`${document.title} proof`}
            className={cn(
              "w-full bg-white object-contain",
              immersive ? "h-[min(76vh,960px)]" : "max-h-[640px]",
            )}
          />
        ) : (isPreviewPdfProof(document) ||
            isPreviewHtmlProof(document) ||
            isPreviewGeneratedPageProof(document)) &&
          canFrame ? (
          <iframe
            src={proofUrl}
            title={`${document.title} proof`}
            className={cn(
              "w-full bg-white",
              immersive ? "h-[min(76vh,960px)]" : "h-[640px]",
            )}
            sandbox={
              isPreviewGeneratedPageProof(document)
                ? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                : isPreviewHtmlProof(document)
                  ? ""
                  : undefined
            }
          />
        ) : canFrame ? (
          <iframe
            src={proofUrl}
            title={`${document.title} proof`}
            className={cn(
              "w-full bg-white",
              immersive ? "h-[min(76vh,960px)]" : "h-[640px]",
            )}
          />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">
            This proof does not have a working preview yet. Attach the rendered
            page, PDF, or image file before starting review.
          </div>
        )}
        {pins.map((comment) => (
          <span
            key={comment.id}
            className="pointer-events-none absolute z-20 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-ember text-xs font-bold text-white shadow-lg"
            style={{
              left: `${comment.xRatio! * 100}%`,
              top: `${comment.yRatio! * 100}%`,
            }}
            aria-label={`Comment pin ${comment.pinNumber ?? ""}`}
          >
            {comment.pinNumber ?? "•"}
          </span>
        ))}
        {pendingPin ? (
          <span
            className="pointer-events-none absolute z-20 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[#17364b] text-xs font-bold text-white shadow-lg"
            style={{ left: `${pendingPin.xRatio * 100}%`, top: `${pendingPin.yRatio * 100}%` }}
            aria-label={`Pending comment pin ${pendingPinNumber ?? ""}`}
          >
            {pendingPinNumber ?? "•"}
          </span>
        ) : null}
        {commentMode && onPlacePin ? (
          <button
            type="button"
            aria-label="Place comment pin on document"
            className="absolute inset-0 z-10 cursor-crosshair bg-[#17364b]/5 outline-none focus-visible:ring-4 focus-visible:ring-ring/50"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              onPlacePin({
                xRatio: (event.clientX - bounds.left) / bounds.width,
                yRatio: (event.clientY - bounds.top) / bounds.height,
              });
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export function WorkspacePreviewScreen({
  documents,
  selectedDocumentKey,
  onSelectDocument,
  onAddPinComment,
  onSetThreadStatus,
  comments = [],
  decisions = [],
  reviewers = [],
  immersive = false,
  projectId,
}: {
  documents: WorkspacePreviewDocument[];
  selectedDocumentKey: string | null;
  onSelectDocument: (key: string) => void;
  onAddPinComment?: (input: {
    document: WorkspacePreviewDocument;
    body: string;
    xRatio: number;
    yRatio: number;
  }) => Promise<boolean>;
  onSetThreadStatus?: (
    threadId: string,
    status: "resolved" | "declined" | "needs_clarification",
  ) => Promise<boolean>;
  comments?: StaffReviewWorkspaceResult["submittedComments"];
  decisions?: StaffReviewWorkspaceResult["decisions"];
  reviewers?: StaffReviewWorkspaceResult["reviewers"];
  immersive?: boolean;
  projectId?: string;
}) {
  const selectedDocument =
    documents.find(
      (document) =>
        workspacePreviewDocumentKey(document) === selectedDocumentKey,
    ) ??
    documents[0] ??
    null;

  const [mode, setMode] = useState<"comment" | "browse">("comment");
  const [pendingPin, setPendingPin] = useState<{ xRatio: number; yRatio: number } | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [updatingThreadId, setUpdatingThreadId] = useState<string | null>(null);
  const selectedComments = selectedDocument
    ? comments.filter((comment) => comment.reviewItemId === selectedDocument.itemId)
    : [];
  const selectedDecisions = selectedDocument
    ? decisions.filter((decision) => decision.reviewItemId === selectedDocument.itemId)
    : [];
  const pendingPinNumber = Math.max(0, ...selectedComments.map((comment) => comment.pinNumber ?? 0)) + 1;

  if (!selectedDocument) return null;

  async function savePinComment() {
    if (!onAddPinComment || !pendingPin || !commentBody.trim()) return;
    setSavingComment(true);
    try {
      const saved = await onAddPinComment({
        document: selectedDocument,
        body: commentBody.trim(),
        ...pendingPin,
      });
      if (saved) {
        setPendingPin(null);
        setCommentBody("");
      }
    } finally {
      setSavingComment(false);
    }
  }

  return (
    <div
      className={cn(
        "grid min-w-0 gap-4",
        immersive
          ? "lg:grid-cols-[240px_minmax(0,1fr)_320px]"
          : "mt-4 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]",
      )}
    >
      <aside
        className={cn(
          "space-y-2",
          immersive && "rounded-xl border border-border bg-white p-3",
        )}
      >
        {immersive ? (
          <div className="px-1 pb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Files
          </div>
        ) : null}
        {documents.map((document, index) => {
          const key = workspacePreviewDocumentKey(document);
          const selected =
            key === workspacePreviewDocumentKey(selectedDocument);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setPendingPin(null);
                setCommentBody("");
                onSelectDocument(key);
              }}
              className={cn(
                "w-full rounded-md border p-3 text-left transition-colors",
                selected
                  ? "border-[#142838] bg-[#142838] text-white shadow-sm"
                  : "border-border bg-background hover:border-primary/50",
              )}
              aria-pressed={selected}
            >
              <div className="flex items-start gap-2">
                {workspacePreviewDocumentIcon(document, selected)}
                <div className="min-w-0">
                  <div
                    className={cn(
                      "text-xs",
                      selected ? "text-white" : "text-muted-foreground",
                    )}
                  >
                    File {index + 1}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm font-medium">
                    {document.title}
                  </div>
                  <div
                    className={cn(
                      "mt-2 text-xs capitalize",
                      selected ? "text-white" : "text-muted-foreground",
                    )}
                  >
                    {workspacePreviewDocumentKindLabel(document)} ·{" "}
                    {document.processingStatus.replaceAll("_", " ")}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </aside>
      <div className="min-w-0 space-y-3">
        <div
          className={cn(
            immersive &&
              "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3",
          )}
        >
          <div>
            <div className="font-medium">{selectedDocument.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {selectedDocument.processingStatus.replaceAll("_", " ")} ·{" "}
              {selectedDocument.status.replaceAll("_", " ")}
            </div>
          </div>
          {immersive ? (
            <div className="inline-flex rounded-lg bg-[#f7f8f9] p-1 text-xs font-medium">
              <button
                type="button"
                aria-label="Comment mode"
                aria-pressed={mode === "comment"}
                onClick={() => setMode("comment")}
                className={cn("rounded-md px-3 py-1.5", mode === "comment" ? "bg-[#17364b] text-white" : "text-muted-foreground")}
              >
                Comment
              </button>
              <button
                type="button"
                aria-label="Browse mode"
                aria-pressed={mode === "browse"}
                onClick={() => {
                  setMode("browse");
                  setPendingPin(null);
                  setCommentBody("");
                }}
                className={cn("rounded-md px-3 py-1.5", mode === "browse" ? "bg-white text-[#142838] shadow-sm" : "text-muted-foreground")}
              >
                Browse
              </button>
            </div>
          ) : null}
        </div>
        {selectedDocument.versionNote ? <p className="rounded-lg border border-border bg-white p-3 text-sm"><strong>Version note:</strong> {selectedDocument.versionNote}</p> : null}
        {selectedDocument.markdownDiff.length ? (
          <details className="rounded-lg border border-border bg-white p-3 text-sm">
            <summary className="cursor-pointer font-medium">Markdown changes from the base version</summary>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs">{selectedDocument.markdownDiff.map((line, index) => <span key={`${index}:${line.kind}`} className={`block ${line.kind === "added" ? "text-success" : line.kind === "removed" ? "text-destructive" : "text-muted-foreground"}`}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}{line.line}</span>)}</pre>
          </details>
        ) : null}
        <WorkspacePreviewProof
          document={selectedDocument}
          comments={selectedComments}
          immersive={immersive}
          commentMode={immersive && mode === "comment"}
          pendingPin={pendingPin}
          pendingPinNumber={pendingPinNumber}
          onPlacePin={onAddPinComment ? setPendingPin : undefined}
          assetUrl={projectId ? (assetId) => `/api/ops/bsm/review-workspace/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(selectedDocument.itemId)}/draft?assetId=${encodeURIComponent(assetId)}` : undefined}
        />
      </div>
      {immersive ? (
        <aside className="rounded-xl border border-border bg-white p-4 lg:max-h-[calc(100vh-154px)] lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
            <div className="font-heading font-semibold text-[#142838]">
              Review notes
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {selectedComments.length}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {pendingPin ? (
              <div className="rounded-xl border border-[#17364b]/20 bg-[#f7f8f9] p-3">
                <Label htmlFor="staff-review-comment">Pin {pendingPinNumber} comment</Label>
                <textarea
                  id="staff-review-comment"
                  aria-label="Comment text"
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="Describe the change for the client or PSG team."
                  className="mt-2 min-h-24 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={savePinComment}
                    disabled={savingComment || !commentBody.trim()}
                    className={cn(buttonVariants({ variant: "default", size: "sm" }), "bg-[#17364b] hover:bg-[#17364b]/90")}
                  >
                    {savingComment ? "Saving" : "Save comment"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPin(null);
                      setCommentBody("");
                    }}
                    disabled={savingComment}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {selectedComments.length === 0 ? (
              <div className="rounded-xl bg-[#f7f8f9] p-4 text-sm text-muted-foreground">
                No notes on this file yet.
              </div>
            ) : (
              selectedComments.map((comment) => (
                <article
                  key={comment.id}
                  className="rounded-xl border border-border p-3 text-sm"
                >
                  <div className="flex items-center gap-2 font-medium text-[#142838]">
                    {comment.commentKind === "highlight" ? (
                      <Highlighter
                        className="size-4 text-warning"
                        aria-hidden="true"
                      />
                    ) : comment.commentKind === "pin" ? (
                      <MapPin
                        className="size-4 text-ember"
                        aria-hidden="true"
                      />
                    ) : (
                      <MessageSquare
                        className="size-4 text-[#17364b]"
                        aria-hidden="true"
                      />
                    )}
                    <span>{comment.authorDisplayName}</span>
                    {comment.pinNumber ? (
                      <span className="ml-auto rounded-full bg-ember/10 px-2 py-0.5 text-xs text-ember">
                        Pin {comment.pinNumber}
                      </span>
                    ) : null}
                  </div>
                  {comment.selection ? (
                    <p className="mt-2 border-l-2 border-warning pl-2 text-xs italic text-muted-foreground">
                      “{comment.selection.text}”
                    </p>
                  ) : null}
                  <p className="mt-2 leading-5">{comment.body}</p>
                  <div className="mt-2 flex items-center justify-between text-xs capitalize text-muted-foreground">
                    <span>{comment.threadStatus}</span>
                    <span>
                      {comment.createdAt ? formatDate(comment.createdAt) : ""}
                    </span>
                  </div>
                  {onSetThreadStatus && (comment.commentKind === "pin" || comment.commentKind === "highlight") ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                      {([
                        ["resolved", "Resolved"],
                        ["declined", "Declined"],
                        ["needs_clarification", "Needs clarification"],
                      ] as const).map(([status, label]) => (
                        <button
                          key={status}
                          type="button"
                          className={buttonVariants({ variant: comment.threadStatus === status ? "default" : "outline", size: "sm" })}
                          disabled={updatingThreadId === comment.threadId}
                          onClick={async () => {
                            setUpdatingThreadId(comment.threadId);
                            try {
                              await onSetThreadStatus(comment.threadId, status);
                            } finally {
                              setUpdatingThreadId(null);
                            }
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
          {selectedDecisions.length ? (
            <div className="mt-5 border-t border-border pt-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Decisions
              </div>
              {selectedDecisions.map((decision) => (
                <div
                  key={decision.id}
                  className="mt-3 rounded-xl bg-[#f7f8f9] p-3 text-sm"
                >
                  <div className="font-medium capitalize text-[#142838]">
                    {decision.decision.replaceAll("_", " ")}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {decision.actorDisplayName}
                  </div>
                  {decision.message ? (
                    <p className="mt-2">{decision.message}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-5 border-t border-border pt-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Reviewers
            </div>
            {reviewers.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No reviewers invited yet.
              </p>
            ) : (
              reviewers.map((reviewer) => (
                <div
                  key={reviewer.invitationId}
                  className="mt-3 flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate">
                    {reviewer.name ?? reviewer.email}
                  </span>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {reviewer.status.replaceAll("_", " ")}
                  </span>
                </div>
              ))
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

export function getBsmContentApprovalsSelectionUrl(
  currentHref: string,
  selection: { shopId: string; workspaceId: string },
) {
  const url = new URL(currentHref);
  const shopId = selection.shopId.trim();
  const workspaceId = selection.workspaceId.trim();

  if (shopId) {
    url.searchParams.set("shopId", shopId);
  } else {
    url.searchParams.delete("shopId");
  }

  if (workspaceId) {
    url.searchParams.set("workspaceId", workspaceId);
  } else {
    url.searchParams.delete("workspaceId");
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function replaceBsmContentApprovalsSelectionUrl(selection: {
  shopId: string;
  workspaceId: string;
}) {
  const nextUrl = getBsmContentApprovalsSelectionUrl(
    window.location.href,
    selection,
  );
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, "", nextUrl);
  }
}

export function BsmContentApprovalManager({
  initialApprovals,
  workspaces = [],
  shops,
  reviewerContacts = [],
  activeShopId,
  activeWorkspaceProjectId,
  canManageWorkspaces = false,
}: {
  initialApprovals: BsmContentApprovalListItem[];
  workspaces?: BsmContentApprovalWorkspaceOption[];
  shops?: BsmContentApprovalShopOption[];
  reviewerContacts?: BsmContentApprovalReviewerContact[];
  activeShopId?: string | null;
  activeWorkspaceProjectId?: string | null;
  canManageWorkspaces?: boolean;
}) {
  const [approvals, setApprovals] = useState(initialApprovals);
  const [workspaceOptions, setWorkspaceOptions] = useState(workspaces);
  const orderedShops = shops ?? [];
  const initialWorkspace = workspaceOptions.find(
    (workspace) => workspace.id === activeWorkspaceProjectId,
  );
  const requestedShopId = initialWorkspace?.shopId ?? activeShopId;
  const initialShopId = orderedShops.some((shop) => shop.id === requestedShopId)
    ? (requestedShopId ?? "")
    : (orderedShops[0]?.id ?? "");
  const [shopId, setShopId] = useState(initialShopId);
  const [customerProfileId, setCustomerProfileId] = useState("");
  const [reviewWorkspaceProjectId, setReviewWorkspaceProjectId] = useState(
    initialWorkspace && initialWorkspace.shopId === initialShopId
      ? initialWorkspace.id
      : "",
  );
  const [title, setTitle] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<
    "uploaded_file" | "generated_page"
  >("uploaded_file");
  const [generatedPagePath, setGeneratedPagePath] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [sourceContentItemId, setSourceContentItemId] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [archiveItemId, setArchiveItemId] = useState<string | null>(null);
  const [archivingItemId, setArchivingItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContextNote, setEditContextNote] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [savingEditItemId, setSavingEditItemId] = useState<string | null>(null);
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedShopWorkspaces = useMemo(
    () => workspaceOptions.filter((workspace) => workspace.shopId === shopId),
    [workspaceOptions, shopId],
  );
  const workspaceDocuments = useMemo(
    () =>
      approvals.filter(
        (item) => item.reviewWorkspace?.projectId === reviewWorkspaceProjectId,
      ),
    [approvals, reviewWorkspaceProjectId],
  );
  const visibleWorkspaceDocuments = reviewWorkspaceProjectId
    ? workspaceDocuments
    : [];
  const selectedWorkspace = useMemo(
    () =>
      workspaceOptions.find(
        (workspace) => workspace.id === reviewWorkspaceProjectId,
      ) ?? null,
    [workspaceOptions, reviewWorkspaceProjectId],
  );

  const fileValidationError = useMemo(
    () => getBsmContentApprovalFileValidationError(file),
    [file],
  );
  const formValidationError = useMemo(() => {
    if (!shopId.trim()) return "Shop ID is required.";
    if (!reviewWorkspaceProjectId.trim())
      return "Review Workspace is required.";
    if (!title.trim()) return "Title is required.";
    if (!contextNote.trim()) return "Context note is required.";
    if (sourceKind !== "generated_page") return null;
    if (!generatedPagePath.trim()) return "Generated page path is required.";
    if (previewUrl.trim()) {
      try {
        const url = new URL(previewUrl.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:")
          return "Preview URL must be a web URL.";
      } catch {
        return "Preview URL must be a valid URL.";
      }
    }
    return null;
  }, [
    shopId,
    reviewWorkspaceProjectId,
    title,
    contextNote,
    sourceKind,
    generatedPagePath,
    previewUrl,
  ]);
  const validationError = fileValidationError ?? formValidationError;

  const uploading = phase.kind === "uploading";
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [workspaceInstructions, setWorkspaceInstructions] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [selectedReviewers, setSelectedReviewers] = useState<
    BsmContentApprovalReviewerContact[]
  >([]);
  const [startingReview, setStartingReview] = useState(false);
  const [startedReview, setStartedReview] = useState<
    Extract<ReviewStartResponse, { review: unknown }>["review"] | null
  >(null);
  const [previewingWorkspace, setPreviewingWorkspace] = useState(false);
  const [workspacePreview, setWorkspacePreview] = useState<
    Extract<WorkspacePreviewResponse, { result: unknown }>["result"] | null
  >(null);
  const [selectedPreviewDocumentKey, setSelectedPreviewDocumentKey] = useState<
    string | null
  >(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null,
  );
  const [workspaceEditTitle, setWorkspaceEditTitle] = useState("");
  const [workspaceEditInstructions, setWorkspaceEditInstructions] =
    useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [addingCollaborator, setAddingCollaborator] = useState(false);
  const [removingWorkspaceId, setRemovingWorkspaceId] = useState<string | null>(
    null,
  );
  const [closeReason, setCloseReason] = useState("");
  const [closingRound, setClosingRound] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState<
    string | null
  >(null);
  const [showCreatePanel, setShowCreatePanel] = useState(
    workspaceOptions.length === 0,
  );
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const selectedShopName =
    orderedShops.find((shop) => shop.id === shopId)?.name ?? "Client workspace";
  const filteredShopWorkspaces = selectedShopWorkspaces.filter((workspace) =>
    workspace.title
      .toLowerCase()
      .includes(workspaceSearch.trim().toLowerCase()),
  );
  const startBlocker = getBsmReviewWorkspaceStartBlocker({
    workspaceId: reviewWorkspaceProjectId,
    workspaceStatus: selectedWorkspace?.status,
    documents: workspaceDocuments,
    reviewers: selectedReviewers,
  });
  const canSubmit =
    !uploading &&
    !validationError &&
    (sourceKind === "generated_page"
      ? Boolean(generatedPagePath.trim())
      : Boolean(file));

  useEffect(() => {
    replaceBsmContentApprovalsSelectionUrl({
      shopId,
      workspaceId: reviewWorkspaceProjectId,
    });
  }, [shopId, reviewWorkspaceProjectId]);

  async function createWorkspace() {
    if (!shopId.trim() || !workspaceTitle.trim()) {
      setPhase({
        kind: "error",
        message: "Choose a shop and enter a workspace title.",
      });
      return;
    }
    setCreatingWorkspace(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch("/api/ops/bsm/review-workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_workspace",
          shopId,
          title: workspaceTitle.trim(),
          description: workspaceInstructions.trim() || null,
        }),
      });
      const body = (await response
        .json()
        .catch(() => ({}))) as WorkspaceCreateResponse;
      if (!response.ok || !("workspace" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The Review Workspace could not be created.",
        );
      }
      const workspace = {
        id: body.workspace.id,
        shopId: body.workspace.shopId,
        title: body.workspace.title,
        status: body.workspace.status,
        currentRoundId: null,
        documentCount: 0,
      };
      setWorkspaceOptions((current) => [
        workspace,
        ...current.filter((entry) => entry.id !== workspace.id),
      ]);
      setReviewWorkspaceProjectId(workspace.id);
      replaceBsmContentApprovalsSelectionUrl({
        shopId: workspace.shopId,
        workspaceId: workspace.id,
      });
      setWorkspaceTitle("");
      setWorkspaceInstructions("");
      setWorkspacePreview(null);
      setStartedReview(null);
      setShowCreatePanel(false);
      setShowUploadPanel(true);
      setPhase({
        kind: "success",
        message: "The Review Workspace is ready for documents and reviewers.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The Review Workspace could not be created.",
      });
    } finally {
      setCreatingWorkspace(false);
    }
  }

  function addReviewer(contact: BsmContentApprovalReviewerContact) {
    if (!contact.email.trim()) return;
    setSelectedReviewers((current) => {
      const email = contact.email.trim().toLowerCase();
      if (current.some((reviewer) => reviewer.email.toLowerCase() === email))
        return current;
      return [...current, { email, name: contact.name?.trim() || null }];
    });
    setReviewerEmail("");
    setReviewerName("");
    setStartedReview(null);
  }

  async function copyInvitation(
    invitation: NonNullable<typeof startedReview>["invitations"][number],
  ) {
    const url = `${window.location.origin}/review-workspace?invite=${encodeURIComponent(invitation.inviteToken)}`;
    try {
      await navigator.clipboard.writeText(
        `${url}\nOne-time code: ${invitation.inviteCode}`,
      );
      setPhase({
        kind: "success",
        message: `Copied the private link and code for ${invitation.reviewerName ?? invitation.reviewerEmail}.`,
      });
    } catch {
      setPhase({
        kind: "error",
        message:
          "Clipboard access was denied. Select the link and code below to copy them manually.",
      });
    }
  }

  async function loadWorkspacePreview(
    projectId = reviewWorkspaceProjectId,
    preferredItemId?: string,
  ) {
    if (!projectId) return;
    setPreviewingWorkspace(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(
        `/api/ops/bsm/review-workspace/projects/${projectId}`,
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as WorkspacePreviewResponse;
      if (!response.ok || !("result" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The Review Workspace preview could not be loaded.",
        );
      }
      let result = body.result;
      let selectedDocument =
        result.documents.find(
          (document) => document.itemId === preferredItemId,
        ) ?? result.documents[0];
      const sourceItem = preferredItemId
        ? approvals.find((item) => item.id === preferredItemId)
        : null;
      if (
        selectedDocument &&
        workspacePreviewDocumentNeedsPreparation(selectedDocument) &&
        sourceItem?.sourceKind === "uploaded_file" &&
        sourceItem.currentVersion?.id
      ) {
        const preparedItem = await prepareUploadedReviewCopy(sourceItem);
        setApprovals((current) =>
          current.map((item) =>
            item.id === preparedItem.id ? preparedItem : item,
          ),
        );
        const refreshedResponse = await fetch(
          `/api/ops/bsm/review-workspace/projects/${projectId}`,
          { headers: { "Cache-Control": "no-store" } },
        );
        const refreshedBody = (await refreshedResponse
          .json()
          .catch(() => ({}))) as WorkspacePreviewResponse;
        if (!refreshedResponse.ok || !("result" in refreshedBody)) {
          throw new Error(
            "error" in refreshedBody && refreshedBody.error
              ? refreshedBody.error
              : "The prepared review copy could not be loaded.",
          );
        }
        result = refreshedBody.result;
        selectedDocument =
          result.documents.find(
            (document) => document.itemId === preferredItemId,
          ) ?? result.documents[0];
      }
      setWorkspacePreview(result);
      const reusableReviewers = result.reviewers
        .filter((reviewer) => !reviewer.revokedAt)
        .map((reviewer) => ({ email: reviewer.email, name: reviewer.name }));
      if (reusableReviewers.length > 0) {
        setSelectedReviewers((current) =>
          current.length > 0 ? current : reusableReviewers,
        );
      }
      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === result.project.id
            ? {
                ...workspace,
                status: result.project.status,
                currentRoundId: result.project.currentRoundId,
              }
            : workspace,
        ),
      );
      setSelectedPreviewDocumentKey(
        selectedDocument ? workspacePreviewDocumentKey(selectedDocument) : null,
      );
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The Review Workspace preview could not be loaded.",
      });
    } finally {
      setPreviewingWorkspace(false);
    }
  }

  async function addWorkspacePinComment(input: {
    document: WorkspacePreviewDocument;
    body: string;
    xRatio: number;
    yRatio: number;
  }): Promise<boolean> {
    if (!reviewWorkspaceProjectId || !input.document.versionId) return false;
    try {
      const response = await fetch(`/api/ops/bsm/review-workspace/projects/${reviewWorkspaceProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_annotation",
          reviewItemId: input.document.itemId,
          versionId: input.document.versionId,
          body: input.body,
          viewport: input.document.contentType === "application/pdf" ? "pdf_page" : "desktop",
          xRatio: input.xRatio,
          yRatio: input.yRatio,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as WorkspaceCommentResponse;
      if (!response.ok || !("comment" in body)) {
        throw new Error("error" in body && body.error ? body.error : "The comment could not be saved.");
      }
      await loadWorkspacePreview(reviewWorkspaceProjectId, input.document.itemId);
      setPhase({ kind: "success", message: "Comment added to the review." });
      return true;
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The comment could not be saved.",
      });
      return false;
    }
  }

  async function setWorkspaceThreadStatus(
    threadId: string,
    status: "resolved" | "declined" | "needs_clarification",
  ): Promise<boolean> {
    if (!reviewWorkspaceProjectId) return false;
    try {
      const response = await fetch(`/api/ops/bsm/review-workspace/projects/${reviewWorkspaceProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_thread_status", threadId, status }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The feedback disposition could not be saved.");
      setWorkspacePreview((current) => current ? {
        ...current,
        submittedComments: current.submittedComments.map((comment) =>
          comment.threadId === threadId ? { ...comment, threadStatus: status } : comment,
        ),
      } : current);
      setPhase({ kind: "success", message: "Feedback disposition saved." });
      return true;
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The feedback disposition could not be saved.",
      });
      return false;
    }
  }

  async function addWorkspaceCollaborator() {
    if (!reviewWorkspaceProjectId || !collaboratorEmail.trim()) return;
    setAddingCollaborator(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(`/api/ops/bsm/review-workspace/projects/${reviewWorkspaceProjectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_collaborator", email: collaboratorEmail.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "The PSG collaborator could not be added.");
      setCollaboratorEmail("");
      setPhase({ kind: "success", message: "PSG Workspace Collaborator added." });
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : "The PSG collaborator could not be added." });
    } finally {
      setAddingCollaborator(false);
    }
  }

  function openWorkspace(
    workspace: BsmContentApprovalWorkspaceOption,
    share = false,
  ) {
    setShopId(workspace.shopId);
    setReviewWorkspaceProjectId(workspace.id);
    replaceBsmContentApprovalsSelectionUrl({
      shopId: workspace.shopId,
      workspaceId: workspace.id,
    });
    setWorkspacePreview(null);
    setStartedReview(null);
    setShowCreatePanel(false);
    setShowUploadPanel(false);
    setShowInvitePanel(share);
    if (!share) {
      const firstItemId = approvals.find(
        (item) => item.reviewWorkspace?.projectId === workspace.id,
      )?.id;
      void loadWorkspacePreview(workspace.id, firstItemId);
    }
  }

  async function startWorkspaceReview() {
    if (startBlocker) {
      setPhase({ kind: "error", message: startBlocker });
      return;
    }
    setStartingReview(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch("/api/ops/bsm/review-workspace/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start_review",
          projectId: reviewWorkspaceProjectId,
          reviewers: selectedReviewers,
        }),
      });
      const body = (await response
        .json()
        .catch(() => ({}))) as ReviewStartResponse;
      if (!response.ok || !("review" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The review could not be started.",
        );
      }
      setStartedReview(body.review);
      setWorkspacePreview(null);
      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === reviewWorkspaceProjectId
            ? {
                ...workspace,
                status: "active",
                currentRoundId: body.review.roundId,
              }
            : workspace,
        ),
      );
      setApprovals((current) =>
        current.map((item) =>
          item.reviewWorkspace?.projectId === reviewWorkspaceProjectId
            ? {
                ...item,
                status: "in_review",
                reviewWorkspace: {
                  ...item.reviewWorkspace,
                  roundId: body.review.roundId,
                },
              }
            : item,
        ),
      );
      setPhase({
        kind: body.failedDeliveryCount ? "error" : "success",
        message: body.failedDeliveryCount
          ? `The review started, but ${body.failedDeliveryCount} invitation email${body.failedDeliveryCount === 1 ? "" : "s"} could not be sent. Share the private link and code shown below.`
          : "The review has started and each reviewer was emailed. You can also copy their private link and code below.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The review could not be started.",
      });
    } finally {
      setStartingReview(false);
    }
  }

  async function closeWorkspaceRound() {
    if (!selectedWorkspace || !closeReason.trim()) {
      setPhase({
        kind: "error",
        message: "Enter a reason before closing the round.",
      });
      return;
    }
    setClosingRound(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(
        `/api/ops/bsm/review-workspace/projects/${selectedWorkspace.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "close_early",
            reason: closeReason.trim(),
          }),
        },
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as WorkspaceCloseResponse;
      if (!response.ok || !("closure" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The review round could not be closed.",
        );
      }
      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === selectedWorkspace.id
            ? { ...workspace, status: "closed_early" }
            : workspace,
        ),
      );
      setCloseReason("");
      await loadWorkspacePreview();
      const count = body.closure.nonresponders.length;
      setPhase({
        kind: "success",
        message: count
          ? `The round was closed. ${count} pending reviewer invitation${count === 1 ? " was" : "s were"} revoked.`
          : "The round was closed early and the submitted feedback remains available.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The review round could not be closed.",
      });
    } finally {
      setClosingRound(false);
    }
  }

  async function revokeReviewerInvitation(
    reviewer: Extract<
      WorkspacePreviewResponse,
      { result: unknown }
    >["result"]["reviewers"][number],
  ) {
    if (
      !selectedWorkspace ||
      !confirm(
        `Revoke ${reviewer.name ?? reviewer.email} from this review round?`,
      )
    )
      return;
    setRevokingInvitationId(reviewer.invitationId);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(
        `/api/ops/bsm/review-workspace/projects/${selectedWorkspace.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "revoke_invitation",
            invitationId: reviewer.invitationId,
            reason: `Removed ${reviewer.email} from the active review round by an administrator.`,
          }),
        },
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as InvitationRevokeResponse;
      if (!response.ok || !("revocation" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The reviewer invitation could not be revoked.",
        );
      }
      await loadWorkspacePreview();
      setPhase({
        kind: "success",
        message: body.revocation.roundCompleted
          ? `The reviewer was revoked and the round completed as ${body.revocation.outcome?.replaceAll("_", " ")}.`
          : "The reviewer was revoked and no longer counts toward round completion.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The reviewer invitation could not be revoked.",
      });
    } finally {
      setRevokingInvitationId(null);
    }
  }

  function beginWorkspaceEdit() {
    if (!selectedWorkspace) return;
    setEditingWorkspaceId(selectedWorkspace.id);
    setWorkspaceEditTitle(selectedWorkspace.title);
    setWorkspaceEditInstructions("");
    setPhase({ kind: "idle" });
  }

  async function saveWorkspaceEdit() {
    if (!selectedWorkspace || editingWorkspaceId !== selectedWorkspace.id)
      return;
    if (!workspaceEditTitle.trim()) {
      setPhase({ kind: "error", message: "Workspace title is required." });
      return;
    }

    setSavingWorkspace(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(
        `/api/ops/bsm/review-workspace/projects/${selectedWorkspace.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_workspace",
            title: workspaceEditTitle.trim(),
            description: workspaceEditInstructions.trim() || null,
          }),
        },
      );
      const body = (await response
        .json()
        .catch(() => ({}))) as WorkspaceUpdateResponse;
      if (!response.ok || !("workspace" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The Review Workspace could not be updated.",
        );
      }

      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === body.workspace.id
            ? {
                ...workspace,
                title: body.workspace.title,
                status: body.workspace.status,
              }
            : workspace,
        ),
      );
      setApprovals((current) =>
        current.map((item) =>
          item.reviewWorkspace?.projectId === body.workspace.id
            ? {
                ...item,
                reviewWorkspace: {
                  ...item.reviewWorkspace,
                  projectTitle: body.workspace.title,
                },
              }
            : item,
        ),
      );
      setWorkspacePreview((current) =>
        current && current.project.id === body.workspace.id
          ? {
              ...current,
              project: {
                ...current.project,
                title: body.workspace.title,
                status: body.workspace.status,
              },
            }
          : current,
      );
      setEditingWorkspaceId(null);
      setWorkspaceEditInstructions("");
      setPhase({
        kind: "success",
        message: "The Review Workspace was updated.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The Review Workspace could not be updated.",
      });
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function removeWorkspace(
    workspace: BsmContentApprovalWorkspaceOption,
  ) {
    if (
      !confirm(
        `Delete review "${workspace.title}"? It will disappear from the admin dashboard and client review now, and remain recoverable for 30 days.`,
      )
    ) {
      return;
    }

    setRemovingWorkspaceId(workspace.id);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(
        `/api/ops/bsm/review-workspace/projects/${workspace.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Removed from the Content Approvals workspace controls.",
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? "The Review Workspace could not be removed.",
        );
      }

      const removedWorkspaceId = workspace.id;
      setWorkspaceOptions((current) =>
        current.filter((workspace) => workspace.id !== removedWorkspaceId),
      );
      setApprovals((current) =>
        current.filter(
          (item) => item.reviewWorkspace?.projectId !== removedWorkspaceId,
        ),
      );
      setReviewWorkspaceProjectId((current) =>
        current === removedWorkspaceId ? "" : current,
      );
      setEditingWorkspaceId(null);
      setWorkspacePreview(null);
      setSelectedPreviewDocumentKey(null);
      setStartedReview(null);
      setPhase({
        kind: "success",
        message: "The review was removed from the dashboard and client view.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The Review Workspace could not be removed.",
      });
    } finally {
      setRemovingWorkspaceId(null);
    }
  }

  async function startReviewItem() {
    const selectedFile = sourceKind === "uploaded_file" ? file : null;
    if (validationError || (sourceKind === "uploaded_file" && !selectedFile)) {
      setPhase({
        kind: "error",
        message: validationError ?? "Choose a file before uploading.",
      });
      return;
    }
    setPhase({ kind: "uploading" });

    let response: Response;
    try {
      response = await fetch("/api/ops/bsm/content-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: shopId.trim(),
          customerProfileId: customerProfileId.trim() || null,
          reviewWorkspaceProjectId: reviewWorkspaceProjectId.trim() || null,
          title: title.trim(),
          contextNote: contextNote.trim(),
          sourceKind,
          ...(sourceKind === "generated_page"
            ? {
                generatedPagePath: generatedPagePath.trim(),
                previewUrl: previewUrl.trim() || null,
                sourceContentItemId: sourceContentItemId.trim() || null,
              }
            : {
                fileName: selectedFile?.name,
                contentType: selectedFile
                  ? normalizeApprovalMimeType(
                      selectedFile.name,
                      selectedFile.type,
                    )
                  : null,
                byteSize: selectedFile?.size,
              }),
        }),
      });
    } catch {
      setPhase({
        kind: "error",
        message: "The upload service could not be reached.",
      });
      return;
    }

    let body: UploadResponse = {};
    try {
      body = (await response.json()) as UploadResponse;
    } catch {
      body = {};
    }
    if (!response.ok || !("item" in body)) {
      setPhase({
        kind: "error",
        message:
          "error" in body && body.error
            ? body.error
            : "The review item could not be created.",
      });
      return;
    }

    if ("upload" in body) {
      if (!selectedFile) {
        setPhase({ kind: "error", message: "Choose a file before uploading." });
        return;
      }
      const supabase = createClient();
      const contentType = getBsmContentApprovalStorageContentType(selectedFile);
      const fileBody = await selectedFile.arrayBuffer();
      const { error } = await supabase.storage
        .from(BSM_CONTENT_APPROVALS_BUCKET)
        .uploadToSignedUrl(body.upload.path, body.upload.token, fileBody, {
          contentType,
        });
      if (error) {
        setPhase({ kind: "error", message: `Upload failed: ${error.message}` });
        return;
      }
    }

    let savedItem = body.item;
    try {
      savedItem = await prepareUploadedReviewCopy(savedItem);
    } catch (error) {
      const failedItem = { ...savedItem, processingStatus: "failed" };
      setApprovals((current) => [failedItem, ...current]);
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The private review copy could not be prepared.",
      });
      return;
    }

    setApprovals((current) => [savedItem, ...current]);
    if (savedItem.reviewWorkspace?.projectId) {
      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === savedItem.reviewWorkspace?.projectId
            ? { ...workspace, documentCount: workspace.documentCount + 1 }
            : workspace,
        ),
      );
    }
    setTitle("");
    setContextNote("");
    setCustomerProfileId("");
    setFile(null);
    setGeneratedPagePath("");
    setPreviewUrl("");
    setSourceContentItemId("");
    if (fileRef.current) fileRef.current.value = "";
    setEditingItemId(null);
    setShowUploadPanel(false);
    setPhase({
      kind: "success",
      message: savedItem.reviewWorkspace
        ? "The file is processed and ready in the selected Review Workspace. You can preview it before sending."
        : "The item is in the customer review library. You can edit it before reviewer submission.",
    });
  }

  function beginEdit(item: BsmContentApprovalListItem) {
    setEditingItemId(item.id);
    setEditTitle(item.title);
    setEditContextNote(item.contextNote ?? "");
    setEditFile(null);
    setArchiveItemId(null);
    setPhase({ kind: "idle" });
  }

  async function saveReviewItemEdit(item: BsmContentApprovalListItem) {
    if (!editTitle.trim()) {
      setPhase({ kind: "error", message: "Title is required." });
      return;
    }
    if (!editContextNote.trim()) {
      setPhase({ kind: "error", message: "Context note is required." });
      return;
    }
    const editFileError = getBsmContentApprovalFileValidationError(editFile);
    if (editFileError) {
      setPhase({
        kind: "error",
        message: editFileError,
      });
      return;
    }

    setSavingEditItemId(item.id);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch("/api/ops/bsm/content-approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          title: editTitle.trim(),
          contextNote: editContextNote.trim(),
          ...(editFile
            ? {
                fileName: editFile.name,
                contentType: normalizeApprovalMimeType(
                  editFile.name,
                  editFile.type,
                ),
                byteSize: editFile.size,
              }
            : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as UploadResponse;
      if (!response.ok || !("item" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "The review item edits could not be saved.",
        );
      }

      if ("upload" in body && editFile) {
        const supabase = createClient();
        const contentType = getBsmContentApprovalStorageContentType(editFile);
        const fileBody = await editFile.arrayBuffer();
        const { error } = await supabase.storage
          .from(BSM_CONTENT_APPROVALS_BUCKET)
          .uploadToSignedUrl(body.upload.path, body.upload.token, fileBody, {
            contentType,
          });
        if (error) throw new Error(`Upload failed: ${error.message}`);
      }

      let savedItem = body.item;
      try {
        savedItem = await prepareUploadedReviewCopy(savedItem);
      } catch (error) {
        setApprovals((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? { ...savedItem, processingStatus: "failed" }
              : entry,
          ),
        );
        throw error;
      }
      setApprovals((current) =>
        current.map((entry) => (entry.id === item.id ? savedItem : entry)),
      );
      setEditingItemId(null);
      setEditFile(null);
      setPhase({
        kind: "success",
        message: "The review item edits were saved as the usable version.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The review item edits could not be saved.",
      });
    } finally {
      setSavingEditItemId(null);
    }
  }

  async function retryReviewItemProcessing(item: BsmContentApprovalListItem) {
    setRetryingItemId(item.id);
    setPhase({ kind: "idle" });
    try {
      const savedItem = await prepareUploadedReviewCopy(item);
      setApprovals((current) =>
        current.map((entry) => (entry.id === item.id ? savedItem : entry)),
      );
      await loadWorkspacePreview();
      setPhase({
        kind: "success",
        message: `${item.title} is processed and ready for review.`,
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The document could not be processed again.",
      });
    } finally {
      setRetryingItemId(null);
    }
  }

  async function archiveReviewItem(item: BsmContentApprovalListItem) {
    setArchivingItemId(item.id);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(
        `/api/ops/bsm/content-approvals?itemId=${encodeURIComponent(item.id)}`,
        {
          method: "DELETE",
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "The review item could not be archived.");
      }
      setApprovals((current) =>
        current.filter((entry) => entry.id !== item.id),
      );
      if (item.reviewWorkspace?.projectId) {
        setWorkspaceOptions((current) =>
          current.map((workspace) =>
            workspace.id === item.reviewWorkspace?.projectId
              ? {
                  ...workspace,
                  documentCount: Math.max(0, workspace.documentCount - 1),
                }
              : workspace,
          ),
        );
        setWorkspacePreview((current) => {
          if (
            !current ||
            current.project.id !== item.reviewWorkspace?.projectId
          ) {
            return current;
          }
          return {
            ...current,
            documents: current.documents.filter(
              (document) => document.itemId !== item.id,
            ),
            submittedComments: current.submittedComments.filter(
              (comment) => comment.reviewItemId !== item.id,
            ),
            decisions: current.decisions.filter(
              (decision) => decision.reviewItemId !== item.id,
            ),
          };
        });
        setSelectedPreviewDocumentKey((current) =>
          current?.startsWith(`${item.id}:`) ? null : current,
        );
      }
      setArchiveItemId(null);
      setPhase({
        kind: "success",
        message: "The file was removed from the admin dashboard and client review.",
      });
    } catch (error) {
      setPhase({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "The review item could not be archived.",
      });
    } finally {
      setArchivingItemId(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[#f5f6f7] shadow-[0_18px_60px_rgba(20,40,56,0.08)]">
      <header className="border-b border-border bg-white px-5 py-4 lg:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-52 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-ember">
              PSG Review Workspace
            </div>
            <div className="mt-1 font-heading text-xl font-semibold text-[#142838]">
              Upload. Share. Resolve.
            </div>
          </div>
          <div className="relative min-w-56">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={workspaceSearch}
              onChange={(event) => setWorkspaceSearch(event.target.value)}
              className="h-10 bg-[#f7f8f9] pl-9"
              placeholder="Search reviews"
              aria-label="Search reviews"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCreatePanel(true);
              setShowUploadPanel(false);
              setShowInvitePanel(false);
              setPhase({ kind: "idle" });
            }}
            className={cn(
              buttonVariants({ variant: "default" }),
              "h-10 gap-2 bg-[#17364b] px-4 hover:bg-[#0f2838]",
            )}
          >
            <Plus className="size-4" aria-hidden="true" />
            New review
          </button>
        </div>
      </header>

      <div className="grid min-h-[680px] lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="border-b border-border bg-[#f7f8f9] p-4 lg:border-b-0 lg:border-r">
          <Label
            htmlFor="bsm-approval-shop"
            className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground"
          >
            Client
          </Label>
          {orderedShops.length > 0 ? (
            <select
              id="bsm-approval-shop"
              value={shopId}
              onChange={(event) => {
                setShopId(event.target.value);
                setReviewWorkspaceProjectId("");
                replaceBsmContentApprovalsSelectionUrl({
                  shopId: event.target.value,
                  workspaceId: "",
                });
                setWorkspacePreview(null);
                setStartedReview(null);
                setShowUploadPanel(false);
                setShowInvitePanel(false);
              }}
              disabled={uploading || creatingWorkspace || startingReview}
              className="mt-2 h-10 w-full rounded-lg border border-border bg-white px-3 text-sm font-medium text-[#142838] shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ember/30"
            >
              {orderedShops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name || shop.id}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id="bsm-approval-shop"
              value={shopId}
              onChange={(event) => setShopId(event.target.value)}
              className="mt-2 bg-white"
              placeholder="Client shop"
            />
          )}

          <nav
            className="mt-6 space-y-1"
            aria-label="Review workspace navigation"
          >
            <button
              type="button"
              onClick={() => {
                setReviewWorkspaceProjectId("");
                replaceBsmContentApprovalsSelectionUrl({
                  shopId,
                  workspaceId: "",
                });
                setWorkspacePreview(null);
                setStartedReview(null);
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
                !selectedWorkspace
                  ? "bg-white text-[#142838] shadow-sm"
                  : "text-muted-foreground hover:bg-white/70 hover:text-foreground",
              )}
            >
              <FolderOpen className="size-4" aria-hidden="true" />
              All reviews
              <span className="ml-auto text-xs">
                {selectedShopWorkspaces.length}
              </span>
            </button>
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground">
              <Users className="size-4" aria-hidden="true" />
              In review
              <span className="ml-auto text-xs">
                {
                  selectedShopWorkspaces.filter(
                    (workspace) => workspace.status === "active",
                  ).length
                }
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground">
              <Check className="size-4" aria-hidden="true" />
              Completed
              <span className="ml-auto text-xs">
                {
                  selectedShopWorkspaces.filter(
                    (workspace) => workspace.status === "completed",
                  ).length
                }
              </span>
            </div>
          </nav>

          <div className="mt-8 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
            PDF, images, Word, Markdown, HTML and text files · 25 MB max each
          </div>
        </aside>

        <main className="min-w-0 bg-white p-5 lg:p-7">
          {phase.kind === "success" ? (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success-foreground">
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{phase.message}</span>
            </div>
          ) : null}
          {phase.kind === "error" ? (
            <div className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {phase.message}
            </div>
          ) : null}

          {showCreatePanel ? (
            <section className="mb-7 rounded-2xl border border-[#17364b]/20 bg-[#f7f8f9] p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ember">
                    New review
                  </div>
                  <h2 className="mt-1 font-heading text-xl font-semibold text-[#142838]">
                    What should the client review?
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Name it now, then add the first file. PSG keeps the
                    technical workspace details out of the way.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreatePanel(false)}
                  className="rounded-lg p-2 text-muted-foreground hover:bg-white hover:text-foreground"
                  aria-label="Close new review"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="bsm-workspace-title">Review name</Label>
                  <Input
                    id="bsm-workspace-title"
                    value={workspaceTitle}
                    onChange={(event) => setWorkspaceTitle(event.target.value)}
                    disabled={creatingWorkspace}
                    maxLength={180}
                    placeholder="August website updates"
                    className="bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bsm-workspace-instructions">
                    Client instructions{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    id="bsm-workspace-instructions"
                    value={workspaceInstructions}
                    onChange={(event) =>
                      setWorkspaceInstructions(event.target.value)
                    }
                    disabled={creatingWorkspace}
                    maxLength={4000}
                    placeholder="Please check wording, pricing and photos."
                    className="bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={createWorkspace}
                  disabled={
                    creatingWorkspace || !shopId || !workspaceTitle.trim()
                  }
                  className={cn(
                    buttonVariants({ variant: "default" }),
                    "gap-2 bg-[#17364b] hover:bg-[#0f2838]",
                  )}
                >
                  {creatingWorkspace ? (
                    <RefreshCw
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileUp className="size-4" aria-hidden="true" />
                  )}
                  {creatingWorkspace ? "Creating" : "Continue to upload"}
                </button>
              </div>
            </section>
          ) : null}

          {!selectedWorkspace ? (
            <section>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {selectedShopName}
                  </p>
                  <h2 className="mt-1 font-heading text-2xl font-semibold text-[#142838]">
                    Review dashboard
                  </h2>
                </div>
                <div className="text-sm text-muted-foreground">
                  {filteredShopWorkspaces.length} review
                  {filteredShopWorkspaces.length === 1 ? "" : "s"}
                </div>
              </div>

              {filteredShopWorkspaces.length > 0 ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredShopWorkspaces.map((workspace) => (
                    <article
                      key={workspace.id}
                      className="group overflow-hidden rounded-2xl border border-border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-ember/40 hover:shadow-lg"
                    >
                      <div className="flex min-h-40 items-center justify-center bg-gradient-to-br from-[#17364b] to-[#0b1720] p-5">
                        <div className="flex flex-wrap justify-center gap-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => openWorkspace(workspace)}
                            className={cn(
                              buttonVariants({ variant: "secondary" }),
                              "gap-2 bg-white text-[#142838] hover:bg-white/90",
                            )}
                          >
                            <FolderOpen className="size-4" aria-hidden="true" />
                            Open
                          </button>
                          <button
                            type="button"
                            onClick={() => openWorkspace(workspace, true)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white px-4 text-sm font-medium text-white hover:bg-white/10"
                          >
                            <Share2 className="size-4" aria-hidden="true" />
                            Share
                          </button>
                          {canManageWorkspaces ? (
                            <button
                              type="button"
                              onClick={() => removeWorkspace(workspace)}
                              disabled={removingWorkspaceId === workspace.id}
                              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/70 px-4 text-sm font-medium text-white hover:border-red-200 hover:bg-red-600/80 disabled:opacity-60"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              {removingWorkspaceId === workspace.id
                                ? "Deleting"
                                : "Delete"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                              workspace.status === "completed"
                                ? "bg-[#dff2e6] text-[#27623e]"
                                : workspace.status === "active"
                                  ? "bg-ember/10 text-ember"
                                  : "bg-muted text-foreground",
                            )}
                          >
                            {workspace.status === "active"
                              ? "In review"
                              : workspace.status.replaceAll("_", " ")}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openWorkspace(workspace)}
                          className="mt-1 line-clamp-2 text-left font-heading text-lg font-semibold text-[#142838] hover:text-ember"
                        >
                          {workspace.title}
                        </button>
                        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                          <span>
                            {workspace.documentCount} file
                            {workspace.documentCount === 1 ? "" : "s"}
                          </span>
                          <button
                            type="button"
                            onClick={() => openWorkspace(workspace)}
                            className="font-medium text-ember"
                          >
                            Open →
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => setShowCreatePanel(true)}
                className="mt-5 flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#17364b]/30 bg-[#f9fafb] px-6 text-center transition-colors hover:border-ember/50 hover:bg-ember/[0.03]"
              >
                <div className="flex size-14 items-center justify-center rounded-2xl bg-[#17364b] text-white shadow-lg">
                  <FileUp className="size-6" aria-hidden="true" />
                </div>
                <div className="mt-4 font-heading text-xl font-semibold text-[#142838]">
                  Upload files to start a review
                </div>
                <div className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                  Create a client review, add the proof, then invite the people
                  who need to approve it.
                </div>
              </button>
            </section>
          ) : (
            <section
              className={cn(
                workspacePreview &&
                  "fixed inset-0 z-[100] overflow-y-auto bg-[#eef0f2] p-4 lg:p-6",
              )}
            >
              <div
                className={cn(
                  "flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5",
                  workspacePreview &&
                    "sticky top-0 z-20 -mx-4 -mt-4 bg-white px-4 pt-4 shadow-sm lg:-mx-6 lg:-mt-6 lg:px-6 lg:pt-5",
                )}
              >
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      setReviewWorkspaceProjectId("");
                      replaceBsmContentApprovalsSelectionUrl({
                        shopId,
                        workspaceId: "",
                      });
                      setWorkspacePreview(null);
                      setStartedReview(null);
                      setShowUploadPanel(false);
                      setShowInvitePanel(false);
                    }}
                    className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Review dashboard
                  </button>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-heading text-2xl font-semibold text-[#142838]">
                      {selectedWorkspace.title}
                    </h2>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        selectedWorkspace.status === "completed"
                          ? "bg-[#dff2e6] text-[#27623e]"
                          : selectedWorkspace.status === "active"
                            ? "bg-ember/10 text-ember"
                            : "bg-muted text-foreground",
                      )}
                    >
                      {selectedWorkspace.status === "active"
                        ? "In review"
                        : selectedWorkspace.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {workspaceDocuments.length} file
                    {workspaceDocuments.length === 1 ? "" : "s"} ·{" "}
                    {workspaceDocuments.reduce(
                      (total, item) => total + item.commentCount,
                      0,
                    )}{" "}
                    comment
                    {workspaceDocuments.reduce(
                      (total, item) => total + item.commentCount,
                      0,
                    ) === 1
                      ? ""
                      : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {workspacePreview ? (
                    <button
                      type="button"
                      onClick={() => setWorkspacePreview(null)}
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "gap-2 bg-white",
                      )}
                    >
                      <FilePenLine className="size-4" aria-hidden="true" />
                      Manage files
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspacePreview(null);
                      setShowUploadPanel((current) => !current);
                      setShowInvitePanel(false);
                      setPhase({ kind: "idle" });
                    }}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "gap-2",
                    )}
                  >
                    <FileUp className="size-4" aria-hidden="true" />
                    Add files
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspacePreview(null);
                      setShowInvitePanel((current) => !current);
                      setShowUploadPanel(false);
                      setPhase({ kind: "idle" });
                    }}
                    className={cn(
                      buttonVariants({ variant: "default" }),
                      "gap-2 bg-[#17364b] hover:bg-[#0f2838]",
                    )}
                  >
                    <Share2 className="size-4" aria-hidden="true" />
                    Share
                  </button>
                </div>
              </div>

              {showUploadPanel ? (
                <div className="mt-5 rounded-2xl border border-ember/20 bg-ember/[0.035] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-heading text-lg font-semibold text-[#142838]">
                        Add a proof
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Upload a file, or attach an existing PSG-generated page.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowUploadPanel(false)}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-white"
                      aria-label="Close upload panel"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-4 inline-flex rounded-lg border border-border bg-white p-1">
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium",
                        sourceKind === "uploaded_file"
                          ? "bg-[#17364b] text-white"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setSourceKind("uploaded_file")}
                    >
                      Upload file
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm font-medium",
                        sourceKind === "generated_page"
                          ? "bg-[#17364b] text-white"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setSourceKind("generated_page")}
                    >
                      Generated page
                    </button>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="bsm-approval-title">Proof title</Label>
                      <Input
                        id="bsm-approval-title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        disabled={uploading}
                        maxLength={160}
                        className="bg-white"
                        placeholder="Homepage copy — August"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bsm-approval-context">
                        Note for the reviewer
                      </Label>
                      <Input
                        id="bsm-approval-context"
                        value={contextNote}
                        onChange={(event) => setContextNote(event.target.value)}
                        disabled={uploading}
                        maxLength={3000}
                        className="bg-white"
                        placeholder="Please check the offer, phone number and photo."
                      />
                    </div>
                  </div>
                  {sourceKind === "generated_page" ? (
                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="bsm-approval-generated-path">
                          PSG page path
                        </Label>
                        <Input
                          id="bsm-approval-generated-path"
                          value={generatedPagePath}
                          onChange={(event) =>
                            setGeneratedPagePath(event.target.value)
                          }
                          disabled={uploading}
                          className="bg-white"
                          placeholder="/generated/client/campaign"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bsm-approval-preview-url">
                          Preview URL{" "}
                          <span className="font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </Label>
                        <Input
                          id="bsm-approval-preview-url"
                          value={previewUrl}
                          onChange={(event) =>
                            setPreviewUrl(event.target.value)
                          }
                          disabled={uploading}
                          className="bg-white"
                          placeholder="https://preview.example.com"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bsm-approval-source-content">
                          Content item{" "}
                          <span className="font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </Label>
                        <Input
                          id="bsm-approval-source-content"
                          value={sourceContentItemId}
                          onChange={(event) =>
                            setSourceContentItemId(event.target.value)
                          }
                          disabled={uploading}
                          className="bg-white"
                        />
                      </div>
                    </div>
                  ) : (
                    <label
                      htmlFor="bsm-approval-file"
                      className="mt-4 flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[#17364b]/25 bg-white px-5 py-7 text-center hover:border-ember/40"
                    >
                      <FileUp
                        className="size-5 text-ember"
                        aria-hidden="true"
                      />
                      <span className="text-sm">
                        <strong className="text-[#142838]">
                          {file ? file.name : "Choose a file"}
                        </strong>
                        <span className="ml-1 text-muted-foreground">
                          or drag it here
                        </span>
                      </span>
                      <input
                        ref={fileRef}
                        id="bsm-approval-file"
                        type="file"
                        accept={BSM_CONTENT_APPROVAL_FILE_ACCEPT}
                        disabled={uploading}
                        className="sr-only"
                        onChange={(event) => {
                          const selectedFile = event.target.files?.[0] ?? null;
                          setFile(selectedFile);
                          if (selectedFile && !title.trim())
                            setTitle(
                              selectedFile.name
                                .replace(/\.[^.]+$/, "")
                                .replaceAll(/[-_]+/g, " "),
                            );
                          if (selectedFile && !contextNote.trim())
                            setContextNote(
                              "Please review this proof and leave comments anywhere changes are needed.",
                            );
                          setPhase({ kind: "idle" });
                        }}
                      />
                    </label>
                  )}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-destructive">
                      {fileValidationError ?? formValidationError ?? ""}
                    </div>
                    <button
                      type="button"
                      onClick={() => startReviewItem()}
                      disabled={!canSubmit}
                      className={cn(
                        buttonVariants({ variant: "default" }),
                        "gap-2 bg-[#17364b] hover:bg-[#0f2838]",
                      )}
                    >
                      {uploading ? (
                        <RefreshCw
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <FileUp className="size-4" aria-hidden="true" />
                      )}
                      {uploading ? "Processing" : "Add to review"}
                    </button>
                  </div>
                </div>
              ) : null}

              {showInvitePanel ? (
                <div className="mt-5 rounded-2xl border border-[#17364b]/20 bg-[#f7f8f9] p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-heading text-lg font-semibold text-[#142838]">
                        Invite reviewers
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Add the people who should comment or approve. They
                        receive a private link and one-time code.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowInvitePanel(false)}
                      className="rounded-lg p-2 text-muted-foreground hover:bg-white"
                      aria-label="Close reviewer panel"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor="bsm-reviewer-email">Email</Label>
                      <Input
                        id="bsm-reviewer-email"
                        value={reviewerEmail}
                        onChange={(event) =>
                          setReviewerEmail(event.target.value)
                        }
                        disabled={startingReview}
                        className="bg-white"
                        placeholder="reviewer@example.com"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="bsm-reviewer-name">
                        Name{" "}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Input
                        id="bsm-reviewer-name"
                        value={reviewerName}
                        onChange={(event) =>
                          setReviewerName(event.target.value)
                        }
                        disabled={startingReview}
                        className="bg-white"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        addReviewer({
                          email: reviewerEmail,
                          name: reviewerName || null,
                        })
                      }
                      disabled={startingReview || !reviewerEmail.trim()}
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "gap-2 bg-white",
                      )}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Add
                    </button>
                  </div>
                  {reviewerContacts.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {reviewerContacts.slice(0, 8).map((contact) => (
                        <button
                          key={contact.email}
                          type="button"
                          onClick={() => addReviewer(contact)}
                          disabled={startingReview}
                          className="rounded-full border border-border bg-white px-3 py-1.5 text-xs hover:border-ember/40"
                        >
                          {contact.name ? contact.name : contact.email}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selectedReviewers.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedReviewers.map((reviewer) => (
                        <span
                          key={reviewer.email}
                          className="inline-flex items-center gap-2 rounded-full bg-[#17364b] px-3 py-1.5 text-xs text-white"
                        >
                          {reviewer.name ?? reviewer.email}
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedReviewers((current) =>
                                current.filter(
                                  (entry) => entry.email !== reviewer.email,
                                ),
                              )
                            }
                            aria-label={`Remove reviewer ${reviewer.email}`}
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">
                      {startBlocker ??
                        `${workspaceDocuments.length} ready file${workspaceDocuments.length === 1 ? "" : "s"} will be shared.`}
                    </p>
                    <button
                      type="button"
                      onClick={startWorkspaceReview}
                      disabled={startingReview || Boolean(startBlocker)}
                      className={cn(
                        buttonVariants({ variant: "default" }),
                        "gap-2 bg-ember hover:bg-ember/90",
                      )}
                    >
                      {startingReview ? (
                        <RefreshCw
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Play className="size-4" aria-hidden="true" />
                      )}
                      {selectedWorkspace.status === "completed" ||
                      selectedWorkspace.status === "closed_early"
                        ? "Send next round"
                        : "Send review"}
                    </button>
                  </div>
                </div>
              ) : null}

              {workspacePreview?.documents.length ? (
                <div className="mt-5">
                  <WorkspacePreviewScreen
                    projectId={workspacePreview.project.id}
                    documents={workspacePreview.documents}
                    selectedDocumentKey={selectedPreviewDocumentKey}
                    onSelectDocument={setSelectedPreviewDocumentKey}
                    onAddPinComment={addWorkspacePinComment}
                    onSetThreadStatus={setWorkspaceThreadStatus}
                    comments={workspacePreview.submittedComments}
                    decisions={workspacePreview.decisions}
                    reviewers={workspacePreview.reviewers}
                    immersive
                  />
                </div>
              ) : null}

              <div
                className={cn(
                  "mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]",
                  workspacePreview && "hidden",
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-heading text-lg font-semibold text-[#142838]">
                      Files
                    </h3>
                    <button
                      type="button"
                      onClick={() => loadWorkspacePreview()}
                      disabled={previewingWorkspace}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-ember disabled:opacity-50"
                    >
                      {previewingWorkspace ? (
                        <RefreshCw
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                      Open review workspace
                    </button>
                  </div>
                  {visibleWorkspaceDocuments.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowUploadPanel(true)}
                      className="mt-4 flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#17364b]/25 bg-[#f9fafb] text-center hover:border-ember/40"
                    >
                      <FileUp
                        className="size-7 text-ember"
                        aria-hidden="true"
                      />
                      <span className="mt-3 font-heading text-lg font-semibold text-[#142838]">
                        Add the first proof
                      </span>
                      <span className="mt-1 text-sm text-muted-foreground">
                        PDF, image, Word, Markdown, HTML or text
                      </span>
                    </button>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      {visibleWorkspaceDocuments.map((item) => (
                        <article
                          key={item.id}
                          className="rounded-2xl border border-border bg-white p-4 shadow-sm"
                        >
                          <div className="flex flex-wrap items-start gap-4">
                            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#edf0f2] text-[#17364b]">
                              {item.contentType.startsWith("image/") ? (
                                <ImageIcon
                                  className="size-5"
                                  aria-hidden="true"
                                />
                              ) : (
                                <FileText
                                  className="size-5"
                                  aria-hidden="true"
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="font-heading font-semibold text-[#142838]">
                                {item.title}
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                {item.currentVersion?.originalFilename ??
                                  "Generated page"}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                <span className="rounded-full bg-muted px-2.5 py-1 capitalize">
                                  {item.processingStatus.replaceAll("_", " ")}
                                </span>
                                <span className="rounded-full bg-muted px-2.5 py-1">
                                  {item.commentCount} comment
                                  {item.commentCount === 1 ? "" : "s"}
                                </span>
                                {item.latestDecision ? (
                                  <span className="rounded-full bg-[#dff2e6] px-2.5 py-1 capitalize text-[#27623e]">
                                    {item.latestDecision.decision.replaceAll(
                                      "_",
                                      " ",
                                    )}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              {formatDate(item.updatedAt)}
                            </div>
                          </div>

                          {editingItemId === item.id ? (
                            <div className="mt-4 grid gap-3 rounded-xl bg-[#f7f8f9] p-4">
                              <Label htmlFor={`edit-title-${item.id}`}>
                                Title
                              </Label>
                              <Input
                                id={`edit-title-${item.id}`}
                                value={editTitle}
                                onChange={(event) =>
                                  setEditTitle(event.target.value)
                                }
                                disabled={savingEditItemId === item.id}
                                className="bg-white"
                              />
                              <Label htmlFor={`edit-note-${item.id}`}>
                                Reviewer note
                              </Label>
                              <Input
                                id={`edit-note-${item.id}`}
                                value={editContextNote}
                                onChange={(event) =>
                                  setEditContextNote(event.target.value)
                                }
                                disabled={savingEditItemId === item.id}
                                className="bg-white"
                              />
                              {item.sourceKind === "uploaded_file" ? (
                                <div className="space-y-1.5">
                                  <Label htmlFor={`edit-file-${item.id}`}>
                                    Replace file{" "}
                                    <span className="font-normal text-muted-foreground">
                                      (optional)
                                    </span>
                                  </Label>
                                  <Input
                                    id={`edit-file-${item.id}`}
                                    type="file"
                                    accept={BSM_CONTENT_APPROVAL_FILE_ACCEPT}
                                    disabled={savingEditItemId === item.id}
                                    onChange={(event) =>
                                      setEditFile(
                                        event.target.files?.[0] ?? null,
                                      )
                                    }
                                    className="bg-white"
                                  />
                                </div>
                              ) : null}
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveReviewItemEdit(item)}
                                  disabled={savingEditItemId === item.id}
                                  className={cn(
                                    buttonVariants({
                                      variant: "default",
                                      size: "sm",
                                    }),
                                    "gap-1",
                                  )}
                                >
                                  {savingEditItemId === item.id ? (
                                    <RefreshCw
                                      className="size-3.5 animate-spin"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Check
                                      className="size-3.5"
                                      aria-hidden="true"
                                    />
                                  )}
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingItemId(null)}
                                  className={cn(
                                    buttonVariants({
                                      variant: "outline",
                                      size: "sm",
                                    }),
                                  )}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                              {item.sourceKind === "uploaded_file" &&
                              item.processingStatus === "failed" ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    retryReviewItemProcessing(item)
                                  }
                                  disabled={retryingItemId === item.id}
                                  className={cn(
                                    buttonVariants({
                                      variant: "outline",
                                      size: "sm",
                                    }),
                                    "gap-1",
                                  )}
                                >
                                  <RefreshCw
                                    className={cn(
                                      "size-3.5",
                                      retryingItemId === item.id &&
                                        "animate-spin",
                                    )}
                                    aria-hidden="true"
                                  />
                                  Retry
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() =>
                                  loadWorkspacePreview(
                                    reviewWorkspaceProjectId,
                                    item.id,
                                  )
                                }
                                disabled={
                                  previewingWorkspace ||
                                  item.processingStatus !== "ready"
                                }
                                className={cn(
                                  buttonVariants({
                                    variant: "default",
                                    size: "sm",
                                  }),
                                  "gap-1 bg-[#17364b] hover:bg-[#0f2838]",
                                )}
                              >
                                <Eye className="size-3.5" aria-hidden="true" />
                                Open review
                              </button>
                              <button
                                type="button"
                                onClick={() => beginEdit(item)}
                                className={cn(
                                  buttonVariants({
                                    variant: "ghost",
                                    size: "sm",
                                  }),
                                  "gap-1",
                                )}
                              >
                                <FilePenLine
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                                Edit
                              </button>
                              {(item.currentVersion?.contentType === "text/markdown" ||
                                item.currentVersion?.previewType === "content_wireframe" ||
                                /\.md$/i.test(item.currentVersion?.originalFilename ?? "")) &&
                              item.reviewWorkspace?.projectId ? (
                                <a
                                  href={`/ops/bsm-content-approvals/${encodeURIComponent(item.reviewWorkspace.projectId)}/documents/${encodeURIComponent(item.id)}/edit`}
                                  className={cn(
                                    buttonVariants({
                                      variant: "outline",
                                      size: "sm",
                                    }),
                                    "gap-1",
                                  )}
                                >
                                  <FilePenLine className="size-3.5" aria-hidden="true" />
                                  Edit Markdown
                                </a>
                              ) : null}
                              {canManageWorkspaces &&
                              archiveItemId === item.id ? (
                                <>
                                  <span className="self-center text-xs text-muted-foreground">
                                    Remove this file?
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => archiveReviewItem(item)}
                                    disabled={archivingItemId === item.id}
                                    className={cn(
                                      buttonVariants({
                                        variant: "destructive",
                                        size: "sm",
                                      }),
                                    )}
                                  >
                                    {archivingItemId === item.id
                                      ? "Removing"
                                      : "Confirm"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setArchiveItemId(null)}
                                    className={cn(
                                      buttonVariants({
                                        variant: "ghost",
                                        size: "sm",
                                      }),
                                    )}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : canManageWorkspaces ? (
                                <button
                                  type="button"
                                  onClick={() => setArchiveItemId(item.id)}
                                  className={cn(
                                    buttonVariants({
                                      variant: "ghost",
                                      size: "sm",
                                    }),
                                    "gap-1 text-destructive hover:text-destructive",
                                  )}
                                >
                                  <Trash2
                                    className="size-3.5"
                                    aria-hidden="true"
                                  />
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  )}

                  {workspacePreview?.documents.length ? (
                    <div className="mt-6 rounded-2xl border border-border bg-[#f7f8f9] p-4">
                      <WorkspacePreviewScreen
                        projectId={workspacePreview.project.id}
                        documents={workspacePreview.documents}
                        selectedDocumentKey={selectedPreviewDocumentKey}
                        onSelectDocument={setSelectedPreviewDocumentKey}
                      />
                    </div>
                  ) : null}
                </div>

                <aside className="space-y-4">
                  {canManageWorkspaces || selectedWorkspace.role === "owner" ? (
                    <div className="rounded-2xl border border-border bg-[#f7f8f9] p-4">
                      <div className="font-heading font-semibold text-[#142838]">PSG Workspace Collaborators</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Owners can grant another PSG user access to edit Content Drafts in this workspace.</p>
                      <label className="mt-3 block text-sm font-medium" htmlFor="bsm-workspace-collaborator-email">PSG collaborator email</label>
                      <input
                        id="bsm-workspace-collaborator-email"
                        type="email"
                        value={collaboratorEmail}
                        onChange={(event) => setCollaboratorEmail(event.target.value)}
                        className="mt-2 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                        placeholder="teammate@psgweb.com"
                      />
                      <button
                        type="button"
                        disabled={addingCollaborator || !collaboratorEmail.trim()}
                        onClick={() => void addWorkspaceCollaborator()}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3 bg-white")}
                      >
                        {addingCollaborator ? "Adding" : "Add collaborator"}
                      </button>
                    </div>
                  ) : null}
                  <div className="rounded-2xl border border-border bg-[#f7f8f9] p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Review activity
                    </div>
                    <div className="mt-3 space-y-3">
                      <div className="flex items-center justify-between text-sm">
                        <span>Files</span>
                        <strong>{workspaceDocuments.length}</strong>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>Comments</span>
                        <strong>
                          {workspaceDocuments.reduce(
                            (total, item) => total + item.commentCount,
                            0,
                          )}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span>Decisions</span>
                        <strong>
                          {
                            workspaceDocuments.filter(
                              (item) => item.latestDecision,
                            ).length
                          }
                        </strong>
                      </div>
                    </div>
                  </div>

                  {startedReview ? (
                    <div className="rounded-2xl border border-success/30 bg-success/10 p-4 text-sm">
                      <div className="font-heading font-semibold text-success-foreground">
                        Review sent
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {startedReview.documentCount} file
                        {startedReview.documentCount === 1 ? "" : "s"} ·{" "}
                        {startedReview.invitations.length} reviewer
                        {startedReview.invitations.length === 1 ? "" : "s"}
                      </div>
                      <div className="mt-3 space-y-3">
                        {startedReview.invitations.map((invitation) => (
                          <div
                            key={invitation.invitationId}
                            className="rounded-xl border border-border bg-white p-3"
                          >
                            <div className="font-medium">
                              {invitation.reviewerName ??
                                invitation.reviewerEmail}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {invitation.deliveryStatus === "failed"
                                ? "Share manually"
                                : "Invitation sent"}
                            </div>
                            <div className="mt-2 font-mono text-base tracking-[0.22em]">
                              {invitation.inviteCode}
                            </div>
                            <button
                              type="button"
                              onClick={() => copyInvitation(invitation)}
                              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ember"
                            >
                              <Copy className="size-3.5" aria-hidden="true" />
                              Copy link and code
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {workspacePreview ? (
                    <div className="rounded-2xl border border-border p-4 text-sm">
                      <div className="font-heading font-semibold text-[#142838]">
                        Reviewer status
                      </div>
                      <div className="mt-3 space-y-2">
                        {workspacePreview.reviewers.length === 0 ? (
                          <p className="text-muted-foreground">
                            No reviewers invited yet.
                          </p>
                        ) : null}
                        {workspacePreview.reviewers.map((reviewer) => (
                          <div
                            key={reviewer.invitationId}
                            className="rounded-xl bg-[#f7f8f9] p-3"
                          >
                            <div className="font-medium">
                              {reviewer.name ?? reviewer.email}
                            </div>
                            <div className="mt-1 text-xs capitalize text-muted-foreground">
                              {reviewer.status.replaceAll("_", " ")}
                            </div>
                            {(workspacePreview.round?.status === "active" ||
                              workspacePreview.round?.status === "inviting") &&
                            !reviewer.revokedAt ? (
                              <button
                                type="button"
                                onClick={() =>
                                  revokeReviewerInvitation(reviewer)
                                }
                                disabled={
                                  revokingInvitationId === reviewer.invitationId
                                }
                                className="mt-2 text-xs font-medium text-destructive"
                              >
                                {revokingInvitationId === reviewer.invitationId
                                  ? "Revoking"
                                  : "Revoke"}
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </aside>
              </div>

              {workspacePreview &&
              (workspacePreview.decisions.length > 0 ||
                workspacePreview.submittedComments.length > 0) ? (
                <div
                  className={cn(
                    "mt-6 rounded-2xl border border-border p-5",
                    workspacePreview && "hidden",
                  )}
                >
                  <h3 className="font-heading text-lg font-semibold text-[#142838]">
                    Feedback
                  </h3>
                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {workspacePreview.decisions.map((decision) => {
                      const reviewer = workspacePreview.reviewers.find(
                        (entry) => entry.invitationId === decision.invitationId,
                      );
                      const document = workspacePreview.documents.find(
                        (entry) => entry.itemId === decision.reviewItemId,
                      );
                      return (
                        <div
                          key={decision.id}
                          className="rounded-xl border border-border bg-[#f7f8f9] p-4"
                        >
                          <div className="font-medium capitalize">
                            {decision.decision.replaceAll("_", " ")} ·{" "}
                            {document?.title ?? "Document"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {reviewer?.name ?? reviewer?.email ?? "Reviewer"}
                          </div>
                          {decision.message ? (
                            <p className="mt-2 text-sm">{decision.message}</p>
                          ) : null}
                        </div>
                      );
                    })}
                    {workspacePreview.submittedComments.map((comment) => {
                      const reviewer = workspacePreview.reviewers.find(
                        (entry) => entry.invitationId === comment.invitationId,
                      );
                      const document = workspacePreview.documents.find(
                        (entry) => entry.itemId === comment.reviewItemId,
                      );
                      return (
                        <div
                          key={comment.id}
                          className="rounded-xl border border-border bg-[#f7f8f9] p-4"
                        >
                          <div className="flex items-center gap-2 font-medium">
                            {comment.commentKind === "highlight" ? (
                              <Highlighter
                                className="size-4 text-warning"
                                aria-hidden="true"
                              />
                            ) : (
                              <MapPin
                                className="size-4 text-ember"
                                aria-hidden="true"
                              />
                            )}
                            {comment.commentKind === "highlight"
                              ? "Highlight"
                              : `Pin ${comment.pinNumber ?? "-"}`}{" "}
                            · {document?.title ?? "Document"}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {reviewer?.name ?? reviewer?.email ?? "Reviewer"}
                          </div>
                          {comment.selection ? (
                            <p className="mt-2 border-l-2 border-warning pl-2 text-xs italic text-muted-foreground">
                              “{comment.selection.text}”
                            </p>
                          ) : null}
                          <p className="mt-2 text-sm">{comment.body}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedWorkspace.status === "active" ? (
                <details
                  className={cn(
                    "mt-6 rounded-xl border border-warning/30 bg-warning/10 p-4",
                    workspacePreview && "hidden",
                  )}
                >
                  <summary className="cursor-pointer text-sm font-medium">
                    Close this review round early
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Input
                      value={closeReason}
                      onChange={(event) => setCloseReason(event.target.value)}
                      disabled={closingRound}
                      maxLength={1000}
                      placeholder="Reason for closing early"
                      className="min-w-64 flex-1 bg-white"
                    />
                    <button
                      type="button"
                      onClick={closeWorkspaceRound}
                      disabled={closingRound || !closeReason.trim()}
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "gap-2 bg-white",
                      )}
                    >
                      <CircleStop className="size-4" aria-hidden="true" />
                      Close round
                    </button>
                  </div>
                </details>
              ) : null}

              {canManageWorkspaces ? (
                <details
                  className={cn(
                    "mt-4 rounded-xl border border-border p-4",
                    workspacePreview && "hidden",
                  )}
                >
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                    Review settings
                  </summary>
                  {editingWorkspaceId === selectedWorkspace.id ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor="bsm-workspace-edit-title">
                          Review name
                        </Label>
                        <Input
                          id="bsm-workspace-edit-title"
                          value={workspaceEditTitle}
                          onChange={(event) =>
                            setWorkspaceEditTitle(event.target.value)
                          }
                          disabled={savingWorkspace}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="bsm-workspace-edit-instructions">
                          Client instructions
                        </Label>
                        <Input
                          id="bsm-workspace-edit-instructions"
                          value={workspaceEditInstructions}
                          onChange={(event) =>
                            setWorkspaceEditInstructions(event.target.value)
                          }
                          disabled={savingWorkspace}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveWorkspaceEdit}
                          disabled={
                            savingWorkspace || !workspaceEditTitle.trim()
                          }
                          className={cn(
                            buttonVariants({ variant: "default", size: "sm" }),
                          )}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingWorkspaceId(null)}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                          )}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={beginWorkspaceEdit}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "gap-1",
                        )}
                      >
                        <FilePenLine className="size-3.5" aria-hidden="true" />
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => removeWorkspace(selectedWorkspace)}
                        disabled={removingWorkspaceId === selectedWorkspace.id}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "gap-1 text-destructive hover:text-destructive",
                        )}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        {removingWorkspaceId === selectedWorkspace.id
                          ? "Removing"
                          : "Remove review"}
                      </button>
                    </div>
                  )}
                </details>
              ) : null}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(date);
}
