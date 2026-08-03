"use client";

import { Eye, FilePenLine, FileUp, Link, Play, RefreshCw, Trash2, UserPlus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
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

type UploadResponse =
  | {
      item: BsmContentApprovalListItem;
      upload: { path: string; token: string; signedUrl: string; bucket: string };
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
  ".pdf,.md,.markdown,.html,.htm,.png,.jpg,.jpeg,.webp,.docx,.txt,application/pdf,text/markdown,text/html,image/png,image/jpeg,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
export const BSM_CONTENT_APPROVAL_UNSUPPORTED_FILE_MESSAGE =
  "This file type is not supported. Upload a PDF, MD, HTML, image, Word document, or text file.";

export type BsmContentApprovalShopOption = { id: string; name: string };
export type BsmContentApprovalReviewerContact = { email: string; name: string | null };

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
        }>;
      };
    }
  | { error?: string };

type WorkspaceCreateResponse =
  | { workspace: { id: string; shopId: string; title: string; status: string } }
  | { error?: string };

type WorkspacePreviewResponse =
  | {
      result: {
        project: { id: string; title: string; status: string };
        documents: Array<{ itemId: string; title: string; processingStatus: string; status: string; proofUrl: string | null }>;
      };
    }
  | { error?: string };

type WorkspaceUpdateResponse =
  | { workspace: { id: string; shopId: string; title: string; status: string } }
  | { error?: string };

export function getBsmReviewWorkspaceStartBlocker(input: {
  workspaceId: string;
  documents: Array<{ processingStatus: string }>;
  reviewers: Array<{ email: string }>;
}) {
  if (!input.workspaceId) return "Create or select a Review Workspace first.";
  if (input.documents.length === 0) return "Add at least one document before starting review.";
  if (input.documents.some((document) => document.processingStatus !== "ready")) {
    return "Start review is available after every document finishes processing successfully.";
  }
  if (input.reviewers.filter((reviewer) => reviewer.email.trim()).length === 0) {
    return "Choose at least one reviewer before starting review.";
  }
  return null;
}

export function getBsmContentApprovalFileValidationError(selectedFile: File | null) {
  if (!selectedFile) return null;
  if (!normalizeApprovalMimeType(selectedFile.name, selectedFile.type)) {
    return BSM_CONTENT_APPROVAL_UNSUPPORTED_FILE_MESSAGE;
  }
  if (selectedFile.size <= 0) return "The selected file is empty.";
  if (selectedFile.size > MAX_APPROVAL_FILE_BYTES) return "The file is too large. Upload a file under 25 MB.";
  return null;
}

export function getBsmContentApprovalStorageContentType(selectedFile: File) {
  const normalizedContentType = normalizeApprovalMimeType(selectedFile.name, selectedFile.type);
  if (normalizedContentType === "text/html" || normalizedContentType === "text/markdown") {
    return "text/plain";
  }
  return normalizedContentType ?? selectedFile.type;
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
  const initialWorkspace = workspaceOptions.find((workspace) => workspace.id === activeWorkspaceProjectId);
  const requestedShopId = initialWorkspace?.shopId ?? activeShopId;
  const initialShopId = orderedShops.some((shop) => shop.id === requestedShopId)
    ? requestedShopId ?? ""
    : orderedShops[0]?.id ?? "";
  const [shopId, setShopId] = useState(initialShopId);
  const [customerProfileId, setCustomerProfileId] = useState("");
  const [reviewWorkspaceProjectId, setReviewWorkspaceProjectId] = useState(
    initialWorkspace && initialWorkspace.shopId === initialShopId ? initialWorkspace.id : "",
  );
  const [title, setTitle] = useState("");
  const [contextNote, setContextNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<"uploaded_file" | "generated_page">("uploaded_file");
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
  const [attachingItemId, setAttachingItemId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedShopWorkspaces = useMemo(
    () => workspaceOptions.filter((workspace) => workspace.shopId === shopId),
    [workspaceOptions, shopId],
  );
  const workspaceDocuments = useMemo(
    () => approvals.filter((item) => item.reviewWorkspace?.projectId === reviewWorkspaceProjectId),
    [approvals, reviewWorkspaceProjectId],
  );
  const selectedWorkspace = useMemo(
    () => workspaceOptions.find((workspace) => workspace.id === reviewWorkspaceProjectId) ?? null,
    [workspaceOptions, reviewWorkspaceProjectId],
  );

  const fileValidationError = useMemo(() => getBsmContentApprovalFileValidationError(file), [file]);
  const formValidationError = useMemo(() => {
    if (!shopId.trim()) return "Shop ID is required.";
    if (!reviewWorkspaceProjectId.trim()) return "Review Workspace is required.";
    if (!title.trim()) return "Title is required.";
    if (!contextNote.trim()) return "Context note is required.";
    if (sourceKind !== "generated_page") return null;
    if (!generatedPagePath.trim()) return "Generated page path is required.";
    if (previewUrl.trim()) {
      try {
        const url = new URL(previewUrl.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:") return "Preview URL must be a web URL.";
      } catch {
        return "Preview URL must be a valid URL.";
      }
    }
    return null;
  }, [shopId, reviewWorkspaceProjectId, title, contextNote, sourceKind, generatedPagePath, previewUrl]);
  const validationError = fileValidationError ?? formValidationError;

  const uploading = phase.kind === "uploading";
  const [workspaceTitle, setWorkspaceTitle] = useState("");
  const [workspaceInstructions, setWorkspaceInstructions] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [selectedReviewers, setSelectedReviewers] = useState<BsmContentApprovalReviewerContact[]>([]);
  const [startingReview, setStartingReview] = useState(false);
  const [startedReview, setStartedReview] = useState<Extract<ReviewStartResponse, { review: unknown }>["review"] | null>(null);
  const [previewingWorkspace, setPreviewingWorkspace] = useState(false);
  const [workspacePreview, setWorkspacePreview] = useState<Extract<WorkspacePreviewResponse, { result: unknown }>["result"] | null>(null);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [workspaceEditTitle, setWorkspaceEditTitle] = useState("");
  const [workspaceEditInstructions, setWorkspaceEditInstructions] = useState("");
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [removingWorkspaceId, setRemovingWorkspaceId] = useState<string | null>(null);
  const startBlocker = getBsmReviewWorkspaceStartBlocker({
    workspaceId: reviewWorkspaceProjectId,
    documents: workspaceDocuments,
    reviewers: selectedReviewers,
  });
  const canSubmit =
    !uploading &&
    !validationError &&
    (sourceKind === "generated_page" ? Boolean(generatedPagePath.trim()) : Boolean(file));

  async function createWorkspace() {
    if (!shopId.trim() || !workspaceTitle.trim()) {
      setPhase({ kind: "error", message: "Choose a shop and enter a workspace title." });
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
      const body = (await response.json().catch(() => ({}))) as WorkspaceCreateResponse;
      if (!response.ok || !("workspace" in body)) {
        throw new Error("error" in body && body.error ? body.error : "The Review Workspace could not be created.");
      }
      const workspace = {
        id: body.workspace.id,
        shopId: body.workspace.shopId,
        title: body.workspace.title,
        status: body.workspace.status,
        currentRoundId: null,
        documentCount: 0,
      };
      setWorkspaceOptions((current) => [workspace, ...current.filter((entry) => entry.id !== workspace.id)]);
      setReviewWorkspaceProjectId(workspace.id);
      setWorkspaceTitle("");
      setWorkspaceInstructions("");
      setWorkspacePreview(null);
      setStartedReview(null);
      setPhase({ kind: "success", message: "The Review Workspace is ready for documents and reviewers." });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The Review Workspace could not be created.",
      });
    } finally {
      setCreatingWorkspace(false);
    }
  }

  function addReviewer(contact: BsmContentApprovalReviewerContact) {
    if (!contact.email.trim()) return;
    setSelectedReviewers((current) => {
      const email = contact.email.trim().toLowerCase();
      if (current.some((reviewer) => reviewer.email.toLowerCase() === email)) return current;
      return [...current, { email, name: contact.name?.trim() || null }];
    });
    setReviewerEmail("");
    setReviewerName("");
    setStartedReview(null);
  }

  async function loadWorkspacePreview() {
    if (!reviewWorkspaceProjectId) return;
    setPreviewingWorkspace(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(`/api/ops/bsm/review-workspace/projects/${reviewWorkspaceProjectId}`, {
        headers: { "Cache-Control": "no-store" },
      });
      const body = (await response.json().catch(() => ({}))) as WorkspacePreviewResponse;
      if (!response.ok || !("result" in body)) {
        throw new Error("error" in body && body.error ? body.error : "The Review Workspace preview could not be loaded.");
      }
      setWorkspacePreview(body.result);
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The Review Workspace preview could not be loaded.",
      });
    } finally {
      setPreviewingWorkspace(false);
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
      const body = (await response.json().catch(() => ({}))) as ReviewStartResponse;
      if (!response.ok || !("review" in body)) {
        throw new Error("error" in body && body.error ? body.error : "The review could not be started.");
      }
      setStartedReview(body.review);
      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === reviewWorkspaceProjectId
            ? { ...workspace, status: "active", currentRoundId: body.review.roundId }
            : workspace,
        ),
      );
      setApprovals((current) =>
        current.map((item) =>
          item.reviewWorkspace?.projectId === reviewWorkspaceProjectId
            ? { ...item, status: "in_review", reviewWorkspace: { ...item.reviewWorkspace, roundId: body.review.roundId } }
            : item,
        ),
      );
      setPhase({ kind: "success", message: "The review has started. Share the reviewer URL and code with each reviewer." });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The review could not be started.",
      });
    } finally {
      setStartingReview(false);
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
    if (!selectedWorkspace || editingWorkspaceId !== selectedWorkspace.id) return;
    if (!workspaceEditTitle.trim()) {
      setPhase({ kind: "error", message: "Workspace title is required." });
      return;
    }

    setSavingWorkspace(true);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(`/api/ops/bsm/review-workspace/projects/${selectedWorkspace.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_workspace",
          title: workspaceEditTitle.trim(),
          description: workspaceEditInstructions.trim() || null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as WorkspaceUpdateResponse;
      if (!response.ok || !("workspace" in body)) {
        throw new Error("error" in body && body.error ? body.error : "The Review Workspace could not be updated.");
      }

      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === body.workspace.id
            ? { ...workspace, title: body.workspace.title, status: body.workspace.status }
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
          ? { ...current, project: { ...current.project, title: body.workspace.title, status: body.workspace.status } }
          : current,
      );
      setEditingWorkspaceId(null);
      setWorkspaceEditInstructions("");
      setPhase({ kind: "success", message: "The Review Workspace was updated." });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The Review Workspace could not be updated.",
      });
    } finally {
      setSavingWorkspace(false);
    }
  }

  async function removeSelectedWorkspace() {
    if (!selectedWorkspace) return;
    if (
      !confirm(
        `Remove Review Workspace "${selectedWorkspace.title}"? It will be hidden now and kept recoverable for 30 days.`,
      )
    ) {
      return;
    }

    setRemovingWorkspaceId(selectedWorkspace.id);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(`/api/ops/bsm/review-workspace/projects/${selectedWorkspace.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Removed from the Content Approvals workspace controls." }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The Review Workspace could not be removed.");
      }

      const removedWorkspaceId = selectedWorkspace.id;
      setWorkspaceOptions((current) => current.filter((workspace) => workspace.id !== removedWorkspaceId));
      setApprovals((current) => current.filter((item) => item.reviewWorkspace?.projectId !== removedWorkspaceId));
      setReviewWorkspaceProjectId("");
      setEditingWorkspaceId(null);
      setWorkspacePreview(null);
      setStartedReview(null);
      setPhase({ kind: "success", message: "The Review Workspace was removed from the active list." });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The Review Workspace could not be removed.",
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
                  ? normalizeApprovalMimeType(selectedFile.name, selectedFile.type)
                  : null,
                byteSize: selectedFile?.size,
              }),
        }),
      });
    } catch {
      setPhase({ kind: "error", message: "The upload service could not be reached." });
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
        message: "error" in body && body.error ? body.error : "The review item could not be created.",
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
        .uploadToSignedUrl(body.upload.path, body.upload.token, fileBody, { contentType });
      if (error) {
        setPhase({ kind: "error", message: `Upload failed: ${error.message}` });
        return;
      }
    }

    setApprovals((current) => [body.item, ...current]);
    if (body.item.reviewWorkspace?.projectId) {
      setWorkspaceOptions((current) =>
        current.map((workspace) =>
          workspace.id === body.item.reviewWorkspace?.projectId
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
    setEditingItemId(body.item.id);
    setEditTitle(body.item.title);
    setEditContextNote(body.item.contextNote ?? "");
    setEditFile(null);
    setPhase({
      kind: "success",
      message: body.item.reviewWorkspace
        ? "The item is attached to the selected Review Workspace. You can edit it before reviewer submission."
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
    if (editFile && !normalizeApprovalMimeType(editFile.name, editFile.type)) {
      setPhase({
        kind: "error",
        message: "This file type is not supported. Upload a PDF, MD, HTML, image, Word document, or text file.",
      });
      return;
    }
    if (editFile && editFile.size > MAX_APPROVAL_FILE_BYTES) {
      setPhase({ kind: "error", message: "The file is too large. Upload a file under 25 MB." });
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
                contentType: normalizeApprovalMimeType(editFile.name, editFile.type),
                byteSize: editFile.size,
              }
            : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as UploadResponse;
      if (!response.ok || !("item" in body)) {
        throw new Error("error" in body && body.error ? body.error : "The review item edits could not be saved.");
      }

      if ("upload" in body && editFile) {
        const supabase = createClient();
        const contentType = getBsmContentApprovalStorageContentType(editFile);
        const fileBody = await editFile.arrayBuffer();
        const { error } = await supabase.storage
          .from(BSM_CONTENT_APPROVALS_BUCKET)
          .uploadToSignedUrl(body.upload.path, body.upload.token, fileBody, { contentType });
        if (error) throw new Error(`Upload failed: ${error.message}`);
      }

      setApprovals((current) => current.map((entry) => (entry.id === item.id ? body.item : entry)));
      setEditingItemId(null);
      setEditFile(null);
      setPhase({ kind: "success", message: "The review item edits were saved as the usable version." });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The review item edits could not be saved.",
      });
    } finally {
      setSavingEditItemId(null);
    }
  }

  async function attachReviewItemToSelectedWorkspace(item: BsmContentApprovalListItem) {
    const workspace = selectedShopWorkspaces.find((entry) => entry.id === reviewWorkspaceProjectId);
    if (!workspace) {
      setPhase({ kind: "error", message: "Choose a Review Workspace before attaching this item." });
      return;
    }
    if (workspace.shopId !== item.shopId) {
      setPhase({ kind: "error", message: "Choose a Review Workspace for the same shop as this item." });
      return;
    }

    setAttachingItemId(item.id);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch("/api/ops/bsm/content-approvals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          title: item.title,
          contextNote: item.contextNote ?? "Review this content before customer release.",
          reviewWorkspaceProjectId: workspace.id,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as UploadResponse;
      if (!response.ok || !("item" in body)) {
        throw new Error("error" in body && body.error ? body.error : "The review item could not be attached.");
      }

      setApprovals((current) => current.map((entry) => (entry.id === item.id ? body.item : entry)));
      setPhase({ kind: "success", message: "The item is attached to the selected Review Workspace." });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The review item could not be attached.",
      });
    } finally {
      setAttachingItemId(null);
    }
  }

  async function archiveReviewItem(item: BsmContentApprovalListItem) {
    setArchivingItemId(item.id);
    setPhase({ kind: "idle" });
    try {
      const response = await fetch(`/api/ops/bsm/content-approvals?itemId=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The review item could not be archived.");
      }
      setApprovals((current) => current.filter((entry) => entry.id !== item.id));
      setArchiveItemId(null);
      setPhase({ kind: "success", message: "The review item was removed from the active library." });
    } catch (error) {
      setPhase({
        kind: "error",
        message: error instanceof Error ? error.message : "The review item could not be archived.",
      });
    } finally {
      setArchivingItemId(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4 border-b border-border pb-8">
        <div>
          <h2 className="font-heading text-lg font-semibold">Workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the customer review workspace first, then attach one or more documents to it.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bsm-approval-shop">Shop</Label>
            {orderedShops.length > 0 ? (
              <select
                id="bsm-approval-shop"
                value={shopId}
                onChange={(event) => {
                  setShopId(event.target.value);
                  setReviewWorkspaceProjectId("");
                  setWorkspacePreview(null);
                  setStartedReview(null);
                }}
                disabled={uploading || creatingWorkspace || startingReview}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
                disabled={uploading || creatingWorkspace || startingReview}
                placeholder="No shops available"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bsm-approval-profile">Customer profile ID</Label>
            <Input
              id="bsm-approval-profile"
              value={customerProfileId}
              onChange={(event) => setCustomerProfileId(event.target.value)}
              disabled={uploading}
              placeholder="Optional reviewer profile"
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="bsm-workspace-title">Workspace title</Label>
            <Input
              id="bsm-workspace-title"
              value={workspaceTitle}
              onChange={(event) => setWorkspaceTitle(event.target.value)}
              disabled={creatingWorkspace}
              maxLength={180}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bsm-workspace-instructions">Reviewer instructions</Label>
            <Input
              id="bsm-workspace-instructions"
              value={workspaceInstructions}
              onChange={(event) => setWorkspaceInstructions(event.target.value)}
              disabled={creatingWorkspace}
              maxLength={4000}
            />
          </div>
          <button
            type="button"
            onClick={createWorkspace}
            disabled={creatingWorkspace || !shopId || !workspaceTitle.trim()}
            className={cn(buttonVariants({ variant: "default" }), "gap-2")}
          >
            {creatingWorkspace ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <FilePenLine className="size-4" aria-hidden="true" />
            )}
            {creatingWorkspace ? "Creating" : "Create workspace"}
          </button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bsm-approval-workspace">Review Workspace</Label>
          <select
            id="bsm-approval-workspace"
            value={reviewWorkspaceProjectId}
            onChange={(event) => {
              setReviewWorkspaceProjectId(event.target.value);
              setWorkspacePreview(null);
              setStartedReview(null);
            }}
            disabled={uploading || selectedShopWorkspaces.length === 0}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">
              {selectedShopWorkspaces.length === 0
                ? "No Review Workspaces for this shop"
                : "Choose a Review Workspace"}
            </option>
            {selectedShopWorkspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.title} · {workspace.status.replaceAll("_", " ")} · {workspace.documentCount} documents
              </option>
            ))}
          </select>
        </div>
        {canManageWorkspaces && selectedWorkspace ? (
          <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-heading text-sm font-semibold">Super-admin workspace controls</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Rename or remove the selected Review Workspace.
                </p>
              </div>
              {editingWorkspaceId === selectedWorkspace.id ? null : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={beginWorkspaceEdit}
                    disabled={savingWorkspace || removingWorkspaceId === selectedWorkspace.id}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
                  >
                    <FilePenLine className="size-3.5" aria-hidden="true" />
                    Edit workspace
                  </button>
                  <button
                    type="button"
                    onClick={removeSelectedWorkspace}
                    disabled={savingWorkspace || removingWorkspaceId === selectedWorkspace.id}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1 text-destructive hover:text-destructive")}
                  >
                    {removingWorkspaceId === selectedWorkspace.id ? (
                      <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    )}
                    {removingWorkspaceId === selectedWorkspace.id ? "Removing" : "Remove workspace"}
                  </button>
                </div>
              )}
            </div>
            {editingWorkspaceId === selectedWorkspace.id ? (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="bsm-workspace-edit-title">Workspace title</Label>
                  <Input
                    id="bsm-workspace-edit-title"
                    value={workspaceEditTitle}
                    onChange={(event) => setWorkspaceEditTitle(event.target.value)}
                    disabled={savingWorkspace}
                    maxLength={180}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bsm-workspace-edit-instructions">Reviewer instructions</Label>
                  <Input
                    id="bsm-workspace-edit-instructions"
                    value={workspaceEditInstructions}
                    onChange={(event) => setWorkspaceEditInstructions(event.target.value)}
                    disabled={savingWorkspace}
                    maxLength={4000}
                    placeholder="Leave blank to clear the instructions"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveWorkspaceEdit}
                    disabled={savingWorkspace || !workspaceEditTitle.trim()}
                    className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1")}
                  >
                    {savingWorkspace ? (
                      <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <FilePenLine className="size-3.5" aria-hidden="true" />
                    )}
                    {savingWorkspace ? "Saving" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingWorkspaceId(null)}
                    disabled={savingWorkspace}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-4 border-b border-border pb-8">
        <div>
          <h2 className="font-heading text-lg font-semibold">Documents</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one or more files or generated pages. A one-document approval is still tracked inside the Review Workspace.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bsm-approval-title">Review title</Label>
          <Input
            id="bsm-approval-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={uploading}
            maxLength={160}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bsm-approval-context">Context note for the customer</Label>
          <textarea
            id="bsm-approval-context"
            value={contextNote}
            onChange={(event) => setContextNote(event.target.value)}
            disabled={uploading}
            maxLength={3000}
            className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
        <div className="inline-flex rounded-md border border-border p-1">
          <button
            type="button"
            className={cn(
              "rounded px-3 py-1.5 text-sm",
              sourceKind === "uploaded_file" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            onClick={() => {
              setSourceKind("uploaded_file");
              setPhase({ kind: "idle" });
            }}
            disabled={uploading}
          >
            File
          </button>
          <button
            type="button"
            className={cn(
              "rounded px-3 py-1.5 text-sm",
              sourceKind === "generated_page" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            onClick={() => {
              setSourceKind("generated_page");
              setPhase({ kind: "idle" });
            }}
            disabled={uploading}
          >
            Generated page
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
          {sourceKind === "generated_page" ? (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="bsm-approval-generated-path">Generated page path</Label>
                <Input
                  id="bsm-approval-generated-path"
                  value={generatedPagePath}
                  onChange={(event) => setGeneratedPagePath(event.target.value)}
                  disabled={uploading}
                  placeholder="/generated/wallace/july-offer"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bsm-approval-preview-url">Preview URL</Label>
                <Input
                  id="bsm-approval-preview-url"
                  value={previewUrl}
                  onChange={(event) => setPreviewUrl(event.target.value)}
                  disabled={uploading}
                  placeholder="Optional web preview"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bsm-approval-source-content">Source content ID</Label>
                <Input
                  id="bsm-approval-source-content"
                  value={sourceContentItemId}
                  onChange={(event) => setSourceContentItemId(event.target.value)}
                  disabled={uploading}
                  placeholder="Optional content item"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="bsm-approval-file">File</Label>
              <Input
                ref={fileRef}
                id="bsm-approval-file"
                type="file"
                accept={BSM_CONTENT_APPROVAL_FILE_ACCEPT}
                disabled={uploading}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setPhase({ kind: "idle" });
                }}
              />
            </div>
          )}
          <button
            type="button"
            onClick={startReviewItem}
            disabled={!canSubmit}
            className={cn(buttonVariants({ variant: "default" }), "gap-2")}
          >
            {uploading ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : sourceKind === "generated_page" ? (
              <Link className="size-4" aria-hidden="true" />
            ) : (
              <FileUp className="size-4" aria-hidden="true" />
            )}
            {uploading ? "Saving" : sourceKind === "generated_page" ? "Attach" : "Add document"}
          </button>
        </div>
        {fileValidationError ? (
          <p className="text-sm text-destructive">{fileValidationError}</p>
        ) : formValidationError ? (
          <p className="text-sm text-destructive">{formValidationError}</p>
        ) : null}
        {phase.kind === "success" ? (
          <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success-foreground">
            {phase.message}
          </p>
        ) : null}
        {phase.kind === "error" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {phase.message}
          </p>
        ) : null}
      </section>

      <section className="space-y-4 border-b border-border pb-8">
        <div>
          <h2 className="font-heading text-lg font-semibold">Reviewers</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose saved reviewer contacts or add a new contact before starting review.
          </p>
        </div>
        <div className="space-y-4 rounded-md border border-border bg-muted/20 p-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="bsm-reviewer-email">Reviewer email</Label>
              <Input
                id="bsm-reviewer-email"
                value={reviewerEmail}
                onChange={(event) => setReviewerEmail(event.target.value)}
                disabled={startingReview}
                placeholder="reviewer@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bsm-reviewer-name">Reviewer name</Label>
              <Input
                id="bsm-reviewer-name"
                value={reviewerName}
                onChange={(event) => setReviewerName(event.target.value)}
                disabled={startingReview}
                placeholder="Optional"
              />
            </div>
            <button
              type="button"
              onClick={() => addReviewer({ email: reviewerEmail, name: reviewerName || null })}
              disabled={startingReview || !reviewerEmail.trim()}
              className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Add reviewer
            </button>
          </div>
          {reviewerContacts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {reviewerContacts.slice(0, 8).map((contact) => (
                <button
                  key={contact.email}
                  type="button"
                  onClick={() => addReviewer(contact)}
                  disabled={startingReview}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  {contact.name ? `${contact.name} · ${contact.email}` : contact.email}
                </button>
              ))}
            </div>
          ) : null}
          {selectedReviewers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedReviewers.map((reviewer) => (
                <span
                  key={reviewer.email}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1 text-xs"
                >
                  {reviewer.name ? `${reviewer.name} · ${reviewer.email}` : reviewer.email}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setSelectedReviewers((current) => current.filter((entry) => entry.email !== reviewer.email))
                    }
                    aria-label={`Remove reviewer ${reviewer.email}`}
                  >
                    Remove
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-4 border-b border-border pb-8">
        <div>
          <h2 className="font-heading text-lg font-semibold">Preview or start review</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Preview is optional and read-only. Starting review freezes the round and creates reviewer invitations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <div className="min-w-56 flex-1 text-sm text-muted-foreground">
            {startBlocker ?? `${workspaceDocuments.length} ready document${workspaceDocuments.length === 1 ? "" : "s"} can be sent.`}
          </div>
          <button
            type="button"
            onClick={loadWorkspacePreview}
            disabled={previewingWorkspace || !reviewWorkspaceProjectId}
            className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
          >
            {previewingWorkspace ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
            Preview read-only
          </button>
          <button
            type="button"
            onClick={startWorkspaceReview}
            disabled={startingReview || Boolean(startBlocker)}
            className={cn(buttonVariants({ variant: "default" }), "gap-2")}
          >
            {startingReview ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
            Start review
          </button>
        </div>
        {workspacePreview ? (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
            <div className="font-heading font-semibold">Preview mode · no comments or decisions are saved here</div>
            <div className="mt-1 text-muted-foreground">
              {workspacePreview.project.title} · {workspacePreview.project.status.replaceAll("_", " ")}
            </div>
            <div className="mt-3 space-y-2">
              {workspacePreview.documents.length === 0 ? (
                <div className="text-muted-foreground">No documents are attached yet.</div>
              ) : (
                workspacePreview.documents.map((document) => (
                  <div key={document.itemId} className="rounded-md border border-border bg-background p-3">
                    <div className="font-medium">{document.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {document.processingStatus.replaceAll("_", " ")} · {document.status.replaceAll("_", " ")}
                    </div>
                    {document.proofUrl ? (
                      <a className="mt-2 inline-block font-medium text-ember" href={document.proofUrl} target="_blank" rel="noreferrer">
                        Open proof
                      </a>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
        {startedReview ? (
          <div className="rounded-md border border-success/40 bg-success/10 p-4 text-sm">
            <div className="font-heading font-semibold">Review started</div>
            <div className="mt-1 text-muted-foreground">
              {startedReview.documentCount} document{startedReview.documentCount === 1 ? "" : "s"} sent to {startedReview.invitations.length} reviewer{startedReview.invitations.length === 1 ? "" : "s"}.
            </div>
            <div className="mt-3 space-y-2">
              {startedReview.invitations.map((invitation) => (
                <div key={invitation.invitationId} className="rounded-md border border-border bg-background p-3">
                  <div className="font-medium">{invitation.reviewerName ?? invitation.reviewerEmail}</div>
                  <a className="break-all text-ember" href={`/review-workspace?invite=${encodeURIComponent(invitation.inviteToken)}`}>
                    /review-workspace?invite={invitation.inviteToken}
                  </a>
                  <div className="mt-1 font-mono text-lg tracking-widest">{invitation.inviteCode}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-semibold">Workspace documents</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {approvals.length} review {approvals.length === 1 ? "item" : "items"}
            </p>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left font-heading text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Feedback</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No workspace documents yet.
                  </td>
                </tr>
              ) : (
                approvals.map((item) => (
                  <tr key={item.id} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.title}</div>
                      <div className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
                        {item.contextNote}
                      </div>
                      {item.reviewWorkspace ? (
                        <div className="mt-2 text-xs font-medium text-ember">
                          {item.reviewWorkspace.projectTitle ?? "Review Workspace"}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {item.status.replaceAll("_", " ")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.sourceKind === "generated_page"
                        ? "Generated page"
                        : item.currentVersion?.originalFilename ?? "No file"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div>{item.commentCount} comments</div>
                      <div className="mt-1">
                        {item.latestDecision
                          ? `${item.latestDecision.decision.replaceAll("_", " ")}`
                          : "No decision yet"}
                      </div>
                      {item.replyAttachments.length > 0 ? (
                        <div className="mt-2 space-y-1">
                          {item.replyAttachments.map((attachment) => (
                            <a
                              key={attachment.id}
                              href={`/api/bsm/content-approvals/attachments/${attachment.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="block font-medium text-ember hover:text-foreground"
                            >
                              Open photo: {attachment.originalFilename}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(item.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingItemId === item.id ? (
                        <div className="min-w-80 space-y-3 text-left">
                          <div className="space-y-1">
                            <Label htmlFor={`edit-title-${item.id}`}>Title</Label>
                            <Input
                              id={`edit-title-${item.id}`}
                              value={editTitle}
                              onChange={(event) => setEditTitle(event.target.value)}
                              disabled={savingEditItemId === item.id}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`edit-note-${item.id}`}>Context note</Label>
                            <textarea
                              id={`edit-note-${item.id}`}
                              value={editContextNote}
                              onChange={(event) => setEditContextNote(event.target.value)}
                              disabled={savingEditItemId === item.id}
                              className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                          </div>
                          {item.sourceKind === "uploaded_file" ? (
                            <div className="space-y-1">
                              <Label htmlFor={`edit-file-${item.id}`}>Replacement file</Label>
                              <Input
                                id={`edit-file-${item.id}`}
                                type="file"
                                accept={BSM_CONTENT_APPROVAL_FILE_ACCEPT}
                                disabled={savingEditItemId === item.id}
                                onChange={(event) => setEditFile(event.target.files?.[0] ?? null)}
                              />
                            </div>
                          ) : null}
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => saveReviewItemEdit(item)}
                              disabled={savingEditItemId === item.id}
                              className={cn(buttonVariants({ variant: "default", size: "sm" }), "gap-1")}
                            >
                              {savingEditItemId === item.id ? (
                                <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <FilePenLine className="size-3.5" aria-hidden="true" />
                              )}
                              {savingEditItemId === item.id ? "Saving" : "Save edit"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingItemId(null)}
                              disabled={savingEditItemId === item.id}
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : archiveItemId === item.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground">Remove from library?</span>
                          <button
                            type="button"
                            onClick={() => archiveReviewItem(item)}
                            disabled={archivingItemId === item.id}
                            className={cn(buttonVariants({ variant: "destructive", size: "sm" }), "gap-1")}
                          >
                            {archivingItemId === item.id ? (
                              <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            )}
                            {archivingItemId === item.id ? "Removing" : "Remove"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchiveItemId(null)}
                            disabled={archivingItemId === item.id}
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!item.reviewWorkspace && reviewWorkspaceProjectId ? (
                            <button
                              type="button"
                              onClick={() => attachReviewItemToSelectedWorkspace(item)}
                              disabled={Boolean(archivingItemId) || attachingItemId === item.id}
                              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
                              aria-label={`Attach ${item.title} to the selected Review Workspace`}
                              title="Attach to selected Review Workspace"
                            >
                              {attachingItemId === item.id ? (
                                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Link className="size-4" aria-hidden="true" />
                              )}
                              Attach
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => beginEdit(item)}
                            disabled={Boolean(archivingItemId) || Boolean(attachingItemId)}
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
                            aria-label={`Edit ${item.title}`}
                            title="Edit review item"
                          >
                            <FilePenLine className="size-4" aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchiveItemId(item.id)}
                            disabled={Boolean(archivingItemId) || Boolean(attachingItemId)}
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1")}
                            aria-label={`Remove ${item.title} from the active review library`}
                            title="Remove from active library"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            Remove
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
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
  }).format(date);
}
