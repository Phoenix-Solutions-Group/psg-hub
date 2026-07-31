import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  BSM_CONTENT_APPROVALS_BUCKET,
  MAX_APPROVAL_FILE_BYTES,
  SUPPORTED_APPROVAL_FILE_TYPES,
  type BsmContentApprovalListItem,
  type BsmContentApprovalWorkspaceOption,
  normalizeApprovalMimeType,
} from "@/lib/bsm/content-approvals-shared";
import { reviewWorkspaceStoragePath } from "@/lib/bsm/review-workspace-processing";

export {
  BSM_CONTENT_APPROVALS_BUCKET,
  MAX_APPROVAL_FILE_BYTES,
  SUPPORTED_APPROVAL_FILE_TYPES,
  type BsmContentApprovalListItem,
  type BsmContentApprovalWorkspaceOption,
  normalizeApprovalMimeType,
} from "@/lib/bsm/content-approvals-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const PGRST_SCHEMA_CACHE_COLUMN_RE = /'([^']+)' column/;
type BsmContentApprovalActorRole = "customer" | "psg_internal" | "psg_superadmin";

export type ContentApprovalStorage = {
  from(bucket: string): {
    createSignedUploadUrl(path: string): Promise<{
      data: { signedUrl: string; token: string; path: string } | null;
      error: { message: string } | null;
    }>;
  };
};

export type ApprovalUploadInput = {
  shopId: string;
  customerProfileId?: string | null;
  reviewWorkspaceProjectId?: string | null;
  title: string;
  contextNote: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  actorProfileId: string;
  actorRole?: BsmContentApprovalActorRole | null;
};

export type GeneratedPageApprovalInput = {
  shopId: string;
  customerProfileId?: string | null;
  reviewWorkspaceProjectId?: string | null;
  title: string;
  contextNote: string;
  generatedPagePath: string;
  previewUrl?: string | null;
  sourceContentItemId?: string | null;
  snapshot?: Record<string, unknown> | null;
  actorProfileId: string;
  actorRole?: BsmContentApprovalActorRole | null;
};

export type ApprovalUploadResult = {
  item: BsmContentApprovalListItem;
  upload: {
    bucket: typeof BSM_CONTENT_APPROVALS_BUCKET;
    path: string;
    signedUrl: string;
    token: string;
  };
};

export type GeneratedPageApprovalResult = {
  item: BsmContentApprovalListItem;
};

export type UpdateBsmContentApprovalInput = {
  itemId: string;
  title: string;
  contextNote: string;
  fileName?: string | null;
  contentType?: string | null;
  byteSize?: number | null;
  actorProfileId: string;
  actorRole?: BsmContentApprovalActorRole | null;
};

export type UpdateBsmContentApprovalResult = {
  item: BsmContentApprovalListItem;
  upload?: {
    bucket: typeof BSM_CONTENT_APPROVALS_BUCKET;
    path: string;
    signedUrl: string;
    token: string;
  };
};

export type AttachBsmContentApprovalToWorkspaceInput = {
  itemId: string;
  reviewWorkspaceProjectId: string;
  actorProfileId: string;
  actorRole?: BsmContentApprovalActorRole | null;
};

export type AttachBsmContentApprovalToWorkspaceResult = {
  item: BsmContentApprovalListItem;
};

export type ArchivedContentApprovalResult = {
  id: string;
  shopId: string;
  title: string;
  status: "archived";
};

export class ApprovalUploadInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalUploadInputError";
  }
}

function assertUuid(label: string, value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ApprovalUploadInputError(`${label} is required`);
  }
  return value;
}

function cleanText(label: string, value: unknown, max: number): string {
  if (typeof value !== "string") {
    throw new ApprovalUploadInputError(`${label} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApprovalUploadInputError(`${label} is required`);
  }
  if (trimmed.length > max) {
    throw new ApprovalUploadInputError(`${label} is too long`);
  }
  return trimmed;
}

function cleanOptionalUuid(label: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  return assertUuid(label, value);
}

function cleanOptionalUrl(label: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new ApprovalUploadInputError(`${label} must be a URL`);
  }
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new ApprovalUploadInputError(`${label} must be a valid URL`);
  }
}

function cleanGeneratedPagePath(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApprovalUploadInputError("generatedPagePath is required");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApprovalUploadInputError("generatedPagePath is required");
  }
  if (trimmed.length > 1200) {
    throw new ApprovalUploadInputError("generatedPagePath is too long");
  }
  if (/[\u0000-\u001f]/.test(trimmed)) {
    throw new ApprovalUploadInputError("generatedPagePath contains invalid characters");
  }
  return trimmed;
}

export function normalizeApprovalFileName(fileName: unknown): string {
  if (typeof fileName !== "string" || !fileName.trim()) {
    throw new ApprovalUploadInputError("Choose a file before uploading");
  }
  const segment = fileName.trim().replace(/\s+/g, "-");
  if (segment.includes("..") || segment.includes("/") || segment.includes("\\") || !SAFE_SEGMENT_RE.test(segment)) {
    throw new ApprovalUploadInputError(
      "Rename the file using letters, numbers, dots, dashes, or underscores, then try again",
    );
  }
  return segment;
}

export function validateApprovalFile(contentType: unknown, byteSize: unknown, fileName?: unknown) {
  const normalizedContentType = normalizeApprovalMimeType(fileName, contentType);
  if (!normalizedContentType) {
    throw new ApprovalUploadInputError(
      "This file type is not supported. Upload a PDF, MD, HTML, image, Word document, or text file.",
    );
  }
  if (typeof byteSize !== "number" || !Number.isFinite(byteSize) || byteSize <= 0) {
    throw new ApprovalUploadInputError("The selected file is empty");
  }
  if (byteSize > MAX_APPROVAL_FILE_BYTES) {
    throw new ApprovalUploadInputError("The file is too large. Upload a file under 25 MB.");
  }
  return {
    ...SUPPORTED_APPROVAL_FILE_TYPES[normalizedContentType],
    mimeType: normalizedContentType,
  };
}

export function approvalStoragePath(input: {
  shopId: string;
  itemId: string;
  versionId: string;
  fileName: string;
}): string {
  return `${input.shopId}/${input.itemId}/${input.versionId}/${input.fileName}`;
}

function approvalWorkspaceOriginalStoragePath(input: {
  shopId: string;
  projectId: string;
  itemId: string;
  versionId: string;
  fileName: string;
}): string {
  return reviewWorkspaceStoragePath({
    shopId: input.shopId,
    projectId: input.projectId,
    documentId: input.itemId,
    versionId: input.versionId,
    artifactKind: "original",
    fileName: input.fileName,
  });
}

function resolveStorage(deps: { storage?: ContentApprovalStorage }) {
  return deps.storage ?? (createServiceClient().storage as unknown as ContentApprovalStorage);
}

async function cleanupReviewItemAfterFailedUploadSetup(client: SupabaseClient, itemId: string) {
  await client.from("bsm_content_review_items").delete().eq("id", itemId);
}

async function loadReviewWorkspaceForAttachment(
  client: SupabaseClient,
  input: {
    projectId: string | null;
    shopId: string;
    actorProfileId: string;
    actorRole?: BsmContentApprovalActorRole | null;
  },
): Promise<{ projectId: string; title: string; roundId: string } | null> {
  if (!input.projectId) return null;

  const { data: project, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, title, status, current_round_id, deleted_at")
    .eq("id", input.projectId)
    .eq("shop_id", input.shopId)
    .maybeSingle();
  if (projectError) throw new Error(`Could not load review workspace: ${projectError.message}`);
  if (!project || project.deleted_at) {
    throw new ApprovalUploadInputError("Choose an active Review Workspace for this shop");
  }
  if (!project.current_round_id) {
    throw new ApprovalUploadInputError("The selected Review Workspace does not have a current review round");
  }

  if (input.actorRole !== "psg_superadmin") {
    const { data: collaborator, error: collaboratorError } = await client
      .from("bsm_content_review_project_collaborators")
      .select("role")
      .eq("project_id", input.projectId)
      .eq("profile_id", input.actorProfileId)
      .is("removed_at", null)
      .maybeSingle();
    if (collaboratorError) throw new Error(`Could not check Review Workspace access: ${collaboratorError.message}`);
    if (!collaborator) {
      throw new ApprovalUploadInputError("You do not have access to the selected Review Workspace");
    }
  }

  return {
    projectId: project.id as string,
    title: project.title as string,
    roundId: project.current_round_id as string,
  };
}

async function nextWorkspaceDocumentPosition(client: SupabaseClient, projectId: string): Promise<number> {
  const { data, error } = await client
    .from("bsm_content_review_items")
    .select("position")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("position", { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not choose Review Workspace document position: ${error.message}`);
  const latest = ((data ?? []) as Array<Record<string, unknown>>)[0]?.position;
  return typeof latest === "number" && Number.isFinite(latest) ? latest + 1 : 1;
}

async function attachItemToCurrentWorkspaceRound(
  client: SupabaseClient,
  input: {
    workspace: { projectId: string; roundId: string };
    shopId: string;
    itemId: string;
    versionId: string;
    actorProfileId: string;
  },
): Promise<void> {
  const { error } = await client.from("bsm_content_review_round_documents").insert({
    round_id: input.workspace.roundId,
    project_id: input.workspace.projectId,
    shop_id: input.shopId,
    review_item_id: input.itemId,
    version_id: input.versionId,
    decision_required: true,
  });
  if (error) throw new Error(`Could not attach document to Review Workspace round: ${error.message}`);

  const { error: eventError } = await client.from("bsm_content_review_events").insert({
    shop_id: input.shopId,
    review_item_id: input.itemId,
    version_id: input.versionId,
    event_type: "review_workspace_document_attached",
    actor_profile_id: input.actorProfileId,
    payload_jsonb: { projectId: input.workspace.projectId, roundId: input.workspace.roundId },
  });
  if (eventError) throw new Error(`Could not record Review Workspace attachment: ${eventError.message}`);
}

function missingSchemaCacheColumn(error: { code?: string | null; message?: string | null } | null): string | null {
  if (error?.code !== "PGRST204") return null;
  const match = error.message?.match(PGRST_SCHEMA_CACHE_COLUMN_RE);
  return match?.[1] ?? null;
}

async function insertWithSchemaCacheFallback(
  client: SupabaseClient,
  table: string,
  payload: Record<string, unknown> | Array<Record<string, unknown>>,
  fallbackColumns: ReadonlySet<string>,
  errorPrefix: string,
): Promise<void> {
  const attemptedColumns = new Set<string>();
  let nextPayload = Array.isArray(payload)
    ? payload.map((row) => ({ ...row }))
    : { ...payload };

  while (true) {
    const { error } = await client.from(table).insert(nextPayload);
    if (!error) return;

    const missingColumn = missingSchemaCacheColumn(error);
    if (!missingColumn || !fallbackColumns.has(missingColumn) || attemptedColumns.has(missingColumn)) {
      throw new Error(`${errorPrefix}: ${error.message}`);
    }

    attemptedColumns.add(missingColumn);
    if (Array.isArray(nextPayload)) {
      nextPayload = nextPayload.map((row) => {
        const retryRow = { ...row };
        delete retryRow[missingColumn];
        return retryRow;
      });
    } else {
      const retryPayload = { ...nextPayload };
      delete retryPayload[missingColumn];
      nextPayload = retryPayload;
    }
  }
}

async function loadExistingReviewerKeys(client: SupabaseClient, itemId: string): Promise<Set<string>> {
  const fallbackColumns = new Set(["invitation_id", "reviewer_email", "removed_at"]);
  const attemptedColumns = new Set<string>();
  const selectColumns = new Set(["profile_id", "reviewer_email", "invitation_id"]);
  let filterRemovedAt = true;

  while (true) {
    let query = client
      .from("bsm_content_review_reviewers")
      .select(Array.from(selectColumns).join(", "))
      .eq("review_item_id", itemId);
    if (filterRemovedAt) {
      query = query.is("removed_at", null);
    }

    const { data, error } = await query;
    if (!error) {
      return new Set(
        ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
          const profileId = row.profile_id as string | null;
          if (profileId) return `profile:${profileId}`;
          const invitationId = row.invitation_id as string | null;
          if (invitationId) return `invitation:${invitationId}`;
          return `email:${((row.reviewer_email as string | null) ?? "").toLowerCase()}`;
        }),
      );
    }

    const missingColumn = missingSchemaCacheColumn(error);
    if (!missingColumn || !fallbackColumns.has(missingColumn) || attemptedColumns.has(missingColumn)) {
      throw new Error(`Could not load existing reviewers: ${error.message}`);
    }

    attemptedColumns.add(missingColumn);
    if (missingColumn === "removed_at") {
      filterRemovedAt = false;
    } else {
      selectColumns.delete(missingColumn);
    }
  }
}

async function addReviewersForItem(
  client: SupabaseClient,
  input: {
    itemId: string;
    shopId: string;
    customerProfileId: string | null;
    workspace: { projectId: string; roundId: string } | null;
  },
): Promise<void> {
  const reviewerRows: Array<Record<string, unknown>> = [];
  let existingReviewerKeys = new Set<string>();

  if (input.workspace) {
    existingReviewerKeys = await loadExistingReviewerKeys(client, input.itemId);
  }

  if (input.workspace) {
    const { data: invitations, error: invitationError } = await client
      .from("bsm_content_review_invitations")
      .select("id, reviewer_profile_id, reviewer_email, reviewer_name")
      .eq("project_id", input.workspace.projectId)
      .eq("round_id", input.workspace.roundId)
      .in("status", ["sent", "viewed", "submitted"])
      .is("revoked_at", null);
    if (invitationError) throw new Error(`Could not load Review Workspace reviewers: ${invitationError.message}`);

    for (const invitation of (invitations ?? []) as Array<Record<string, unknown>>) {
      reviewerRows.push({
        review_item_id: input.itemId,
        shop_id: input.shopId,
        profile_id: (invitation.reviewer_profile_id as string | null) ?? null,
        invitation_id: invitation.id,
        round_id: input.workspace.roundId,
        reviewer_email: (invitation.reviewer_email as string | null) ?? null,
        reviewer_name: (invitation.reviewer_name as string | null) ?? null,
        reviewer_role: "reviewer",
        notification_preference: "email",
        submission_status: "not_started",
      });
    }
  }

  if (
    input.customerProfileId &&
    !reviewerRows.some((row) => row.profile_id === input.customerProfileId)
  ) {
    reviewerRows.push({
      review_item_id: input.itemId,
      shop_id: input.shopId,
      profile_id: input.customerProfileId,
      reviewer_role: "reviewer",
      notification_preference: "email",
      ...(input.workspace ? { round_id: input.workspace.roundId, submission_status: "not_started" } : {}),
    });
  }

  const dedupedReviewerRows = reviewerRows.filter((row, index, rows) => {
    const profileId = row.profile_id as string | null;
    const invitationId = row.invitation_id as string | null;
    const email = ((row.reviewer_email as string | null) ?? "").toLowerCase();
    const key = profileId ? `profile:${profileId}` : invitationId ? `invitation:${invitationId}` : `email:${email}`;
    if (existingReviewerKeys.has(key)) return false;
    return rows.findIndex((candidate) => {
      const candidateProfileId = candidate.profile_id as string | null;
      const candidateInvitationId = candidate.invitation_id as string | null;
      const candidateEmail = ((candidate.reviewer_email as string | null) ?? "").toLowerCase();
      const candidateKey = candidateProfileId
        ? `profile:${candidateProfileId}`
        : candidateInvitationId
          ? `invitation:${candidateInvitationId}`
          : `email:${candidateEmail}`;
      return candidateKey === key;
    }) === index;
  });

  if (dedupedReviewerRows.length === 0) return;

  await insertWithSchemaCacheFallback(
    client,
    "bsm_content_review_reviewers",
    dedupedReviewerRows,
    new Set(["invitation_id", "round_id", "reviewer_email", "reviewer_name", "submission_status"]),
    "Could not add reviewer",
  );
}

function toListItem(input: {
  itemId: string;
  shopId: string;
  customerProfileId: string | null;
  title: string;
  status: string;
  contentType: string;
  sourceKind: "uploaded_file" | "generated_page";
  contextNote: string | null;
  updatedAt: string;
  versionId: string;
  fileName: string | null;
  mimeType: string;
  byteSize: number;
  storagePath: string | null;
  previewType: string;
  sourceMetadata?: Record<string, unknown>;
  workspace?: { projectId: string; title: string | null; roundId: string | null } | null;
}): BsmContentApprovalListItem {
  return {
    id: input.itemId,
    shopId: input.shopId,
    customerProfileId: input.customerProfileId,
    title: input.title,
    status: input.status,
    contentType: input.contentType,
    sourceKind: input.sourceKind,
    contextNote: input.contextNote,
    updatedAt: input.updatedAt,
    currentVersion: {
      id: input.versionId,
      originalFilename: input.fileName,
      contentType: input.mimeType,
      byteSize: input.byteSize,
      storagePath: input.storagePath,
      previewType: input.previewType,
      sourceMetadata: input.sourceMetadata ?? {},
      createdAt: input.updatedAt,
    },
    latestDecision: null,
    replyAttachments: [],
    commentCount: 0,
    reviewWorkspace: input.workspace
      ? {
          projectId: input.workspace.projectId,
          projectTitle: input.workspace.title,
          roundId: input.workspace.roundId,
        }
      : null,
  };
}

export async function createBsmContentApprovalUpload(
  input: ApprovalUploadInput,
  deps: { client?: SupabaseClient; storage?: ContentApprovalStorage } = {},
): Promise<ApprovalUploadResult> {
  const shopId = assertUuid("shopId", input.shopId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const customerProfileId = cleanOptionalUuid("customerProfileId", input.customerProfileId);
  const reviewWorkspaceProjectId = cleanOptionalUuid("reviewWorkspaceProjectId", input.reviewWorkspaceProjectId);
  const title = cleanText("title", input.title, 160);
  const contextNote = cleanText("contextNote", input.contextNote, 3000);
  const fileName = normalizeApprovalFileName(input.fileName);
  const file = validateApprovalFile(input.contentType, input.byteSize, fileName);
  const itemId = randomUUID();
  const versionId = randomUUID();
  const client = deps.client ?? createServiceClient();
  const workspace = await loadReviewWorkspaceForAttachment(client, {
    projectId: reviewWorkspaceProjectId,
    shopId,
    actorProfileId,
    actorRole: input.actorRole,
  });
  const path = approvalStoragePath({
    shopId,
    itemId,
    versionId,
    fileName,
  });
  const originalStoragePath = workspace
    ? approvalWorkspaceOriginalStoragePath({
        shopId,
        projectId: workspace.projectId,
        itemId,
        versionId,
        fileName,
      })
    : null;
  const position = workspace ? await nextWorkspaceDocumentPosition(client, workspace.projectId) : null;

  const { error: itemError } = await client.from("bsm_content_review_items").insert({
    id: itemId,
    shop_id: shopId,
    project_id: workspace?.projectId ?? null,
    position,
    required: Boolean(workspace),
    customer_profile_id: customerProfileId,
    title,
    content_type: file.contentType,
    source_kind: "uploaded_file",
    status: workspace ? "in_review" : "draft",
    processing_status: workspace ? "ready" : "pending",
    admin_context_note: contextNote,
    created_by_profile_id: actorProfileId,
    metadata_jsonb: workspace ? { reviewWorkspaceProjectId: workspace.projectId } : {},
  });
  if (itemError) throw new Error(`Could not create review item: ${itemError.message}`);

  let data: { signedUrl: string; token: string; path: string } | null = null;
  try {
    const { error: versionError } = await client.from("bsm_content_review_versions").insert({
      id: versionId,
      review_item_id: itemId,
      shop_id: shopId,
      version_number: 1,
      status: "current",
      storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
      storage_path: path,
      original_storage_bucket: workspace ? BSM_CONTENT_APPROVALS_BUCKET : null,
      original_storage_path: originalStoragePath,
      original_filename: fileName,
      content_type: file.mimeType,
      byte_size: input.byteSize,
      preview_type: file.contentType === "image" ? "image" : "file",
      project_id: workspace?.projectId ?? null,
      round_id: workspace?.roundId ?? null,
      processed_storage_bucket: null,
      processed_storage_path: null,
      processed_content_type: null,
      scan_status: "clean",
      conversion_status: "not_needed",
      sanitization_status: "not_needed",
      introduced_by_round_id: workspace?.roundId ?? null,
      created_by_profile_id: actorProfileId,
    });
    if (versionError) throw new Error(`Could not create review version: ${versionError.message}`);

    const { error: updateError } = await client
      .from("bsm_content_review_items")
      .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
      .eq("id", itemId);
    if (updateError) throw new Error(`Could not link current version: ${updateError.message}`);

    await addReviewersForItem(client, {
      itemId,
      shopId,
      customerProfileId,
      workspace: workspace ? { projectId: workspace.projectId, roundId: workspace.roundId } : null,
    });

    if (workspace) {
      await attachItemToCurrentWorkspaceRound(client, {
        workspace,
        shopId,
        itemId,
        versionId,
        actorProfileId,
      });
    }

    const { error: eventError } = await client.from("bsm_content_review_events").insert({
      shop_id: shopId,
      review_item_id: itemId,
      version_id: versionId,
      event_type: "review_item_created",
      actor_profile_id: actorProfileId,
      payload_jsonb: { title, storagePath: path, originalFilename: fileName },
    });
    if (eventError) throw new Error(`Could not record review event: ${eventError.message}`);

    const storage = resolveStorage(deps);
    const uploadResult = await storage
      .from(BSM_CONTENT_APPROVALS_BUCKET)
      .createSignedUploadUrl(path);
    data = uploadResult.data;
    if (uploadResult.error || !data) {
      throw new Error(`Could not start upload: ${uploadResult.error?.message ?? "no upload URL returned"}`);
    }
  } catch (error) {
    await cleanupReviewItemAfterFailedUploadSetup(client, itemId);
    throw error;
  }

  return {
    item: toListItem({
      itemId,
      shopId,
      customerProfileId,
      title,
      status: workspace ? "in_review" : "draft",
      contentType: file.contentType,
      sourceKind: "uploaded_file",
      contextNote,
      updatedAt: new Date().toISOString(),
      versionId,
      fileName,
      mimeType: file.mimeType,
      byteSize: input.byteSize,
      storagePath: path,
      previewType: file.contentType === "image" ? "image" : "file",
      workspace: workspace ? { projectId: workspace.projectId, title: workspace.title, roundId: workspace.roundId } : null,
    }),
    upload: {
      bucket: BSM_CONTENT_APPROVALS_BUCKET,
      path: data.path ?? path,
      signedUrl: data.signedUrl,
      token: data.token,
    },
  };
}

export async function createBsmGeneratedPageApproval(
  input: GeneratedPageApprovalInput,
  deps: { client?: SupabaseClient } = {},
): Promise<GeneratedPageApprovalResult> {
  const shopId = assertUuid("shopId", input.shopId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const customerProfileId = cleanOptionalUuid("customerProfileId", input.customerProfileId);
  const reviewWorkspaceProjectId = cleanOptionalUuid("reviewWorkspaceProjectId", input.reviewWorkspaceProjectId);
  const sourceContentItemId = cleanOptionalUuid("sourceContentItemId", input.sourceContentItemId);
  const title = cleanText("title", input.title, 160);
  const contextNote = cleanText("contextNote", input.contextNote, 3000);
  const generatedPagePath = cleanGeneratedPagePath(input.generatedPagePath);
  const previewUrl = cleanOptionalUrl("previewUrl", input.previewUrl);
  const itemId = randomUUID();
  const versionId = randomUUID();
  const client = deps.client ?? createServiceClient();
  const workspace = await loadReviewWorkspaceForAttachment(client, {
    projectId: reviewWorkspaceProjectId,
    shopId,
    actorProfileId,
    actorRole: input.actorRole,
  });
  const position = workspace ? await nextWorkspaceDocumentPosition(client, workspace.projectId) : null;
  const sourceMetadata = {
    ...(input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {}),
    sourceKind: "generated_page",
    generatedPagePath,
    previewUrl,
    sourceContentItemId,
  };

  const { error: itemError } = await client.from("bsm_content_review_items").insert({
    id: itemId,
    shop_id: shopId,
    project_id: workspace?.projectId ?? null,
    position,
    required: Boolean(workspace),
    source_content_item_id: sourceContentItemId,
    customer_profile_id: customerProfileId,
    title,
    content_type: "generated_page",
    source_kind: "generated_page",
    status: workspace ? "in_review" : "draft",
    processing_status: workspace ? "ready" : "pending",
    admin_context_note: contextNote,
    created_by_profile_id: actorProfileId,
    metadata_jsonb: { sourceKind: "generated_page" },
  });
  if (itemError) throw new Error(`Could not create generated page review item: ${itemError.message}`);

  const { error: versionError } = await client.from("bsm_content_review_versions").insert({
    id: versionId,
    review_item_id: itemId,
    shop_id: shopId,
    project_id: workspace?.projectId ?? null,
    round_id: workspace?.roundId ?? null,
    version_number: 1,
    status: "current",
    storage_bucket: null,
    storage_path: null,
    original_filename: null,
    content_type: "text/html",
    byte_size: 1,
    preview_type: "generated_page",
    source_metadata_jsonb: sourceMetadata,
    created_by_profile_id: actorProfileId,
  });
  if (versionError) throw new Error(`Could not create generated page review version: ${versionError.message}`);

  const { error: updateError } = await client
    .from("bsm_content_review_items")
    .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (updateError) throw new Error(`Could not link current generated page version: ${updateError.message}`);

  await addReviewersForItem(client, {
    itemId,
    shopId,
    customerProfileId,
    workspace: workspace ? { projectId: workspace.projectId, roundId: workspace.roundId } : null,
  });

  if (workspace) {
    await attachItemToCurrentWorkspaceRound(client, {
      workspace,
      shopId,
      itemId,
      versionId,
      actorProfileId,
    });
  }

  const { error: eventError } = await client.from("bsm_content_review_events").insert({
    shop_id: shopId,
    review_item_id: itemId,
    version_id: versionId,
    event_type: "review_item_created",
    actor_profile_id: actorProfileId,
    payload_jsonb: { title, sourceKind: "generated_page", generatedPagePath, previewUrl },
  });
  if (eventError) throw new Error(`Could not record review event: ${eventError.message}`);

  return {
    item: toListItem({
      itemId,
      shopId,
      customerProfileId,
      title,
      status: workspace ? "in_review" : "draft",
      contentType: "generated_page",
      sourceKind: "generated_page",
      contextNote,
      updatedAt: new Date().toISOString(),
      versionId,
      fileName: null,
      mimeType: "text/html",
      byteSize: 1,
      storagePath: null,
      previewType: "generated_page",
      sourceMetadata,
      workspace: workspace ? { projectId: workspace.projectId, title: workspace.title, roundId: workspace.roundId } : null,
    }),
  };
}

export async function updateBsmContentApproval(
  input: UpdateBsmContentApprovalInput,
  deps: { client?: SupabaseClient; storage?: ContentApprovalStorage } = {},
): Promise<UpdateBsmContentApprovalResult> {
  const itemId = assertUuid("itemId", input.itemId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const title = cleanText("title", input.title, 160);
  const contextNote = cleanText("contextNote", input.contextNote, 3000);
  const hasReplacementFile = Boolean(input.fileName || input.contentType || input.byteSize);
  const client = deps.client ?? createServiceClient();
  const updatedAt = new Date().toISOString();

  const { data: item, error: itemReadError } = await client
    .from("bsm_content_review_items")
    .select("id, shop_id, customer_profile_id, title, status, content_type, project_id, current_version_id")
    .eq("id", itemId)
    .single();
  if (itemReadError || !item) throw new ApprovalUploadInputError("Review item not found");
  const row = item as Record<string, unknown>;
  const shopId = assertUuid("shopId", row.shop_id);
  const customerProfileId = (row.customer_profile_id as string | null) ?? null;
  const projectId = (row.project_id as string | null) ?? null;

  let workspace: { projectId: string; title: string; roundId: string } | null = null;
  if (projectId) {
    workspace = await loadReviewWorkspaceForAttachment(client, {
      projectId,
      shopId,
      actorProfileId,
      actorRole: input.actorRole,
    });
  }

  let versionId = (row.current_version_id as string | null) ?? null;
  let upload: UpdateBsmContentApprovalResult["upload"];
  let versionFileName: string | null = null;
  let versionMimeType = "text/plain";
  let versionByteSize = 1;
  let versionStoragePath: string | null = null;
  let versionPreviewType = "file";
  let contentType = (row.content_type as string | null) ?? "document";

  if (versionId) {
    const { data: currentVersion } = await client
      .from("bsm_content_review_versions")
      .select("id, original_filename, content_type, byte_size, storage_path, preview_type, source_metadata_jsonb")
      .eq("id", versionId)
      .maybeSingle();
    if (currentVersion) {
      const version = currentVersion as Record<string, unknown>;
      versionFileName = (version.original_filename as string | null) ?? null;
      versionMimeType = (version.content_type as string | null) ?? versionMimeType;
      versionByteSize = (version.byte_size as number | null) ?? versionByteSize;
      versionStoragePath = (version.storage_path as string | null) ?? null;
      versionPreviewType = (version.preview_type as string | null) ?? versionPreviewType;
    }
  }

  if (hasReplacementFile) {
    const fileName = normalizeApprovalFileName(input.fileName);
    const file = validateApprovalFile(input.contentType, input.byteSize, fileName);
    versionId = randomUUID();
    const path = approvalStoragePath({
      shopId,
      itemId,
      versionId,
      fileName,
    });
    const originalStoragePath = workspace
      ? approvalWorkspaceOriginalStoragePath({
          shopId,
          projectId: workspace.projectId,
          itemId,
          versionId,
          fileName,
        })
      : null;

    const { data: existingVersions, error: versionReadError } = await client
      .from("bsm_content_review_versions")
      .select("version_number")
      .eq("review_item_id", itemId)
      .order("version_number", { ascending: false })
      .limit(1);
    if (versionReadError) throw new Error(`Could not read existing review versions: ${versionReadError.message}`);
    const latestVersionNumber = ((existingVersions ?? []) as Array<Record<string, unknown>>)[0]?.version_number;
    const versionNumber = typeof latestVersionNumber === "number" ? latestVersionNumber + 1 : 2;

    await client.from("bsm_content_review_versions").update({ status: "superseded" }).eq("review_item_id", itemId).eq("status", "current");

    const { error: versionError } = await client.from("bsm_content_review_versions").insert({
      id: versionId,
      review_item_id: itemId,
      shop_id: shopId,
      project_id: workspace?.projectId ?? null,
      round_id: workspace?.roundId ?? null,
      version_number: versionNumber,
      status: "current",
      storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
      storage_path: path,
      original_storage_bucket: workspace ? BSM_CONTENT_APPROVALS_BUCKET : null,
      original_storage_path: originalStoragePath,
      original_filename: fileName,
      content_type: file.mimeType,
      byte_size: input.byteSize,
      preview_type: file.contentType === "image" ? "image" : "file",
      processed_storage_bucket: null,
      processed_storage_path: null,
      processed_content_type: null,
      scan_status: "clean",
      conversion_status: "not_needed",
      sanitization_status: "not_needed",
      introduced_by_round_id: workspace?.roundId ?? null,
      created_by_profile_id: actorProfileId,
    });
    if (versionError) throw new Error(`Could not create replacement review version: ${versionError.message}`);

    if (workspace) {
      const { error: roundDocUpdateError } = await client
        .from("bsm_content_review_round_documents")
        .update({ version_id: versionId })
        .eq("round_id", workspace.roundId)
        .eq("review_item_id", itemId);
      if (roundDocUpdateError) throw new Error(`Could not update Review Workspace document version: ${roundDocUpdateError.message}`);
    }

    const storage = resolveStorage(deps);
    const { data, error: uploadError } = await storage
      .from(BSM_CONTENT_APPROVALS_BUCKET)
      .createSignedUploadUrl(path);
    if (uploadError || !data) {
      throw new Error(`Could not start replacement upload: ${uploadError?.message ?? "no upload URL returned"}`);
    }
    upload = {
      bucket: BSM_CONTENT_APPROVALS_BUCKET,
      path: data.path ?? path,
      signedUrl: data.signedUrl,
      token: data.token,
    };
    versionFileName = fileName;
    versionMimeType = file.mimeType;
    versionByteSize = input.byteSize as number;
    versionStoragePath = path;
    versionPreviewType = file.contentType === "image" ? "image" : "file";
    contentType = file.contentType;
  }

  const { error: updateError } = await client
    .from("bsm_content_review_items")
    .update({
      title,
      admin_context_note: contextNote,
      current_version_id: versionId,
      content_type: contentType,
      processing_status: workspace ? "ready" : "pending",
      updated_at: updatedAt,
    })
    .eq("id", itemId);
  if (updateError) throw new Error(`Could not save review item edits: ${updateError.message}`);

  const { error: eventError } = await client.from("bsm_content_review_events").insert({
    shop_id: shopId,
    review_item_id: itemId,
    version_id: versionId,
    event_type: hasReplacementFile ? "review_item_version_replaced" : "review_item_updated",
    actor_profile_id: actorProfileId,
    payload_jsonb: { title, replacementFile: hasReplacementFile },
  });
  if (eventError) throw new Error(`Could not record review item edit event: ${eventError.message}`);

  return {
    item: toListItem({
      itemId,
      shopId,
      customerProfileId,
      title,
      status: row.status as string,
      contentType,
      sourceKind: "uploaded_file",
      contextNote,
      updatedAt,
      versionId: versionId ?? "",
      fileName: versionFileName,
      mimeType: versionMimeType,
      byteSize: versionByteSize,
      storagePath: versionStoragePath,
      previewType: versionPreviewType,
      workspace: workspace ? { projectId: workspace.projectId, title: workspace.title, roundId: workspace.roundId } : null,
    }),
    upload,
  };
}

export async function attachBsmContentApprovalToWorkspace(
  input: AttachBsmContentApprovalToWorkspaceInput,
  deps: { client?: SupabaseClient } = {},
): Promise<AttachBsmContentApprovalToWorkspaceResult> {
  const itemId = assertUuid("itemId", input.itemId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const reviewWorkspaceProjectId = cleanOptionalUuid("reviewWorkspaceProjectId", input.reviewWorkspaceProjectId);
  if (!reviewWorkspaceProjectId) {
    throw new ApprovalUploadInputError("Choose a Review Workspace before attaching this item");
  }

  const client = deps.client ?? createServiceClient();
  const { data: item, error: itemReadError } = await client
    .from("bsm_content_review_items")
    .select("id, shop_id, customer_profile_id, title, status, content_type, admin_context_note, project_id, current_version_id")
    .eq("id", itemId)
    .single();
  if (itemReadError || !item) throw new ApprovalUploadInputError("Review item not found");

  const row = item as Record<string, unknown>;
  const shopId = assertUuid("shopId", row.shop_id);
  const customerProfileId = (row.customer_profile_id as string | null) ?? null;
  const versionId = assertUuid("currentVersionId", row.current_version_id);
  const workspace = await loadReviewWorkspaceForAttachment(client, {
    projectId: reviewWorkspaceProjectId,
    shopId,
    actorProfileId,
    actorRole: input.actorRole,
  });
  if (!workspace) throw new ApprovalUploadInputError("Choose a Review Workspace before attaching this item");

  const { data: currentVersion, error: versionReadError } = await client
    .from("bsm_content_review_versions")
    .select("id, original_filename, content_type, byte_size, storage_path, preview_type, source_metadata_jsonb")
    .eq("id", versionId)
    .maybeSingle();
  if (versionReadError || !currentVersion) throw new ApprovalUploadInputError("Review item version not found");
  const version = currentVersion as Record<string, unknown>;
  const position = await nextWorkspaceDocumentPosition(client, workspace.projectId);
  const updatedAt = new Date().toISOString();

  const { error: itemUpdateError } = await client
    .from("bsm_content_review_items")
    .update({
      project_id: workspace.projectId,
      position,
      required: true,
      status: "in_review",
      processing_status: "ready",
      metadata_jsonb: { reviewWorkspaceProjectId: workspace.projectId },
      updated_at: updatedAt,
    })
    .eq("id", itemId);
  if (itemUpdateError) throw new Error(`Could not attach review item to Review Workspace: ${itemUpdateError.message}`);

  const { error: versionUpdateError } = await client
    .from("bsm_content_review_versions")
    .update({
      project_id: workspace.projectId,
      round_id: workspace.roundId,
      introduced_by_round_id: workspace.roundId,
    })
    .eq("id", versionId);
  if (versionUpdateError) throw new Error(`Could not attach review version to Review Workspace: ${versionUpdateError.message}`);

  await addReviewersForItem(client, {
    itemId,
    shopId,
    customerProfileId,
    workspace: { projectId: workspace.projectId, roundId: workspace.roundId },
  });

  await attachItemToCurrentWorkspaceRound(client, {
    workspace,
    shopId,
    itemId,
    versionId,
    actorProfileId,
  });

  return {
    item: toListItem({
      itemId,
      shopId,
      customerProfileId,
      title: row.title as string,
      status: "in_review",
      contentType: row.content_type as string,
      sourceKind: row.content_type === "generated_page" ? "generated_page" : "uploaded_file",
      contextNote: (row.admin_context_note as string | null) ?? null,
      updatedAt,
      versionId,
      fileName: (version.original_filename as string | null) ?? null,
      mimeType: (version.content_type as string | null) ?? "text/plain",
      byteSize: (version.byte_size as number | null) ?? 1,
      storagePath: (version.storage_path as string | null) ?? null,
      previewType: (version.preview_type as string | null) ?? "file",
      sourceMetadata: (version.source_metadata_jsonb as Record<string, unknown> | null) ?? {},
      workspace: { projectId: workspace.projectId, title: workspace.title, roundId: workspace.roundId },
    }),
  };
}

export async function archiveBsmContentApproval(
  input: { itemId: string; actorProfileId: string },
  deps: { client?: SupabaseClient } = {},
): Promise<ArchivedContentApprovalResult> {
  const itemId = assertUuid("itemId", input.itemId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const client = deps.client ?? createServiceClient();
  const archivedAt = new Date().toISOString();

  const { data: item, error: readError } = await client
    .from("bsm_content_review_items")
    .select("id, shop_id, title, status")
    .eq("id", itemId)
    .single();
  if (readError || !item) {
    throw new ApprovalUploadInputError("Review item not found");
  }

  const row = item as Record<string, unknown>;
  const shopId = assertUuid("shopId", row.shop_id);
  const title = typeof row.title === "string" ? row.title : "Review item";

  const { error: updateError } = await client
    .from("bsm_content_review_items")
    .update({ status: "archived", archived_at: archivedAt, updated_at: archivedAt })
    .eq("id", itemId);
  if (updateError) throw new Error(`Could not archive review item: ${updateError.message}`);

  const { error: eventError } = await client.from("bsm_content_review_events").insert({
    shop_id: shopId,
    review_item_id: itemId,
    event_type: "review_item_archived",
    actor_profile_id: actorProfileId,
    payload_jsonb: { title, archivedAt },
  });
  if (eventError) throw new Error(`Could not record archive event: ${eventError.message}`);

  return { id: itemId, shopId, title, status: "archived" };
}

export async function listBsmContentApprovalWorkspaces(
  client: SupabaseClient,
  opts: { shopId?: string | null; actorProfileId?: string | null } = {},
): Promise<BsmContentApprovalWorkspaceOption[]> {
  let query = client
    .from("bsm_content_review_projects")
    .select("id, shop_id, title, status, current_round_id")
    .is("deleted_at", null)
    .in("status", ["draft", "processing", "ready", "active"])
    .order("updated_at", { ascending: false })
    .limit(100);
  if (opts.shopId) query = query.eq("shop_id", opts.shopId);

  const { data: projects, error } = await query;
  if (error) throw new Error(`Could not load Review Workspaces: ${error.message}`);
  const rows = (projects ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const projectIds = rows.map((row) => row.id as string);
  const { data: documents } = await client
    .from("bsm_content_review_items")
    .select("project_id")
    .in("project_id", projectIds)
    .is("deleted_at", null);

  const documentCounts = new Map<string, number>();
  for (const doc of (documents ?? []) as Array<Record<string, unknown>>) {
    const projectId = doc.project_id as string;
    documentCounts.set(projectId, (documentCounts.get(projectId) ?? 0) + 1);
  }

  return rows
    .map((row) => ({
      id: row.id as string,
      shopId: row.shop_id as string,
      title: row.title as string,
      status: row.status as string,
      currentRoundId: (row.current_round_id as string | null) ?? null,
      documentCount: documentCounts.get(row.id as string) ?? 0,
    }));
}

export async function listBsmContentApprovals(
  client: SupabaseClient,
  opts: { shopId?: string | null } = {},
): Promise<BsmContentApprovalListItem[]> {
  let query = client
    .from("bsm_content_review_items")
    .select("id, shop_id, customer_profile_id, title, status, content_type, admin_context_note, project_id, current_version_id, updated_at, metadata_jsonb")
    .is("archived_at", null)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (opts.shopId) query = query.eq("shop_id", opts.shopId);

  const { data: items, error } = await query;
  if (error) throw new Error(`Could not load content approvals: ${error.message}`);
  const rows = (items ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const itemIds = rows.map((row) => row.id as string);
  const versionIds = rows.map((row) => row.current_version_id).filter(Boolean) as string[];
  const projectIds = [...new Set(rows.map((row) => row.project_id).filter(Boolean) as string[])];

  const [{ data: versions }, { data: decisions }, { data: comments }, { data: attachments }, { data: projects }] = await Promise.all([
    versionIds.length
      ? client
          .from("bsm_content_review_versions")
          .select("id, review_item_id, original_filename, content_type, byte_size, storage_path, preview_type, source_metadata_jsonb, created_at")
          .in("id", versionIds)
      : Promise.resolve({ data: [] }),
    client
      .from("bsm_content_review_decisions")
      .select("review_item_id, decision, message, created_at")
      .in("review_item_id", itemIds)
      .order("created_at", { ascending: false }),
    client
      .from("bsm_content_review_comments")
      .select("review_item_id")
      .in("review_item_id", itemIds),
    client
      .from("bsm_content_review_comment_attachments")
      .select("id, review_item_id, original_filename, byte_size, screening_status, created_at")
      .in("review_item_id", itemIds)
      .order("created_at", { ascending: false }),
    projectIds.length
      ? client
          .from("bsm_content_review_projects")
          .select("id, title, current_round_id")
          .in("id", projectIds)
      : Promise.resolve({ data: [] }),
  ]);

  const versionsById = new Map((versions ?? []).map((v) => [(v as { id: string }).id, v as Record<string, unknown>]));
  const projectsById = new Map((projects ?? []).map((p) => [(p as { id: string }).id, p as Record<string, unknown>]));
  const latestDecisionByItem = new Map<string, Record<string, unknown>>();
  for (const decision of (decisions ?? []) as Array<Record<string, unknown>>) {
    const itemId = decision.review_item_id as string;
    if (!latestDecisionByItem.has(itemId)) latestDecisionByItem.set(itemId, decision);
  }
  const commentCounts = new Map<string, number>();
  for (const comment of (comments ?? []) as Array<Record<string, unknown>>) {
    const itemId = comment.review_item_id as string;
    commentCounts.set(itemId, (commentCounts.get(itemId) ?? 0) + 1);
  }
  const attachmentsByItem = new Map<string, Array<Record<string, unknown>>>();
  for (const attachment of (attachments ?? []) as Array<Record<string, unknown>>) {
    const itemId = attachment.review_item_id as string;
    attachmentsByItem.set(itemId, [...(attachmentsByItem.get(itemId) ?? []), attachment]);
  }

  return rows.map((row) => {
    const version = row.current_version_id
      ? versionsById.get(row.current_version_id as string) ?? null
      : null;
    const decision = latestDecisionByItem.get(row.id as string) ?? null;
    const project = row.project_id ? projectsById.get(row.project_id as string) ?? null : null;
    return {
      id: row.id as string,
      shopId: row.shop_id as string,
      customerProfileId: (row.customer_profile_id as string | null) ?? null,
      title: row.title as string,
      status: row.status as string,
      contentType: row.content_type as string,
      sourceKind: row.content_type === "generated_page" ? "generated_page" : "uploaded_file",
      contextNote: (row.admin_context_note as string | null) ?? null,
      updatedAt: row.updated_at as string,
      currentVersion: version
        ? {
            id: version.id as string,
            originalFilename: (version.original_filename as string | null) ?? null,
            contentType: version.content_type as string,
            byteSize: version.byte_size as number,
            storagePath: (version.storage_path as string | null) ?? null,
            previewType: (version.preview_type as string | null) ?? "file",
            sourceMetadata: (version.source_metadata_jsonb as Record<string, unknown> | null) ?? {},
            createdAt: version.created_at as string,
          }
        : null,
      latestDecision: decision
        ? {
            decision: decision.decision as string,
            message: (decision.message as string | null) ?? null,
            createdAt: decision.created_at as string,
          }
        : null,
      replyAttachments: (attachmentsByItem.get(row.id as string) ?? []).map((attachment) => ({
        id: attachment.id as string,
        originalFilename: attachment.original_filename as string,
        byteSize: attachment.byte_size as number,
        screeningStatus: attachment.screening_status as string,
        createdAt: attachment.created_at as string,
      })),
      commentCount: commentCounts.get(row.id as string) ?? 0,
      reviewWorkspace: project
        ? {
            projectId: project.id as string,
            projectTitle: (project.title as string | null) ?? null,
            roundId: (project.current_round_id as string | null) ?? null,
          }
        : null,
    };
  });
}
