import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviewWorkspaceDbClient = Pick<SupabaseClient, "from">;

export class ReviewWorkspaceInputError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ReviewWorkspaceInputError";
    this.status = status;
  }
}

export type ReviewWorkspaceProject = {
  id: string;
  shopId: string;
  title: string;
  status: string;
  ownerProfileId: string;
};

export type CreateReviewWorkspaceProjectInput = {
  shopId: string;
  title: string;
  description?: string | null;
  actorProfileId: string;
  metadata?: Record<string, unknown> | null;
};

export type EnqueueReviewWorkspaceJobInput = {
  projectId: string;
  shopId: string;
  kind: "upload_scan" | "pdf_preview" | "doc_to_pdf" | "html_sanitize" | "zip_extract" | "summary_pdf" | "purge";
  idempotencyKey: string;
  actorProfileId?: string | null;
  reviewItemId?: string | null;
  versionId?: string | null;
  roundId?: string | null;
  input?: Record<string, unknown>;
};

export type GuestSessionAccess = {
  invitationId: string;
  sessionId: string;
  projectId: string;
  roundId: string;
  shopId: string;
  reviewerEmail: string;
};

export type AddGuestPinCommentInput = {
  sessionHash: string;
  reviewItemId: string;
  versionId: string;
  body: string;
  pinNumber: number;
  pageNumber?: number | null;
  viewport: "desktop" | "mobile" | "pdf_page";
  xRatio: number;
  yRatio: number;
  selection?: Record<string, unknown>;
};

function assertUuid(label: string, value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ReviewWorkspaceInputError(400, `${label} is required`);
  }
  return value;
}

function optionalUuid(label: string, value: unknown): string | null {
  if (value == null || value === "") return null;
  return assertUuid(label, value);
}

function cleanText(label: string, value: unknown, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ReviewWorkspaceInputError(400, `${label} is required`);
  if (text.length > max) {
    throw new ReviewWorkspaceInputError(400, `${label} must be ${max} characters or fewer`);
  }
  return text;
}

function cleanOptionalText(label: string, value: unknown, max: number): string | null {
  if (value == null || value === "") return null;
  return cleanText(label, value, max);
}

function assertRatio(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ReviewWorkspaceInputError(400, `${label} must be between 0 and 1`);
  }
  return value;
}

function resolveClient(client?: ReviewWorkspaceDbClient): ReviewWorkspaceDbClient {
  return client ?? createServiceClient();
}

async function insertEvent(
  client: ReviewWorkspaceDbClient,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from("bsm_content_review_events").insert(payload);
  if (error) throw new Error(`Could not record review workspace event: ${error.message}`);
}

export async function createReviewWorkspaceProject(
  input: CreateReviewWorkspaceProjectInput,
  deps: { client?: ReviewWorkspaceDbClient } = {},
): Promise<ReviewWorkspaceProject> {
  const shopId = assertUuid("shopId", input.shopId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const title = cleanText("title", input.title, 180);
  const description = cleanOptionalText("description", input.description, 4000);
  const projectId = randomUUID();
  const client = resolveClient(deps.client);

  const { error: projectError } = await client.from("bsm_content_review_projects").insert({
    id: projectId,
    shop_id: shopId,
    title,
    description,
    status: "draft",
    owner_profile_id: actorProfileId,
    created_by_profile_id: actorProfileId,
    metadata_jsonb: input.metadata ?? {},
  });
  if (projectError) throw new Error(`Could not create review workspace project: ${projectError.message}`);

  const { error: collaboratorError } = await client.from("bsm_content_review_project_collaborators").insert({
    project_id: projectId,
    shop_id: shopId,
    profile_id: actorProfileId,
    role: "owner",
    added_by_profile_id: actorProfileId,
  });
  if (collaboratorError) throw new Error(`Could not add review workspace owner: ${collaboratorError.message}`);

  await insertEvent(client, {
    shop_id: shopId,
    review_item_id: null,
    event_type: "review_workspace_project_created",
    actor_profile_id: actorProfileId,
    payload_jsonb: { projectId, title },
  });

  return { id: projectId, shopId, title, status: "draft", ownerProfileId: actorProfileId };
}

export async function requireReviewWorkspaceStaffAccess(
  client: ReviewWorkspaceDbClient,
  projectId: string,
  actorProfileId: string,
): Promise<{ projectId: string; shopId: string; status: string; role: string }> {
  const cleanProjectId = assertUuid("projectId", projectId);
  const cleanActorProfileId = assertUuid("actorProfileId", actorProfileId);

  const { data: project, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, status, deleted_at")
    .eq("id", cleanProjectId)
    .maybeSingle();
  if (projectError) throw new Error(`Could not load review workspace project: ${projectError.message}`);
  if (!project || project.deleted_at) throw new ReviewWorkspaceInputError(404, "Review workspace project not found");

  const { data: collaborator, error: collaboratorError } = await client
    .from("bsm_content_review_project_collaborators")
    .select("role")
    .eq("project_id", cleanProjectId)
    .eq("profile_id", cleanActorProfileId)
    .is("removed_at", null)
    .maybeSingle();
  if (collaboratorError) throw new Error(`Could not load review workspace collaborator: ${collaboratorError.message}`);
  if (!collaborator) throw new ReviewWorkspaceInputError(403, "You do not have access to this review workspace project");

  return {
    projectId: project.id as string,
    shopId: project.shop_id as string,
    status: project.status as string,
    role: collaborator.role as string,
  };
}

export async function enqueueReviewWorkspaceProcessingJob(
  input: EnqueueReviewWorkspaceJobInput,
  deps: { client?: ReviewWorkspaceDbClient } = {},
) {
  const client = resolveClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const shopId = assertUuid("shopId", input.shopId);
  const idempotencyKey = cleanText("idempotencyKey", input.idempotencyKey, 240);
  const row = {
    project_id: projectId,
    shop_id: shopId,
    kind: input.kind,
    status: "queued",
    idempotency_key: idempotencyKey,
    review_item_id: optionalUuid("reviewItemId", input.reviewItemId),
    version_id: optionalUuid("versionId", input.versionId),
    round_id: optionalUuid("roundId", input.roundId),
    created_by_profile_id: optionalUuid("actorProfileId", input.actorProfileId),
    input_jsonb: input.input ?? {},
  };

  const { data, error } = await client
    .from("bsm_content_review_processing_jobs")
    .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: false })
    .select("id, status, idempotency_key")
    .single();
  if (error) throw new Error(`Could not enqueue review workspace job: ${error.message}`);
  return data;
}

export async function requireGuestReviewSession(
  client: ReviewWorkspaceDbClient,
  sessionHash: string,
): Promise<GuestSessionAccess> {
  const hash = cleanText("sessionHash", sessionHash, 512);
  const { data, error } = await client
    .from("bsm_content_review_sessions")
    .select(`
      id,
      invitation_id,
      project_id,
      round_id,
      shop_id,
      expires_at,
      revoked_at,
      invitation:bsm_content_review_invitations!inner (
        id,
        status,
        expires_at,
        revoked_at,
        reviewer_email,
        project:bsm_content_review_projects!inner (
          id,
          deleted_at
        )
      )
    `)
    .eq("session_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`Could not load reviewer session: ${error.message}`);
  if (!data) throw new ReviewWorkspaceInputError(401, "Reviewer session is not valid");

  const now = Date.now();
  const invitation = Array.isArray(data.invitation) ? data.invitation[0] : data.invitation;
  const project = invitation?.project && (Array.isArray(invitation.project) ? invitation.project[0] : invitation.project);
  if (
    data.revoked_at ||
    new Date(data.expires_at as string).getTime() <= now ||
    !invitation ||
    invitation.revoked_at ||
    !["sent", "viewed", "submitted"].includes(invitation.status as string) ||
    new Date(invitation.expires_at as string).getTime() <= now ||
    !project ||
    project.deleted_at
  ) {
    throw new ReviewWorkspaceInputError(401, "Reviewer session has expired or was revoked");
  }

  return {
    invitationId: data.invitation_id as string,
    sessionId: data.id as string,
    projectId: data.project_id as string,
    roundId: data.round_id as string,
    shopId: data.shop_id as string,
    reviewerEmail: invitation.reviewer_email as string,
  };
}

export async function addGuestReviewPinComment(
  input: AddGuestPinCommentInput,
  deps: { client?: ReviewWorkspaceDbClient } = {},
) {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, input.sessionHash);
  const reviewItemId = assertUuid("reviewItemId", input.reviewItemId);
  const versionId = assertUuid("versionId", input.versionId);
  const body = cleanText("body", input.body, 2000);
  const xRatio = assertRatio("xRatio", input.xRatio);
  const yRatio = assertRatio("yRatio", input.yRatio);
  if (!Number.isInteger(input.pinNumber) || input.pinNumber <= 0) {
    throw new ReviewWorkspaceInputError(400, "pinNumber is required");
  }

  const threadId = randomUUID();
  const commentId = randomUUID();

  const { error: threadError } = await client.from("bsm_content_review_comment_threads").insert({
    id: threadId,
    project_id: access.projectId,
    round_id: access.roundId,
    shop_id: access.shopId,
    review_item_id: reviewItemId,
    version_id: versionId,
    owner_invitation_id: access.invitationId,
    root_comment_id: commentId,
    pin_number: input.pinNumber,
    status: "draft",
  });
  if (threadError) throw new Error(`Could not create review comment thread: ${threadError.message}`);

  const { data, error: commentError } = await client
    .from("bsm_content_review_comments")
    .insert({
      id: commentId,
      shop_id: access.shopId,
      project_id: access.projectId,
      round_id: access.roundId,
      invitation_id: access.invitationId,
      reviewer_session_id: access.sessionId,
      review_item_id: reviewItemId,
      version_id: versionId,
      thread_id: threadId,
      author_profile_id: null,
      body,
      visibility: "shop_and_psg",
      comment_kind: "pin",
      draft_status: "draft",
      pin_number: input.pinNumber,
      page_number: input.pageNumber ?? null,
      viewport: input.viewport,
      x_ratio: xRatio,
      y_ratio: yRatio,
      selection_jsonb: input.selection ?? {},
    })
    .select("id, thread_id, body, draft_status")
    .single();
  if (commentError) throw new Error(`Could not add reviewer comment: ${commentError.message}`);

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: reviewItemId,
    version_id: versionId,
    event_type: "review_workspace_pin_comment_drafted",
    actor_profile_id: null,
    payload_jsonb: {
      projectId: access.projectId,
      roundId: access.roundId,
      invitationId: access.invitationId,
      threadId,
      commentId,
      pinNumber: input.pinNumber,
    },
  });

  return data;
}

export async function createReviewWorkspaceDeletionTombstone(
  input: {
    projectId: string;
    shopId: string;
    projectTitle?: string | null;
    deletedByProfileId: string;
    deletedAt: string;
    purgedAt: string;
    reason?: string | null;
    counts?: Record<string, unknown>;
  },
  deps: { client?: ReviewWorkspaceDbClient } = {},
) {
  const client = resolveClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const shopId = assertUuid("shopId", input.shopId);
  const deletedByProfileId = assertUuid("deletedByProfileId", input.deletedByProfileId);
  const row = {
    project_id: projectId,
    shop_id: shopId,
    project_title: input.projectTitle ?? null,
    deleted_by_profile_id: deletedByProfileId,
    deleted_at: input.deletedAt,
    purged_at: input.purgedAt,
    reason: input.reason ?? null,
    counts_jsonb: input.counts ?? {},
    retention_policy: "30_day_recoverable_delete",
  };

  const { data, error } = await client
    .from("bsm_content_review_deletion_tombstones")
    .upsert(row, { onConflict: "project_id", ignoreDuplicates: false })
    .select("id, project_id")
    .single();
  if (error) throw new Error(`Could not write review workspace deletion tombstone: ${error.message}`);
  return data;
}
