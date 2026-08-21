import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BSM_CONTENT_APPROVALS_BUCKET } from "@/lib/bsm/content-approvals-shared";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PGRST_SCHEMA_CACHE_COLUMN_RE = /'([^']+)' column/;

export type ReviewWorkspaceDbClient = Pick<SupabaseClient, "from">;
type ReviewWorkspaceStorageClient = ReviewWorkspaceDbClient & {
  storage?: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

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

type ReviewWorkspaceActorRole = "psg_superadmin" | "psg_internal" | "customer" | null | string;

export type StaffReviewWorkspaceListItem = {
  id: string;
  shopId: string;
  shopName: string | null;
  title: string;
  status: string;
  currentRoundId: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  role: string;
};

export type CreateReviewWorkspaceProjectInput = {
  shopId: string;
  title: string;
  description?: string | null;
  actorProfileId: string;
  metadata?: Record<string, unknown> | null;
};

export type UpdateReviewWorkspaceProjectInput = {
  projectId: string;
  title: string;
  description?: string | null;
  actorProfileId: string;
  actorRole: ReviewWorkspaceActorRole;
};

export type ReviewWorkspaceReviewerContactInput = {
  email: string;
  name?: string | null;
};

export type StartReviewWorkspaceInput = {
  projectId: string;
  actorProfileId: string;
  actorRole?: ReviewWorkspaceActorRole;
  reviewers: ReviewWorkspaceReviewerContactInput[];
};

export type ReviewWorkspaceStartResult = {
  projectId: string;
  roundId: string;
  invitations: Array<{
    invitationId: string;
    reviewerEmail: string;
    reviewerName: string | null;
    inviteToken: string;
    inviteCode: string;
  }>;
  documentCount: number;
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
  reviewerName: string | null;
  invitationStatus: string;
  submittedAt: string | null;
};

type ReviewWorkspaceCommentKind = "pin" | "highlight" | "clarification_reply" | "psg_reply" | "system_note";

export type ReviewWorkspaceTextSelection = {
  kind: "text";
  blockId: string;
  startOffset: number;
  endOffset: number;
  text: string;
};

export type AddGuestAnnotationInput = {
  sessionHash: string;
  reviewItemId: string;
  versionId: string;
  body: string;
  pinNumber: number;
  pageNumber?: number | null;
  viewport: "desktop" | "mobile" | "pdf_page";
  anchorKind?: "pin" | "highlight";
  xRatio?: number | null;
  yRatio?: number | null;
  selection?: Record<string, unknown> | null;
};

export type AddGuestThreadReplyInput = {
  sessionHash: string;
  threadId: string;
  body: string;
};

export type AddStaffThreadReplyInput = {
  projectId: string;
  threadId: string;
  body: string;
  actorProfileId: string;
  actorRole?: ReviewWorkspaceActorRole;
};

export type AddStaffAnnotationInput = {
  projectId: string;
  reviewItemId: string;
  versionId: string;
  body: string;
  viewport: "desktop" | "pdf_page";
  xRatio: number;
  yRatio: number;
  actorProfileId: string;
  actorRole?: ReviewWorkspaceActorRole;
};

export type SetGuestThreadStatusInput = {
  sessionHash: string;
  threadId: string;
  status: "open" | "resolved";
};

export type SetStaffThreadStatusInput = {
  projectId: string;
  threadId: string;
  status: "open" | "resolved";
  actorProfileId: string;
  actorRole?: ReviewWorkspaceActorRole;
};

export type ReviewWorkspaceDocumentInput = {
  sectionTitle: string;
  title: string;
  sourceUrl?: string | null;
  body?: string | null;
  position: number;
};

export type CreateInternalReviewWorkspaceSliceInput = {
  shopId: string;
  title: string;
  description?: string | null;
  actorProfileId: string;
  reviewerEmail: string;
  reviewerName?: string | null;
  documents: ReviewWorkspaceDocumentInput[];
};

export type InternalReviewWorkspaceSlice = {
  projectId: string;
  roundId: string;
  invitationId: string;
  inviteToken: string;
  inviteCode: string;
  documents: Array<{ itemId: string; versionId: string; sectionId: string; title: string; processingStatus: string }>;
};

export type VerifyGuestInvitationInput = {
  inviteToken: string;
  code: string;
  deviceLabel?: string | null;
};

export type GuestReviewWorkspace = {
  project: { id: string; title: string; description: string | null; status: string };
  round: { id: string; status: string };
  reviewer: { email: string; submittedAt: string | null; readOnly: boolean };
  documents: Array<{
    itemId: string;
    versionId: string;
    versionNumber: number | null;
    title: string;
    note: string | null;
    processingStatus: string;
    sectionTitle: string | null;
    originalFilename: string | null;
    contentType: string | null;
    previewUrl: string | null;
    generatedPagePath: string | null;
    proofUrl: string | null;
    proofContent: ReviewWorkspaceProofContent | null;
  }>;
  comments: Array<{
    id: string;
    reviewItemId: string;
    versionId: string;
    threadId: string;
    body: string;
    commentKind: ReviewWorkspaceCommentKind;
    pinNumber: number | null;
    threadStatus: string;
    draftStatus: string;
    authorRole: "client" | "psg";
    authorDisplayName: string;
    createdAt: string | null;
    viewport: string | null;
    xRatio: number | null;
    yRatio: number | null;
    selection: ReviewWorkspaceTextSelection | null;
  }>;
  decisions: Array<{ reviewItemId: string; versionId: string; decision: string; message: string | null; submittedAt: string | null }>;
};

export type StaffReviewWorkspaceResult = {
  project: { id: string; shopId: string; title: string; status: string; currentRoundId: string | null };
  round: { id: string; status: string; outcome: string | null; completedAt: string | null } | null;
  documents: Array<{
    itemId: string;
    versionId: string | null;
    versionNumber: number | null;
    title: string;
    processingStatus: string;
    status: string;
    originalFilename: string | null;
    contentType: string | null;
    previewUrl: string | null;
    generatedPagePath: string | null;
    proofUrl: string | null;
    proofContent: ReviewWorkspaceProofContent | null;
  }>;
  reviewers: Array<{
    invitationId: string;
    email: string;
    name: string | null;
    status: string;
    submittedAt: string | null;
    revokedAt: string | null;
  }>;
  submittedComments: Array<{
    id: string;
    invitationId: string | null;
    reviewItemId: string;
    versionId: string | null;
    versionNumber: number | null;
    roundId: string | null;
    threadId: string;
    body: string;
    commentKind: ReviewWorkspaceCommentKind;
    pinNumber: number | null;
    threadStatus: string;
    draftStatus: string;
    authorRole: "client" | "psg";
    authorDisplayName: string;
    createdAt: string | null;
    viewport: string | null;
    xRatio: number | null;
    yRatio: number | null;
    selection: ReviewWorkspaceTextSelection | null;
  }>;
  decisions: Array<{ id: string; invitationId: string | null; reviewItemId: string; versionId: string | null; versionNumber: number | null; roundId: string | null; decision: string; message: string | null; actorDisplayName: string; submittedAt: string | null }>;
  activity: Array<{ id: string; eventType: string; reviewItemId: string | null; versionId: string | null; versionNumber: number | null; actorDisplayName: string; createdAt: string | null }>;
};

export type SubmitGuestReviewRoundInput = {
  sessionHash: string;
  decisions: Array<{ reviewItemId: string; versionId: string; decision: "approved" | "changes_requested"; message?: string | null }>;
};

export type ReopenGuestReviewRoundInput = {
  sessionHash: string;
};

export type CloseReviewWorkspaceRoundEarlyInput = {
  projectId: string;
  actorProfileId: string;
  actorRole?: ReviewWorkspaceActorRole;
  reason: string;
};

export type RevokeReviewWorkspaceInvitationInput = {
  projectId: string;
  invitationId: string;
  actorProfileId: string;
  actorRole?: ReviewWorkspaceActorRole;
  reason: string;
};

export type GuestReviewWorkspaceFileDownload = {
  data: Blob;
  originalFilename: string;
  contentType: string;
  byteSize: number;
};

export type ReviewWorkspaceProofContent = {
  eyebrow: string;
  headline: string;
  body: string;
  bullets: string[];
  cta: string;
  sourceUrl: string | null;
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

function missingSchemaCacheColumn(error: { code?: string | null; message?: string | null } | null): string | null {
  if (error?.code !== "PGRST204") return null;
  const match = error.message?.match(PGRST_SCHEMA_CACHE_COLUMN_RE);
  return match?.[1] ?? null;
}

function isLegacyProjectEventNullItemError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (error?.code !== "23502") return false;
  const message = error.message ?? "";
  return message.includes("review_item_id") && message.includes("bsm_content_review_events");
}

function assertRatio(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ReviewWorkspaceInputError(400, `${label} must be between 0 and 1`);
  }
  return value;
}

function cleanTextSelection(value: unknown): ReviewWorkspaceTextSelection {
  if (!value || typeof value !== "object") {
    throw new ReviewWorkspaceInputError(400, "A text highlight selection is required");
  }
  const selection = value as Record<string, unknown>;
  const blockId = cleanText("selection.blockId", selection.blockId, 120);
  const text = cleanText("selection.text", selection.text, 500);
  const startOffset = Number(selection.startOffset);
  const endOffset = Number(selection.endOffset);
  if (!Number.isInteger(startOffset) || startOffset < 0 || !Number.isInteger(endOffset) || endOffset <= startOffset || endOffset > 50_000) {
    throw new ReviewWorkspaceInputError(400, "The text highlight range is not valid");
  }
  return { kind: "text", blockId, startOffset, endOffset, text };
}

function readTextSelection(value: unknown): ReviewWorkspaceTextSelection | null {
  try {
    return cleanTextSelection(value);
  } catch {
    return null;
  }
}

function readCommentKind(value: unknown): ReviewWorkspaceCommentKind {
  return value === "highlight" || value === "clarification_reply" || value === "psg_reply" || value === "system_note"
    ? value
    : "pin";
}

function cleanThreadStatus(value: unknown): "open" | "resolved" {
  if (value !== "open" && value !== "resolved") {
    throw new ReviewWorkspaceInputError(400, "Thread status must be open or resolved");
  }
  return value;
}

async function loadProfileNames(client: ReviewWorkspaceDbClient, profileIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(profileIds));
  if (!ids.length) return new Map();
  const { data, error } = await client.from("profiles").select("id, display_name").in("id", ids);
  if (error) throw new Error(`Could not load review comment authors: ${error.message}`);
  return new Map(((data ?? []) as Array<Record<string, unknown>>).map((row) => [
    row.id as string,
    typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : "PSG team",
  ]));
}

function resolveClient(client?: ReviewWorkspaceDbClient): ReviewWorkspaceDbClient {
  return client ?? createServiceClient();
}

function isSuperadminRole(role: ReviewWorkspaceActorRole): boolean {
  return role === "psg_superadmin";
}

export function bsmReviewWorkspaceInternalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !["0", "false"].includes(env.BSM_REVIEW_WORKSPACE_INTERNAL_ENABLED?.trim().toLowerCase() ?? "");
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function verifySecretHash(value: string, hash: string): boolean {
  const left = Buffer.from(hashSecret(value), "hex");
  const right = Buffer.from(hash, "hex");
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function makeInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

function makeInviteCode(): string {
  return `${randomBytes(3).readUIntBE(0, 3) % 1000000}`.padStart(6, "0");
}

function cleanEmail(value: unknown): string {
  const email = cleanText("reviewerEmail", value, 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ReviewWorkspaceInputError(400, "reviewerEmail must be a valid email address");
  }
  return email;
}

function buildInternalProofContent(input: {
  sectionTitle: string;
  title: string;
  description: string | null;
  sourceUrl: string | null;
  body: string | null;
}): ReviewWorkspaceProofContent {
  return {
    eyebrow: input.sectionTitle,
    headline: input.title,
    body: input.body ?? input.description ?? "Review this customer-facing content proof before it is released.",
    bullets: [
      "Clear offer and next step for the shop's customer.",
      "Plain-language copy suitable for customer review.",
      "Demo-safe proof content stored inside this review workspace.",
    ],
    cta: "Schedule my repair review",
    sourceUrl: input.sourceUrl,
  };
}

function readProofContent(value: unknown): ReviewWorkspaceProofContent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const headline = typeof record.headline === "string" ? record.headline.trim() : "";
  const body = typeof record.body === "string" ? record.body.trim() : "";
  if (!headline || !body) return null;
  return {
    eyebrow: typeof record.eyebrow === "string" && record.eyebrow.trim() ? record.eyebrow : "Review document",
    headline,
    body,
    bullets: Array.isArray(record.bullets)
      ? record.bullets.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [],
    cta: typeof record.cta === "string" && record.cta.trim() ? record.cta : "Review requested changes",
    sourceUrl: typeof record.sourceUrl === "string" && record.sourceUrl.trim() ? record.sourceUrl : null,
  };
}

function proofContentFromMetadata(metadata: Record<string, unknown> | null | undefined): ReviewWorkspaceProofContent | null {
  return readProofContent(metadata?.proofContent);
}

function fileProofTarget(version: Record<string, unknown> | null | undefined): { bucket: string; path: string } | null {
  const processedPath = typeof version?.processed_storage_path === "string" && version.processed_storage_path.trim()
    ? version.processed_storage_path
    : null;
  const processedBucket = typeof version?.processed_storage_bucket === "string" && version.processed_storage_bucket.trim()
    ? version.processed_storage_bucket
    : null;
  if (processedPath && processedBucket) return { bucket: processedBucket, path: processedPath };

  if (version?.project_id) return null;

  const path = typeof version?.storage_path === "string" && version.storage_path.trim()
    ? version.storage_path
    : null;
  const bucket = typeof version?.storage_bucket === "string" && version.storage_bucket.trim()
    ? version.storage_bucket
    : null;
  return path && bucket ? { bucket, path } : null;
}

function reviewerDocumentContentType(version: Record<string, unknown> | null | undefined): string | null {
  const hasProcessedProof = typeof version?.processed_storage_path === "string" && version.processed_storage_path.trim();
  if (version?.project_id && !hasProcessedProof) return null;
  return (
    (hasProcessedProof ? (version?.processed_content_type as string | null) : null) ??
    (version?.content_type as string | null) ??
    null
  );
}

async function createSignedProofUrl(
  client: ReviewWorkspaceDbClient,
  version: Record<string, unknown> | null | undefined,
): Promise<string | null> {
  const target = fileProofTarget(version);
  const storage = (client as ReviewWorkspaceStorageClient).storage;
  if (!target || !storage) return null;

  const { data, error } = await storage.from(target.bucket).createSignedUrl(target.path, 60 * 20);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function insertEvent(
  client: ReviewWorkspaceDbClient,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from("bsm_content_review_events").insert(payload);
  if (payload.review_item_id == null && isLegacyProjectEventNullItemError(error)) {
    return;
  }
  if (error) throw new Error(`Could not record review workspace event: ${error.message}`);
}

async function insertWithSchemaCacheFallback(
  client: ReviewWorkspaceDbClient,
  table: string,
  payload: Record<string, unknown>,
  fallbackColumns: ReadonlySet<string>,
  errorPrefix: string,
): Promise<void> {
  const attemptedColumns = new Set<string>();
  let nextPayload = { ...payload };

  while (true) {
    const { error } = await client.from(table).insert(nextPayload);
    if (!error) return;

    const missingColumn = missingSchemaCacheColumn(error);
    if (
      !missingColumn ||
      !fallbackColumns.has(missingColumn) ||
      attemptedColumns.has(missingColumn) ||
      !(missingColumn in nextPayload)
    ) {
      throw new Error(`${errorPrefix}: ${error.message}`);
    }

    attemptedColumns.add(missingColumn);
    const retryPayload = { ...nextPayload };
    delete retryPayload[missingColumn];
    nextPayload = retryPayload;
  }
}

export async function createReviewWorkspaceProject(
  input: CreateReviewWorkspaceProjectInput,
  deps: { client?: ReviewWorkspaceDbClient; skipProjectCreatedEvent?: boolean } = {},
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

  if (!deps.skipProjectCreatedEvent) {
    await insertEvent(client, {
      shop_id: shopId,
      review_item_id: null,
      event_type: "review_workspace_project_created",
      actor_profile_id: actorProfileId,
      payload_jsonb: { projectId, title },
    });
  }

  return { id: projectId, shopId, title, status: "draft", ownerProfileId: actorProfileId };
}

export async function updateReviewWorkspaceProject(
  input: UpdateReviewWorkspaceProjectInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
): Promise<ReviewWorkspaceProject> {
  if (!isSuperadminRole(input.actorRole)) {
    throw new ReviewWorkspaceInputError(403, "Only a superadmin can edit review workspaces");
  }

  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const title = cleanText("title", input.title, 180);
  const description = cleanOptionalText("description", input.description, 4000);
  const client = resolveClient(deps.client);
  const now = (deps.now ?? new Date()).toISOString();
  const access = await requireReviewWorkspaceStaffAccess(client, input.projectId, actorProfileId, input.actorRole);

  const { data: projectRow, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, status, owner_profile_id")
    .eq("id", access.projectId)
    .single();
  if (projectError || !projectRow) {
    throw new Error(`Could not load review workspace project: ${projectError?.message ?? "not found"}`);
  }

  const project = projectRow as Record<string, unknown>;
  const { error: updateError } = await client
    .from("bsm_content_review_projects")
    .update({
      title,
      description,
      updated_at: now,
    })
    .eq("id", access.projectId);
  if (updateError) throw new Error(`Could not update review workspace project: ${updateError.message}`);

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: null,
    event_type: "review_workspace_project_updated",
    actor_profile_id: actorProfileId,
    payload_jsonb: { projectId: access.projectId, title },
  });

  return {
    id: access.projectId,
    shopId: access.shopId,
    title,
    status: (project.status as string | null) ?? access.status,
    ownerProfileId: (project.owner_profile_id as string | null) ?? actorProfileId,
  };
}

export async function startReviewWorkspaceRound(
  input: StartReviewWorkspaceInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
): Promise<ReviewWorkspaceStartResult> {
  const projectId = assertUuid("projectId", input.projectId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  if (!Array.isArray(input.reviewers) || input.reviewers.length === 0) {
    throw new ReviewWorkspaceInputError(400, "At least one reviewer is required");
  }
  if (input.reviewers.length > 20) {
    throw new ReviewWorkspaceInputError(400, "A review can include up to 20 reviewers");
  }

  const reviewers = input.reviewers.map((reviewer) => ({
    email: cleanEmail(reviewer.email),
    name: cleanOptionalText("reviewerName", reviewer.name, 160),
  }));
  const dedupedReviewers = reviewers.filter(
    (reviewer, index, rows) => rows.findIndex((candidate) => candidate.email === reviewer.email) === index,
  );

  const client = resolveClient(deps.client);
  const now = deps.now ?? new Date();
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  if (["archived", "deleting", "deleted"].includes(access.status)) {
    throw new ReviewWorkspaceInputError(400, "This Review Workspace is not available for a new round");
  }

  const { data: projectRow, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, current_round_id")
    .eq("id", access.projectId)
    .single();
  if (projectError || !projectRow) {
    throw new Error(`Could not load review workspace project: ${projectError?.message ?? "not found"}`);
  }
  const currentRoundId = ((projectRow as Record<string, unknown>).current_round_id as string | null) ?? null;
  let roundNumber = 1;
  const priorVersionByItem = new Map<string, string>();
  if (currentRoundId) {
    const [{ data: currentRound, error: currentRoundError }, { data: priorDocuments, error: priorDocumentsError }] = await Promise.all([
      client.from("bsm_content_review_rounds").select("id, status, round_number").eq("id", currentRoundId).single(),
      client
        .from("bsm_content_review_round_documents")
        .select("review_item_id, version_id")
        .eq("round_id", currentRoundId)
        .eq("project_id", access.projectId)
        .eq("shop_id", access.shopId),
    ]);
    if (currentRoundError || !currentRound) {
      throw new Error(`Could not load the current review round: ${currentRoundError?.message ?? "not found"}`);
    }
    if (["active", "inviting"].includes(currentRound.status as string)) {
      throw new ReviewWorkspaceInputError(400, "This Review Workspace already has an active review round");
    }
    if (priorDocumentsError) throw new Error(`Could not load the prior review documents: ${priorDocumentsError.message}`);
    roundNumber = Number(currentRound.round_number ?? 1) + 1;
    for (const row of (priorDocuments ?? []) as Array<Record<string, unknown>>) {
      priorVersionByItem.set(row.review_item_id as string, row.version_id as string);
    }
  }

  const { data: itemRows, error: itemError } = await client
    .from("bsm_content_review_items")
    .select("id, current_version_id, processing_status, title")
    .eq("project_id", access.projectId)
    .is("deleted_at", null)
    .order("position", { ascending: true });
  if (itemError) throw new Error(`Could not load Review Workspace documents: ${itemError.message}`);

  const documents = ((itemRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
    itemId: row.id as string,
    versionId: (row.current_version_id as string | null) ?? null,
    processingStatus: (row.processing_status as string | null) ?? "pending",
    title: row.title as string,
  }));
  if (documents.length === 0) {
    throw new ReviewWorkspaceInputError(400, "Add at least one document before starting review");
  }
  const notReady = documents.find((document) => document.processingStatus !== "ready" || !document.versionId);
  if (notReady) {
    throw new ReviewWorkspaceInputError(
      400,
      `Document "${notReady.title}" must finish processing successfully before review can start`,
    );
  }

  const reviewDocuments = currentRoundId
    ? documents.filter((document) => priorVersionByItem.get(document.itemId) !== document.versionId)
    : documents;
  if (reviewDocuments.length === 0) {
    throw new ReviewWorkspaceInputError(400, "Upload or generate a revised document before starting another review round");
  }

  const roundId = randomUUID();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const reminderDueAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: roundError } = await client.from("bsm_content_review_rounds").insert({
    id: roundId,
    project_id: access.projectId,
    shop_id: access.shopId,
    round_number: roundNumber,
    status: "active",
    started_by_profile_id: actorProfileId,
    started_at: now.toISOString(),
  });
  if (roundError) throw new Error(`Could not start review round: ${roundError.message}`);

  for (const document of reviewDocuments) {
    const { error } = await client.from("bsm_content_review_round_documents").insert({
      round_id: roundId,
      project_id: access.projectId,
      shop_id: access.shopId,
      review_item_id: document.itemId,
      version_id: document.versionId,
      decision_required: true,
    });
    if (error) throw new Error(`Could not add document to review round: ${error.message}`);
  }

  const invitations: ReviewWorkspaceStartResult["invitations"] = [];
  for (const reviewer of dedupedReviewers) {
    const invitationId = randomUUID();
    const inviteToken = makeInviteToken();
    const inviteCode = makeInviteCode();
    const { error: inviteError } = await client.from("bsm_content_review_invitations").insert({
      id: invitationId,
      project_id: access.projectId,
      round_id: roundId,
      shop_id: access.shopId,
      reviewer_email: reviewer.email,
      reviewer_name: reviewer.name,
      status: "sent",
      token_hash: hashSecret(inviteToken),
      code_hash: hashSecret(inviteCode),
      last_code_sent_at: null,
      expires_at: expiresAt,
      reminder_due_at: reminderDueAt,
      created_by_profile_id: actorProfileId,
    });
    if (inviteError) throw new Error(`Could not create review invitation: ${inviteError.message}`);

    for (const document of reviewDocuments) {
      await insertWithSchemaCacheFallback(client, "bsm_content_review_reviewers", {
        review_item_id: document.itemId,
        shop_id: access.shopId,
        invitation_id: invitationId,
        round_id: roundId,
        reviewer_email: reviewer.email,
        reviewer_name: reviewer.name,
        reviewer_role: "reviewer",
        notification_preference: "email",
        submission_status: "not_started",
      }, new Set(["invitation_id", "round_id", "reviewer_email", "reviewer_name", "submission_status"]), "Could not add review workspace reviewer");
    }

    invitations.push({
      invitationId,
      reviewerEmail: reviewer.email,
      reviewerName: reviewer.name,
      inviteToken,
      inviteCode,
    });
  }

  const { error: itemUpdateError } = await client
    .from("bsm_content_review_items")
    .update({ status: "in_review", updated_at: now.toISOString() })
    .in("id", reviewDocuments.map((document) => document.itemId));
  if (itemUpdateError) throw new Error(`Could not mark documents in review: ${itemUpdateError.message}`);

  const { error: projectUpdateError } = await client
    .from("bsm_content_review_projects")
    .update({ status: "active", current_round_id: roundId, updated_at: now.toISOString() })
    .eq("id", access.projectId);
  if (projectUpdateError) throw new Error(`Could not activate review workspace project: ${projectUpdateError.message}`);

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: documents[0]?.itemId ?? null,
    version_id: documents[0]?.versionId ?? null,
    event_type: "review_workspace_round_started",
    actor_profile_id: actorProfileId,
    payload_jsonb: {
      projectId: access.projectId,
      roundId,
      invitationCount: invitations.length,
      documentCount: reviewDocuments.length,
      roundNumber,
    },
  });

  return { projectId: access.projectId, roundId, invitations, documentCount: reviewDocuments.length };
}

export async function requireReviewWorkspaceStaffAccess(
  client: ReviewWorkspaceDbClient,
  projectId: string,
  actorProfileId: string,
  actorRole: ReviewWorkspaceActorRole = null,
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

  if (isSuperadminRole(actorRole)) {
    return {
      projectId: project.id as string,
      shopId: project.shop_id as string,
      status: project.status as string,
      role: "superadmin",
    };
  }

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

function readProjectListRow(row: Record<string, unknown>, role: string): StaffReviewWorkspaceListItem {
  const company = row.company;
  const companyRow = company && typeof company === "object"
    ? Array.isArray(company) ? company[0] : company
    : null;
  return {
    id: row.id as string,
    shopId: row.shop_id as string,
    shopName: typeof (companyRow as Record<string, unknown> | null)?.name === "string"
      ? (companyRow as Record<string, unknown>).name as string
      : null,
    title: row.title as string,
    status: row.status as string,
    currentRoundId: (row.current_round_id as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
    role,
  };
}

export async function listStaffReviewWorkspaces(
  actorProfileId: string,
  actorRole: ReviewWorkspaceActorRole,
  deps: { client?: ReviewWorkspaceDbClient; limit?: number } = {},
): Promise<StaffReviewWorkspaceListItem[]> {
  const client = resolveClient(deps.client);
  const cleanActorProfileId = assertUuid("actorProfileId", actorProfileId);
  const limit = Math.min(Math.max(Math.trunc(deps.limit ?? 100), 1), 250);
  const projectSelect = "id, shop_id, title, status, current_round_id, updated_at, created_at";

  if (isSuperadminRole(actorRole)) {
    const { data, error } = await client
      .from("bsm_content_review_projects")
      .select(projectSelect)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not list review workspaces: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => readProjectListRow(row, "superadmin"));
  }

  const { data, error } = await client
    .from("bsm_content_review_project_collaborators")
    .select(`role, project:bsm_content_review_projects!inner(${projectSelect}, deleted_at)`)
    .eq("profile_id", cleanActorProfileId)
    .is("removed_at", null)
    .is("project.deleted_at", null)
    .order("added_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not list review workspaces: ${error.message}`);

  return ((data ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const rawProject = row.project;
    const project = rawProject && typeof rawProject === "object"
      ? Array.isArray(rawProject) ? rawProject[0] : rawProject
      : null;
    return project ? [readProjectListRow(project as Record<string, unknown>, row.role as string)] : [];
  });
}

export async function getStaffReviewWorkspaceResult(
  projectId: string,
  actorProfileId: string,
  deps: { client?: ReviewWorkspaceDbClient; actorRole?: ReviewWorkspaceActorRole } = {},
): Promise<StaffReviewWorkspaceResult> {
  const client = resolveClient(deps.client);
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, deps.actorRole);

  const { data: projectRow, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, title, status, current_round_id")
    .eq("id", access.projectId)
    .single();
  if (projectError || !projectRow) throw new Error(`Could not load review workspace project: ${projectError?.message ?? "not found"}`);
  const project = projectRow as Record<string, unknown>;
  const roundId = (project.current_round_id as string | null) ?? null;

  const [{ data: roundRows, error: roundError }, { data: roundDocumentRows, error: roundDocumentError }, { data: itemRows, error: itemError }, { data: invitationRows, error: invitationError }, { data: commentRows, error: commentError }, { data: threadRows, error: threadError }, { data: decisionRows, error: decisionError }, { data: eventRows, error: eventError }] = await Promise.all([
    roundId
      ? client
          .from("bsm_content_review_rounds")
          .select("id, status, outcome, completed_at")
          .eq("id", roundId)
      : Promise.resolve({ data: [], error: null }),
    roundId
      ? client
          .from("bsm_content_review_round_documents")
          .select("review_item_id, version_id")
          .eq("round_id", roundId)
          .eq("project_id", access.projectId)
          .eq("shop_id", access.shopId)
      : Promise.resolve({ data: [], error: null }),
    client
      .from("bsm_content_review_items")
      .select(`
        id,
        current_version_id,
        title,
        processing_status,
        status
      `)
      .eq("project_id", access.projectId)
      .is("deleted_at", null)
      .order("position", { ascending: true }),
    client
      .from("bsm_content_review_invitations")
      .select("id, reviewer_email, reviewer_name, status, submitted_at, revoked_at")
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId)
      .order("created_at", { ascending: true }),
    client
      .from("bsm_content_review_comments")
      .select("id, invitation_id, review_item_id, version_id, round_id, thread_id, author_profile_id, body, comment_kind, pin_number, draft_status, viewport, x_ratio, y_ratio, selection_jsonb, created_at")
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId)
      .order("created_at", { ascending: true }),
    client
      .from("bsm_content_review_comment_threads")
      .select("id, status, pin_number")
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId),
    client
      .from("bsm_content_review_decisions")
      .select("id, invitation_id, review_item_id, version_id, round_id, decision, message, submitted_at")
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId)
      .order("submitted_at", { ascending: false }),
    client
      .from("bsm_content_review_events")
      .select("id, review_item_id, version_id, event_type, actor_profile_id, payload_jsonb, created_at")
      .eq("shop_id", access.shopId)
      .contains("payload_jsonb", { projectId: access.projectId })
      .order("created_at", { ascending: false }),
  ]);
  if (roundError) throw new Error(`Could not load review workspace round: ${roundError.message}`);
  if (roundDocumentError) throw new Error(`Could not load review workspace round documents: ${roundDocumentError.message}`);
  if (itemError) throw new Error(`Could not load Review Workspace documents: ${itemError.message}`);
  if (invitationError) throw new Error(`Could not load review workspace invitations: ${invitationError.message}`);
  if (commentError) throw new Error(`Could not load review workspace comments: ${commentError.message}`);
  if (threadError) throw new Error(`Could not load review workspace comment threads: ${threadError.message}`);
  if (decisionError) throw new Error(`Could not load review workspace decisions: ${decisionError.message}`);
  if (eventError) throw new Error(`Could not load review workspace activity: ${eventError.message}`);

  const itemRecords = (itemRows ?? []) as Array<Record<string, unknown>>;
  const comments = (commentRows ?? []) as Array<Record<string, unknown>>;
  const decisionRecords = (decisionRows ?? []) as Array<Record<string, unknown>>;
  const events = (eventRows ?? []) as Array<Record<string, unknown>>;
  const roundVersionByItem = new Map(((roundDocumentRows ?? []) as Array<Record<string, unknown>>).map(
    (row) => [row.review_item_id as string, row.version_id as string],
  ));
  const versionIds = Array.from(new Set([
    ...itemRecords.map((row) => roundVersionByItem.get(row.id as string) ?? row.current_version_id),
    ...comments.map((row) => row.version_id),
    ...decisionRecords.map((row) => row.version_id),
    ...events.map((row) => row.version_id),
  ].filter((value): value is string => typeof value === "string" && value.length > 0)));
  const { data: versionRows, error: versionError } = versionIds.length
    ? await client
        .from("bsm_content_review_versions")
        .select("id, project_id, version_number, original_filename, content_type, preview_url, generated_page_path, storage_bucket, storage_path, processed_storage_bucket, processed_storage_path, processed_content_type, source_metadata_jsonb, snapshot_jsonb")
        .in("id", versionIds)
    : { data: [], error: null };
  if (versionError) throw new Error(`Could not load Review Workspace document versions: ${versionError.message}`);
  const versionsById = new Map(
    ((versionRows ?? []) as Array<Record<string, unknown>>).map((version) => [version.id as string, version]),
  );
  const round = ((roundRows ?? []) as Array<Record<string, unknown>>)[0] ?? null;
  const profileNames = await loadProfileNames(client, [
    ...comments.flatMap((row) => typeof row.author_profile_id === "string" ? [row.author_profile_id] : []),
    ...events.flatMap((row) => typeof row.actor_profile_id === "string" ? [row.actor_profile_id] : []),
  ]);
  const threadsById = new Map(((threadRows ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row]));
  const reviewersByInvitation = new Map(((invitationRows ?? []) as Array<Record<string, unknown>>).map((row) => [
    row.id as string,
    typeof row.reviewer_name === "string" && row.reviewer_name.trim() ? row.reviewer_name : row.reviewer_email as string,
  ]));

  return {
    project: {
      id: project.id as string,
      shopId: project.shop_id as string,
      title: project.title as string,
      status: project.status as string,
      currentRoundId: roundId,
    },
    round: round
      ? {
          id: round.id as string,
          status: round.status as string,
          outcome: (round.outcome as string | null) ?? null,
          completedAt: (round.completed_at as string | null) ?? null,
        }
      : null,
    documents: await Promise.all(itemRecords.map(async (row) => {
      const versionId = roundVersionByItem.get(row.id as string) ?? (row.current_version_id as string | null) ?? null;
      const version = versionId ? versionsById.get(versionId) : undefined;
      const sourceMetadata = (version?.source_metadata_jsonb as Record<string, unknown> | null) ?? {};
      const snapshot = (version?.snapshot_jsonb as Record<string, unknown> | null) ?? {};
      const previewUrl = typeof sourceMetadata.previewUrl === "string" && sourceMetadata.previewUrl.trim()
        ? sourceMetadata.previewUrl
        : typeof version?.preview_url === "string" && version.preview_url.trim()
          ? version.preview_url
          : null;
      const generatedPagePath = typeof sourceMetadata.generatedPagePath === "string" && sourceMetadata.generatedPagePath.trim()
        ? sourceMetadata.generatedPagePath
        : typeof version?.generated_page_path === "string" && version.generated_page_path.trim()
          ? version.generated_page_path
          : null;
      const contentType = reviewerDocumentContentType(version ?? null);
      const privateProofUrl = contentType === "text/html" && fileProofTarget(version) && versionId
        ? `/api/ops/bsm/review-workspace/file?projectId=${encodeURIComponent(access.projectId)}&reviewItemId=${encodeURIComponent(row.id as string)}&versionId=${encodeURIComponent(versionId)}`
        : null;
      const signedProofUrl = privateProofUrl ? null : await createSignedProofUrl(client, version);
      return {
        itemId: row.id as string,
        versionId,
        versionNumber: typeof version?.version_number === "number" ? version.version_number : null,
        title: row.title as string,
        processingStatus: row.processing_status as string,
        status: row.status as string,
        originalFilename: (version?.original_filename as string | null) ?? null,
        contentType,
        previewUrl,
        generatedPagePath,
        proofUrl: previewUrl ?? generatedPagePath ?? privateProofUrl ?? signedProofUrl,
        proofContent: proofContentFromMetadata(sourceMetadata) ?? proofContentFromMetadata(snapshot),
      };
    })),
    reviewers: ((invitationRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      invitationId: row.id as string,
      email: row.reviewer_email as string,
      name: (row.reviewer_name as string | null) ?? null,
      status: row.status as string,
      submittedAt: (row.submitted_at as string | null) ?? null,
      revokedAt: (row.revoked_at as string | null) ?? null,
    })),
    submittedComments: comments.flatMap((row) => {
      const threadId = typeof row.thread_id === "string" ? row.thread_id : null;
      if (!threadId) return [];
      const thread = threadsById.get(threadId);
      const authorProfileId = typeof row.author_profile_id === "string" ? row.author_profile_id : null;
      const invitationId = (row.invitation_id as string | null) ?? null;
      const authorRole = row.comment_kind === "psg_reply" || authorProfileId ? "psg" as const : "client" as const;
      return [{
      id: row.id as string,
      invitationId,
      reviewItemId: row.review_item_id as string,
      versionId: (row.version_id as string | null) ?? null,
      versionNumber: typeof versionsById.get(row.version_id as string)?.version_number === "number"
        ? versionsById.get(row.version_id as string)?.version_number as number
        : null,
      roundId: (row.round_id as string | null) ?? null,
      threadId,
      body: row.body as string,
      commentKind: readCommentKind(row.comment_kind),
      pinNumber: (row.pin_number as number | null) ?? (thread?.pin_number as number | null) ?? null,
      threadStatus: (thread?.status as string | null) ?? "open",
      draftStatus: row.draft_status as string,
      authorRole,
      authorDisplayName: authorRole === "psg"
        ? (authorProfileId ? profileNames.get(authorProfileId) : null) ?? "PSG team"
        : (invitationId ? reviewersByInvitation.get(invitationId) : null) ?? "Client reviewer",
      createdAt: (row.created_at as string | null) ?? null,
      viewport: (row.viewport as string | null) ?? null,
      xRatio: row.x_ratio == null ? null : Number(row.x_ratio),
      yRatio: row.y_ratio == null ? null : Number(row.y_ratio),
      selection: readTextSelection(row.selection_jsonb),
      }];
    }),
    decisions: decisionRecords.map((row) => ({
      id: row.id as string,
      invitationId: (row.invitation_id as string | null) ?? null,
      reviewItemId: row.review_item_id as string,
      versionId: (row.version_id as string | null) ?? null,
      versionNumber: typeof versionsById.get(row.version_id as string)?.version_number === "number"
        ? versionsById.get(row.version_id as string)?.version_number as number
        : null,
      roundId: (row.round_id as string | null) ?? null,
      decision: row.decision as string,
      message: (row.message as string | null) ?? null,
      actorDisplayName: reviewersByInvitation.get(row.invitation_id as string) ?? "Client reviewer",
      submittedAt: (row.submitted_at as string | null) ?? null,
    })),
    activity: events.map((row) => {
      const payload = row.payload_jsonb && typeof row.payload_jsonb === "object" ? row.payload_jsonb as Record<string, unknown> : {};
      const actorProfileId = typeof row.actor_profile_id === "string" ? row.actor_profile_id : null;
      const invitationId = typeof payload.invitationId === "string" ? payload.invitationId : null;
      return {
        id: row.id as string,
        eventType: row.event_type as string,
        reviewItemId: (row.review_item_id as string | null) ?? null,
        versionId: (row.version_id as string | null) ?? null,
        versionNumber: typeof versionsById.get(row.version_id as string)?.version_number === "number"
          ? versionsById.get(row.version_id as string)?.version_number as number
          : null,
        actorDisplayName: actorProfileId
          ? profileNames.get(actorProfileId) ?? "PSG team"
          : (invitationId ? reviewersByInvitation.get(invitationId) : null) ?? "Client reviewer",
        createdAt: (row.created_at as string | null) ?? null,
      };
    }),
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

export async function createInternalReviewWorkspaceSlice(
  input: CreateInternalReviewWorkspaceSliceInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
): Promise<InternalReviewWorkspaceSlice> {
  const shopId = assertUuid("shopId", input.shopId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const reviewerEmail = cleanEmail(input.reviewerEmail);
  const reviewerName = cleanOptionalText("reviewerName", input.reviewerName, 160);
  const description = cleanOptionalText("description", input.description, 4000);
  if (!Array.isArray(input.documents) || input.documents.length === 0) {
    throw new ReviewWorkspaceInputError(400, "At least one document is required");
  }
  if (input.documents.length > 20) {
    throw new ReviewWorkspaceInputError(400, "This internal slice supports up to 20 documents");
  }

  const client = resolveClient(deps.client);
  const now = deps.now ?? new Date();
  const project = await createReviewWorkspaceProject(
    {
      shopId,
      title: input.title,
      description,
      actorProfileId,
      metadata: { featureGate: "bsm_review_workspace_internal" },
    },
    { client, skipProjectCreatedEvent: true },
  );

  const sectionsByTitle = new Map<string, { id: string; title: string; position: number }>();
  const documents: InternalReviewWorkspaceSlice["documents"] = [];
  let sectionPosition = 1;

  for (const documentInput of input.documents) {
    const sectionTitle = cleanText("sectionTitle", documentInput.sectionTitle, 140);
    const docTitle = cleanText("document title", documentInput.title, 180);
    if (!Number.isInteger(documentInput.position) || documentInput.position <= 0) {
      throw new ReviewWorkspaceInputError(400, "document position is required");
    }
    let section = sectionsByTitle.get(sectionTitle);
    if (!section) {
      section = { id: randomUUID(), title: sectionTitle, position: sectionPosition++ };
      sectionsByTitle.set(sectionTitle, section);
      const { error } = await client.from("bsm_content_review_sections").insert({
        id: section.id,
        project_id: project.id,
        shop_id: shopId,
        title: section.title,
        position: section.position,
      });
      if (error) throw new Error(`Could not create review workspace section: ${error.message}`);
    }

    const itemId = randomUUID();
    const versionId = randomUUID();
    const sourceUrl = cleanOptionalText("sourceUrl", documentInput.sourceUrl, 1200);
    const body = cleanOptionalText("document body", documentInput.body, 4000);
    const generatedPagePath = sourceUrl ?? `internal-review-workspace://${project.id}/${itemId}`;
    const proofContent = buildInternalProofContent({
      sectionTitle,
      title: docTitle,
      description,
      sourceUrl,
      body,
    });
    const sourceMetadata = {
      sourceKind: "internal_review_workspace",
      sourceUrl,
      generatedPagePath,
      previewUrl: sourceUrl,
      proofContent,
    };
    const itemPayload = {
      id: itemId,
      shop_id: shopId,
      project_id: project.id,
      section_id: section.id,
      position: documentInput.position,
      required: true,
      title: docTitle,
      source_kind: "generated_page",
      content_type: "generated_page",
      status: "in_review",
      admin_context_note: description,
      processing_status: "ready",
      created_by_profile_id: actorProfileId,
      metadata_jsonb: { sourceKind: "internal_review_workspace", sourceUrl },
    };
    await insertWithSchemaCacheFallback(
      client,
      "bsm_content_review_items",
      itemPayload,
      new Set(["source_kind", "project_id", "section_id", "position", "required", "processing_status", "deleted_at"]),
      "Could not create review workspace document",
    );

    await insertWithSchemaCacheFallback(client, "bsm_content_review_versions", {
      id: versionId,
      review_item_id: itemId,
      shop_id: shopId,
      project_id: project.id,
      version_number: 1,
      status: "current",
      storage_bucket: null,
      storage_path: null,
      original_filename: null,
      content_type: "text/html",
      byte_size: 1,
      preview_type: "generated_page",
      generated_page_path: generatedPagePath,
      processed_content_type: "text/html",
      scan_status: "clean",
      conversion_status: "not_needed",
      sanitization_status: "complete",
      source_metadata_jsonb: sourceMetadata,
      snapshot_jsonb: sourceMetadata,
      created_by_profile_id: actorProfileId,
    }, new Set([
      "project_id",
      "round_id",
      "status",
      "storage_path",
      "original_filename",
      "content_type",
      "preview_type",
      "processed_content_type",
      "scan_status",
      "conversion_status",
      "sanitization_status",
      "source_metadata_jsonb",
    ]), "Could not create review workspace version");

    const { error: updateError } = await client
      .from("bsm_content_review_items")
      .update({ current_version_id: versionId, updated_at: now.toISOString() })
      .eq("id", itemId);
    if (updateError) throw new Error(`Could not link review workspace version: ${updateError.message}`);

    documents.push({ itemId, versionId, sectionId: section.id, title: docTitle, processingStatus: "ready" });
  }

  await insertEvent(client, {
    shop_id: shopId,
    review_item_id: documents[0]?.itemId ?? null,
    version_id: documents[0]?.versionId ?? null,
    event_type: "review_workspace_project_created",
    actor_profile_id: actorProfileId,
    payload_jsonb: { projectId: project.id, title: project.title, documentCount: documents.length },
  });

  const roundId = randomUUID();
  const invitationId = randomUUID();
  const inviteToken = makeInviteToken();
  const inviteCode = makeInviteCode();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const { error: roundError } = await client.from("bsm_content_review_rounds").insert({
    id: roundId,
    project_id: project.id,
    shop_id: shopId,
    round_number: 1,
    status: "active",
    started_by_profile_id: actorProfileId,
    started_at: now.toISOString(),
  });
  if (roundError) throw new Error(`Could not start review round: ${roundError.message}`);

  for (const doc of documents) {
    const { error } = await client.from("bsm_content_review_round_documents").insert({
      round_id: roundId,
      project_id: project.id,
      shop_id: shopId,
      review_item_id: doc.itemId,
      version_id: doc.versionId,
      decision_required: true,
    });
    if (error) throw new Error(`Could not add document to review round: ${error.message}`);
  }

  const { error: inviteError } = await client.from("bsm_content_review_invitations").insert({
    id: invitationId,
    project_id: project.id,
    round_id: roundId,
    shop_id: shopId,
    reviewer_email: reviewerEmail,
    reviewer_name: reviewerName,
    status: "sent",
    token_hash: hashSecret(inviteToken),
    code_hash: hashSecret(inviteCode),
    last_code_sent_at: now.toISOString(),
    expires_at: expiresAt,
    reminder_due_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    created_by_profile_id: actorProfileId,
  });
  if (inviteError) throw new Error(`Could not create review invitation: ${inviteError.message}`);

  for (const doc of documents) {
    await insertWithSchemaCacheFallback(client, "bsm_content_review_reviewers", {
      review_item_id: doc.itemId,
      shop_id: shopId,
      invitation_id: invitationId,
      round_id: roundId,
      reviewer_email: reviewerEmail,
      reviewer_name: reviewerName,
      reviewer_role: "reviewer",
      notification_preference: "email",
      submission_status: "not_started",
    }, new Set(["invitation_id", "round_id", "reviewer_email", "reviewer_name", "submission_status"]), "Could not add review workspace reviewer");
  }

  const { error: projectUpdateError } = await client
    .from("bsm_content_review_projects")
    .update({ status: "active", current_round_id: roundId, updated_at: now.toISOString() })
    .eq("id", project.id);
  if (projectUpdateError) throw new Error(`Could not activate review workspace project: ${projectUpdateError.message}`);

  await insertEvent(client, {
    shop_id: shopId,
    review_item_id: documents[0]?.itemId ?? null,
    version_id: documents[0]?.versionId ?? null,
    event_type: "review_workspace_round_started",
    actor_profile_id: actorProfileId,
    payload_jsonb: { projectId: project.id, roundId, invitationId, documentCount: documents.length },
  });

  return { projectId: project.id, roundId, invitationId, inviteToken, inviteCode, documents };
}

export async function verifyGuestReviewInvitation(
  input: VerifyGuestInvitationInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const inviteToken = cleanText("inviteToken", input.inviteToken, 512);
  const code = cleanText("code", input.code, 32);
  const client = resolveClient(deps.client);
  const now = deps.now ?? new Date();

  const { data, error } = await client
    .from("bsm_content_review_invitations")
    .select("id, project_id, round_id, shop_id, reviewer_email, status, token_hash, code_hash, code_attempt_count, expires_at, revoked_at")
    .eq("token_hash", hashSecret(inviteToken))
    .maybeSingle();
  if (error) throw new Error(`Could not load review invitation: ${error.message}`);
  if (!data || data.revoked_at || !["sent", "viewed"].includes(data.status as string)) {
    throw new ReviewWorkspaceInputError(401, "Review invitation is not valid");
  }
  if (new Date(data.expires_at as string).getTime() <= now.getTime()) {
    throw new ReviewWorkspaceInputError(401, "Review invitation has expired");
  }
  if (!data.code_hash || !verifySecretHash(code, data.code_hash as string)) {
    const attempts = Number(data.code_attempt_count ?? 0) + 1;
    await client
      .from("bsm_content_review_invitations")
      .update({ code_attempt_count: attempts, status: attempts >= 5 ? "revoked" : data.status, updated_at: now.toISOString() })
      .eq("id", data.id as string);
    throw new ReviewWorkspaceInputError(401, attempts >= 5 ? "Review invitation was locked after too many tries" : "Review code is not valid");
  }

  const sessionHash = hashSecret(`${data.id}:${makeInviteToken()}`);
  const sessionId = randomUUID();
  const expiresAt = data.expires_at as string;
  const { error: sessionError } = await client.from("bsm_content_review_sessions").insert({
    id: sessionId,
    invitation_id: data.id,
    project_id: data.project_id,
    round_id: data.round_id,
    shop_id: data.shop_id,
    session_hash: sessionHash,
    device_label: cleanOptionalText("deviceLabel", input.deviceLabel, 120),
    verified_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: expiresAt,
  });
  if (sessionError) throw new Error(`Could not create reviewer session: ${sessionError.message}`);

  const { error: inviteUpdateError } = await client
    .from("bsm_content_review_invitations")
    .update({ status: "viewed", code_attempt_count: 0, updated_at: now.toISOString() })
    .eq("id", data.id as string);
  if (inviteUpdateError) throw new Error(`Could not update review invitation: ${inviteUpdateError.message}`);

  await insertEvent(client, {
    shop_id: data.shop_id,
    review_item_id: null,
    event_type: "review_workspace_invitation_verified",
    actor_profile_id: null,
    payload_jsonb: { invitationId: data.id, roundId: data.round_id, sessionId },
  });

  return {
    sessionHash,
    sessionId,
    invitationId: data.id as string,
    projectId: data.project_id as string,
    roundId: data.round_id as string,
    shopId: data.shop_id as string,
    reviewerEmail: data.reviewer_email as string,
  };
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
        submitted_at,
        expires_at,
        revoked_at,
        reviewer_email,
        reviewer_name,
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
    reviewerName: (invitation.reviewer_name as string | null) ?? null,
    invitationStatus: invitation.status as string,
    submittedAt: (invitation.submitted_at as string | null) ?? null,
  };
}

async function requireRoundDocumentAccess(
  client: ReviewWorkspaceDbClient,
  access: Pick<GuestSessionAccess, "roundId" | "projectId" | "shopId">,
  reviewItemId: string,
  versionId: string,
) {
  const { data, error } = await client
    .from("bsm_content_review_round_documents")
    .select("review_item_id")
    .eq("round_id", access.roundId)
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .eq("review_item_id", reviewItemId)
    .eq("version_id", versionId)
    .maybeSingle();
  if (error) throw new Error(`Could not verify review document assignment: ${error.message}`);
  if (!data) {
    throw new ReviewWorkspaceInputError(404, "This review document is not part of the active round");
  }
}

type ReviewWorkspaceThreadRow = {
  id: string;
  project_id: string;
  round_id: string | null;
  shop_id: string;
  review_item_id: string;
  version_id: string;
  owner_invitation_id: string | null;
  pin_number: number;
  status: string;
};

async function requireGuestThread(
  client: ReviewWorkspaceDbClient,
  access: GuestSessionAccess,
  threadId: string,
): Promise<ReviewWorkspaceThreadRow> {
  const { data, error } = await client
    .from("bsm_content_review_comment_threads")
    .select("id, project_id, round_id, shop_id, review_item_id, version_id, owner_invitation_id, pin_number, status")
    .eq("id", assertUuid("threadId", threadId))
    .eq("project_id", access.projectId)
    .eq("round_id", access.roundId)
    .eq("shop_id", access.shopId)
    .eq("owner_invitation_id", access.invitationId)
    .maybeSingle();
  if (error) throw new Error(`Could not load review comment thread: ${error.message}`);
  if (!data) throw new ReviewWorkspaceInputError(404, "Review comment thread not found");
  return data as ReviewWorkspaceThreadRow;
}

async function requireStaffThread(
  client: ReviewWorkspaceDbClient,
  projectId: string,
  actorProfileId: string,
  actorRole: ReviewWorkspaceActorRole,
  threadId: string,
): Promise<ReviewWorkspaceThreadRow> {
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, actorRole);
  const { data, error } = await client
    .from("bsm_content_review_comment_threads")
    .select("id, project_id, round_id, shop_id, review_item_id, version_id, owner_invitation_id, pin_number, status")
    .eq("id", assertUuid("threadId", threadId))
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .maybeSingle();
  if (error) throw new Error(`Could not load review comment thread: ${error.message}`);
  if (!data) throw new ReviewWorkspaceInputError(404, "Review comment thread not found");

  if (!data.round_id) return data as ReviewWorkspaceThreadRow;

  const { data: round, error: roundError } = await client
    .from("bsm_content_review_rounds")
    .select("id, status")
    .eq("id", data.round_id as string)
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .single();
  if (roundError || !round) throw new Error(`Could not load review comment round: ${roundError?.message ?? "not found"}`);
  if (round.status !== "active" && round.status !== "inviting") {
    throw new ReviewWorkspaceInputError(409, "This review round is no longer open");
  }
  return data as ReviewWorkspaceThreadRow;
}

function isActiveInvitation(row: Record<string, unknown>): boolean {
  if (row.revoked_at) return false;
  return ["sent", "viewed", "submitted"].includes(row.status as string);
}

async function nextSubmissionRevision(
  client: ReviewWorkspaceDbClient,
  roundId: string,
  invitationId: string,
): Promise<number> {
  const { data, error } = await client
    .from("bsm_content_review_decisions")
    .select("id")
    .eq("round_id", roundId)
    .eq("invitation_id", invitationId);
  if (error) throw new Error(`Could not load prior review submissions: ${error.message}`);
  const priorDecisionCount = Array.isArray(data) ? data.length : 0;
  return priorDecisionCount + 1;
}

async function updateRoundCompletionAfterSubmission(
  client: ReviewWorkspaceDbClient,
  input: {
    projectId: string;
    roundId: string;
    shopId: string;
    nowIso: string;
  },
): Promise<{ completed: boolean; outcome: "approved" | "changes_requested" | null }> {
  const { data: invitations, error: invitationsError } = await client
    .from("bsm_content_review_invitations")
    .select("id, status, revoked_at, submitted_at")
    .eq("round_id", input.roundId)
    .eq("project_id", input.projectId)
    .eq("shop_id", input.shopId);
  if (invitationsError) throw new Error(`Could not load review round invitations: ${invitationsError.message}`);

  const activeInvitations = ((invitations ?? []) as Array<Record<string, unknown>>).filter(isActiveInvitation);
  if (activeInvitations.length === 0 || activeInvitations.some((row) => !row.submitted_at && row.status !== "submitted")) {
    return { completed: false, outcome: null };
  }

  const activeInvitationIds = activeInvitations.map((row) => row.id as string);
  const [{ data: decisions, error: decisionsError }, { data: roundDocuments, error: roundDocumentsError }] = await Promise.all([
    client
      .from("bsm_content_review_decisions")
      .select("invitation_id, review_item_id, decision, submitted_at")
      .eq("round_id", input.roundId)
      .in("invitation_id", activeInvitationIds)
      .order("submitted_at", { ascending: false }),
    client
      .from("bsm_content_review_round_documents")
      .select("review_item_id")
      .eq("round_id", input.roundId)
      .eq("project_id", input.projectId)
      .eq("shop_id", input.shopId)
      .eq("decision_required", true),
  ]);
  if (decisionsError) throw new Error(`Could not load review round decisions: ${decisionsError.message}`);
  if (roundDocumentsError) throw new Error(`Could not load required review documents: ${roundDocumentsError.message}`);

  const latestDecisionByReviewerDocument = new Map<string, Record<string, unknown>>();
  for (const decision of (decisions ?? []) as Array<Record<string, unknown>>) {
    const key = `${decision.invitation_id}:${decision.review_item_id}`;
    if (!latestDecisionByReviewerDocument.has(key)) latestDecisionByReviewerDocument.set(key, decision);
  }
  const requiredDecisionCount = activeInvitationIds.length * ((roundDocuments ?? []) as Array<Record<string, unknown>>).length;
  if (requiredDecisionCount === 0 || latestDecisionByReviewerDocument.size !== requiredDecisionCount) {
    return { completed: false, outcome: null };
  }
  const outcome = [...latestDecisionByReviewerDocument.values()].some((decision) => decision.decision === "changes_requested")
    ? "changes_requested"
    : "approved";

  const { error: roundUpdateError } = await client
    .from("bsm_content_review_rounds")
    .update({ status: "completed", completed_at: input.nowIso, outcome, updated_at: input.nowIso })
    .eq("id", input.roundId);
  if (roundUpdateError) throw new Error(`Could not complete review round: ${roundUpdateError.message}`);

  const { error: projectUpdateError } = await client
    .from("bsm_content_review_projects")
    .update({ status: "completed", updated_at: input.nowIso })
    .eq("id", input.projectId);
  if (projectUpdateError) throw new Error(`Could not complete review project: ${projectUpdateError.message}`);

  return { completed: true, outcome };
}

export async function addGuestReviewAnnotation(
  input: AddGuestAnnotationInput,
  deps: { client?: ReviewWorkspaceDbClient } = {},
) {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, input.sessionHash);
  if (access.invitationStatus === "submitted" || access.submittedAt) {
    throw new ReviewWorkspaceInputError(409, "This review round was already submitted");
  }
  const reviewItemId = assertUuid("reviewItemId", input.reviewItemId);
  const versionId = assertUuid("versionId", input.versionId);
  const body = cleanText("body", input.body, 2000);
  const anchorKind = input.anchorKind === "highlight" ? "highlight" : "pin";
  const selection = anchorKind === "highlight" ? cleanTextSelection(input.selection) : null;
  const xRatio = anchorKind === "pin" ? assertRatio("xRatio", input.xRatio) : null;
  const yRatio = anchorKind === "pin" ? assertRatio("yRatio", input.yRatio) : null;
  await requireRoundDocumentAccess(client, access, reviewItemId, versionId);
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
    root_comment_id: null,
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
      comment_kind: anchorKind,
      draft_status: "draft",
      pin_number: input.pinNumber,
      page_number: input.pageNumber ?? null,
      viewport: input.viewport,
      x_ratio: xRatio,
      y_ratio: yRatio,
      selection_jsonb: selection ?? {},
    })
    .select("id, thread_id, body, draft_status")
    .single();
  if (commentError) throw new Error(`Could not add reviewer comment: ${commentError.message}`);

  const { error: threadUpdateError } = await client
    .from("bsm_content_review_comment_threads")
    .update({ root_comment_id: commentId, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (threadUpdateError) throw new Error(`Could not link reviewer comment thread: ${threadUpdateError.message}`);

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: reviewItemId,
    version_id: versionId,
    event_type: "review_workspace_annotation_drafted",
    actor_profile_id: null,
    payload_jsonb: {
      projectId: access.projectId,
      roundId: access.roundId,
      invitationId: access.invitationId,
      threadId,
      commentId,
      pinNumber: input.pinNumber,
      anchorKind,
    },
  });

  return data;
}

export async function addStaffReviewAnnotation(
  input: AddStaffAnnotationInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveClient(deps.client);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const access = await requireReviewWorkspaceStaffAccess(
    client,
    input.projectId,
    actorProfileId,
    input.actorRole ?? null,
  );
  const reviewItemId = assertUuid("reviewItemId", input.reviewItemId);
  const versionId = assertUuid("versionId", input.versionId);
  const body = cleanText("body", input.body, 2000);
  const xRatio = assertRatio("xRatio", input.xRatio);
  const yRatio = assertRatio("yRatio", input.yRatio);
  const now = deps.now ?? new Date();

  const { data: project, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("current_round_id")
    .eq("id", access.projectId)
    .eq("shop_id", access.shopId)
    .single();
  if (projectError || !project) {
    throw new Error(`Could not load review workspace project: ${projectError?.message ?? "not found"}`);
  }
  const roundId = (project.current_round_id as string | null) ?? null;
  if (roundId) {
    const { data: round, error: roundError } = await client
      .from("bsm_content_review_rounds")
      .select("status")
      .eq("id", roundId)
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId)
      .single();
    if (roundError || !round) throw new Error(`Could not load review comment round: ${roundError?.message ?? "not found"}`);
    if (round.status !== "active" && round.status !== "inviting") {
      throw new ReviewWorkspaceInputError(409, "This review round is no longer open");
    }
    await requireRoundDocumentAccess(
      client,
      { roundId, projectId: access.projectId, shopId: access.shopId },
      reviewItemId,
      versionId,
    );
  } else {
    const { data: item, error: itemError } = await client
      .from("bsm_content_review_items")
      .select("id")
      .eq("id", reviewItemId)
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId)
      .eq("current_version_id", versionId)
      .is("deleted_at", null)
      .maybeSingle();
    if (itemError) throw new Error(`Could not verify review document: ${itemError.message}`);
    if (!item) {
      throw new ReviewWorkspaceInputError(404, "This review document is not part of the workspace");
    }
  }

  const { data: priorThreads, error: priorThreadsError } = await client
    .from("bsm_content_review_comment_threads")
    .select("pin_number")
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .eq("review_item_id", reviewItemId)
    .eq("version_id", versionId);
  if (priorThreadsError) throw new Error(`Could not load review comment pins: ${priorThreadsError.message}`);
  let pinNumber = Math.max(
    0,
    ...((priorThreads ?? []) as Array<Record<string, unknown>>).map((row) => Number(row.pin_number ?? 0)),
  ) + 1;
  const threadId = randomUUID();
  const commentId = randomUUID();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error: threadError } = await client
      .from("bsm_content_review_comment_threads")
      .insert({
        id: threadId,
        project_id: access.projectId,
        round_id: roundId,
        shop_id: access.shopId,
        review_item_id: reviewItemId,
        version_id: versionId,
        owner_invitation_id: null,
        root_comment_id: null,
        pin_number: pinNumber,
        status: "open",
      });
    if (!threadError) break;
    if (threadError.code !== "23505" || attempt === 2) {
      throw new Error(`Could not create PSG review comment thread: ${threadError.message}`);
    }
    pinNumber += 1;
  }

  const { data, error: commentError } = await client
    .from("bsm_content_review_comments")
    .insert({
      id: commentId,
      shop_id: access.shopId,
      project_id: access.projectId,
      round_id: roundId,
      invitation_id: null,
      reviewer_session_id: null,
      review_item_id: reviewItemId,
      version_id: versionId,
      thread_id: threadId,
      author_profile_id: actorProfileId,
      body,
      visibility: "shop_and_psg",
      comment_kind: "pin",
      draft_status: "submitted",
      pin_number: pinNumber,
      page_number: null,
      viewport: input.viewport,
      x_ratio: xRatio,
      y_ratio: yRatio,
      selection_jsonb: {},
      submitted_at: now.toISOString(),
      locked_at: now.toISOString(),
    })
    .select("id, thread_id, body, draft_status")
    .single();
  if (commentError) throw new Error(`Could not add PSG review comment: ${commentError.message}`);

  const { error: threadUpdateError } = await client
    .from("bsm_content_review_comment_threads")
    .update({ root_comment_id: commentId, updated_at: now.toISOString() })
    .eq("id", threadId);
  if (threadUpdateError) throw new Error(`Could not link PSG review comment thread: ${threadUpdateError.message}`);

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: reviewItemId,
    version_id: versionId,
    event_type: "review_workspace_staff_annotation_added",
    actor_profile_id: actorProfileId,
    payload_jsonb: {
      projectId: access.projectId,
      roundId,
      threadId,
      commentId,
      pinNumber,
      actorRole: "psg",
    },
  });
  return data;
}

export async function addGuestThreadReply(
  input: AddGuestThreadReplyInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, input.sessionHash);
  if (access.invitationStatus === "submitted" || access.submittedAt) {
    throw new ReviewWorkspaceInputError(409, "This review round was already submitted");
  }
  const thread = await requireGuestThread(client, access, input.threadId);
  const body = cleanText("body", input.body, 2000);
  const now = deps.now ?? new Date();
  const commentId = randomUUID();
  const { data, error } = await client
    .from("bsm_content_review_comments")
    .insert({
      id: commentId,
      shop_id: access.shopId,
      project_id: access.projectId,
      round_id: access.roundId,
      invitation_id: access.invitationId,
      reviewer_session_id: access.sessionId,
      review_item_id: thread.review_item_id,
      version_id: thread.version_id,
      thread_id: thread.id,
      author_profile_id: null,
      body,
      visibility: "shop_and_psg",
      comment_kind: "clarification_reply",
      draft_status: "draft",
      pin_number: null,
    })
    .select("id, thread_id, body, draft_status")
    .single();
  if (error) throw new Error(`Could not add reviewer reply: ${error.message}`);

  const { error: threadError } = await client
    .from("bsm_content_review_comment_threads")
    .update({ status: "open", updated_at: now.toISOString() })
    .eq("id", thread.id)
    .eq("owner_invitation_id", access.invitationId);
  if (threadError) throw new Error(`Could not update review comment thread: ${threadError.message}`);

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: thread.review_item_id,
    version_id: thread.version_id,
    event_type: "review_workspace_thread_replied",
    actor_profile_id: null,
    payload_jsonb: { projectId: access.projectId, roundId: access.roundId, invitationId: access.invitationId, threadId: thread.id, commentId, actorRole: "client" },
  });
  return data;
}

export async function addStaffThreadReply(
  input: AddStaffThreadReplyInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const thread = await requireStaffThread(client, projectId, actorProfileId, input.actorRole ?? null, input.threadId);
  const body = cleanText("body", input.body, 2000);
  const now = deps.now ?? new Date();
  const commentId = randomUUID();
  const { data, error } = await client
    .from("bsm_content_review_comments")
    .insert({
      id: commentId,
      shop_id: thread.shop_id,
      project_id: thread.project_id,
      round_id: thread.round_id,
      invitation_id: thread.owner_invitation_id,
      reviewer_session_id: null,
      review_item_id: thread.review_item_id,
      version_id: thread.version_id,
      thread_id: thread.id,
      author_profile_id: actorProfileId,
      body,
      visibility: "shop_and_psg",
      comment_kind: "psg_reply",
      draft_status: "submitted",
      pin_number: null,
      submitted_at: now.toISOString(),
    })
    .select("id, thread_id, body, draft_status")
    .single();
  if (error) throw new Error(`Could not add PSG reply: ${error.message}`);

  const { error: threadError } = await client
    .from("bsm_content_review_comment_threads")
    .update({ status: "open", updated_at: now.toISOString() })
    .eq("id", thread.id)
    .eq("project_id", thread.project_id);
  if (threadError) throw new Error(`Could not update review comment thread: ${threadError.message}`);

  await insertEvent(client, {
    shop_id: thread.shop_id,
    review_item_id: thread.review_item_id,
    version_id: thread.version_id,
    event_type: "review_workspace_thread_replied",
    actor_profile_id: actorProfileId,
    payload_jsonb: { projectId: thread.project_id, roundId: thread.round_id, invitationId: thread.owner_invitation_id, threadId: thread.id, commentId, actorRole: "psg" },
  });
  return data;
}

async function persistThreadStatus(
  client: ReviewWorkspaceDbClient,
  thread: ReviewWorkspaceThreadRow,
  status: "open" | "resolved",
  actorProfileId: string | null,
  actorRole: "client" | "psg",
  now: Date,
) {
  let update = client
    .from("bsm_content_review_comment_threads")
    .update({ status, updated_at: now.toISOString() })
    .eq("id", thread.id)
    .eq("project_id", thread.project_id);
  update = thread.round_id ? update.eq("round_id", thread.round_id) : update.is("round_id", null);
  const { error } = await update;
  if (error) throw new Error(`Could not ${status === "resolved" ? "resolve" : "reopen"} review comment thread: ${error.message}`);

  await insertEvent(client, {
    shop_id: thread.shop_id,
    review_item_id: thread.review_item_id,
    version_id: thread.version_id,
    event_type: status === "resolved" ? "review_workspace_thread_resolved" : "review_workspace_thread_reopened",
    actor_profile_id: actorProfileId,
    payload_jsonb: { projectId: thread.project_id, roundId: thread.round_id, invitationId: thread.owner_invitation_id, threadId: thread.id, actorRole },
  });
  return { threadId: thread.id, status };
}

export async function setGuestThreadStatus(
  input: SetGuestThreadStatusInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, input.sessionHash);
  if (access.invitationStatus === "submitted" || access.submittedAt) {
    throw new ReviewWorkspaceInputError(409, "This review round was already submitted");
  }
  const thread = await requireGuestThread(client, access, input.threadId);
  return persistThreadStatus(client, thread, cleanThreadStatus(input.status), null, "client", deps.now ?? new Date());
}

export async function setStaffThreadStatus(
  input: SetStaffThreadStatusInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const thread = await requireStaffThread(client, projectId, actorProfileId, input.actorRole ?? null, input.threadId);
  return persistThreadStatus(client, thread, cleanThreadStatus(input.status), actorProfileId, "psg", deps.now ?? new Date());
}

export async function getGuestReviewWorkspace(
  sessionHash: string,
  deps: { client?: ReviewWorkspaceDbClient } = {},
): Promise<GuestReviewWorkspace> {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, sessionHash);

  const [{ data: project }, { data: round }, { data: docs }, { data: comments }, { data: threads }, { data: decisions }] = await Promise.all([
    client.from("bsm_content_review_projects").select("id, title, description, status").eq("id", access.projectId).single(),
    client.from("bsm_content_review_rounds").select("id, status").eq("id", access.roundId).single(),
    client
      .from("bsm_content_review_round_documents")
      .select("review_item_id, version_id")
      .eq("round_id", access.roundId)
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId),
    client
      .from("bsm_content_review_comments")
      .select("id, invitation_id, round_id, review_item_id, version_id, thread_id, author_profile_id, body, comment_kind, pin_number, draft_status, viewport, x_ratio, y_ratio, selection_jsonb, created_at")
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId)
      .order("created_at", { ascending: true }),
    client
      .from("bsm_content_review_comment_threads")
      .select("id, status, pin_number")
      .eq("project_id", access.projectId)
      .eq("shop_id", access.shopId),
    client
      .from("bsm_content_review_decisions")
      .select("review_item_id, version_id, decision, message, submitted_at")
      .eq("round_id", access.roundId)
      .eq("invitation_id", access.invitationId)
      .order("submitted_at", { ascending: true }),
  ]);

  const itemIds = ((docs ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.review_item_id)
    .filter((value): value is string => typeof value === "string");
  const versionIds = ((docs ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.version_id)
    .filter((value): value is string => typeof value === "string");
  const { data: items } = itemIds.length
    ? await client.from("bsm_content_review_items").select("id, title, admin_context_note, processing_status, section_id").in("id", itemIds)
    : { data: [] };
  const itemsById = new Map(((items ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row]));
  const { data: versions } = versionIds.length
    ? await client
        .from("bsm_content_review_versions")
        .select("id, project_id, version_number, original_filename, content_type, preview_url, generated_page_path, storage_bucket, storage_path, processed_storage_bucket, processed_storage_path, processed_content_type, source_metadata_jsonb, snapshot_jsonb")
        .in("id", versionIds)
    : { data: [] };
  const versionsById = new Map(((versions ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row]));
  const commentRows = ((comments ?? []) as Array<Record<string, unknown>>).filter(
    (row) =>
      itemIds.includes(row.review_item_id as string) &&
      versionIds.includes(row.version_id as string) &&
      ((row.invitation_id === access.invitationId && row.round_id === access.roundId) ||
        (row.invitation_id == null && typeof row.author_profile_id === "string" &&
          (row.round_id == null || row.round_id === access.roundId))),
  );
  const profileNames = await loadProfileNames(client, commentRows.flatMap((row) => typeof row.author_profile_id === "string" ? [row.author_profile_id] : []));
  const threadsById = new Map(((threads ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row]));
  const sectionIds = Array.from(
    new Set(
      ((items ?? []) as Array<Record<string, unknown>>)
        .map((row) => row.section_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  );
  const { data: sections } = sectionIds.length
    ? await client.from("bsm_content_review_sections").select("id, title").in("id", sectionIds)
    : { data: [] };
  const sectionTitles = new Map(((sections ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row.title as string]));

  return {
    project: {
      id: (project as Record<string, unknown>).id as string,
      title: (project as Record<string, unknown>).title as string,
      description: ((project as Record<string, unknown>).description as string | null) ?? null,
      status: (project as Record<string, unknown>).status as string,
    },
    round: {
      id: (round as Record<string, unknown>).id as string,
      status: (round as Record<string, unknown>).status as string,
    },
    reviewer: {
      email: access.reviewerEmail,
      submittedAt: access.submittedAt,
      readOnly: access.invitationStatus === "submitted" || Boolean(access.submittedAt),
    },
    documents: await Promise.all(((docs ?? []) as Array<Record<string, unknown>>).map(async (row) => {
      const item = itemsById.get(row.review_item_id as string) ?? null;
      const version = versionsById.get(row.version_id as string) ?? null;
      const metadata = (version?.source_metadata_jsonb as Record<string, unknown> | null) ?? {};
      const snapshot = (version?.snapshot_jsonb as Record<string, unknown> | null) ?? {};
      const previewUrl = typeof metadata.previewUrl === "string" && metadata.previewUrl.trim()
        ? metadata.previewUrl
        : typeof version?.preview_url === "string" && version.preview_url.trim()
          ? version.preview_url
          : null;
      const generatedPagePath = typeof metadata.generatedPagePath === "string" && metadata.generatedPagePath.trim()
        ? metadata.generatedPagePath
        : typeof version?.generated_page_path === "string" && version.generated_page_path.trim()
          ? version.generated_page_path
          : null;
      const privateProofUrl = fileProofTarget(version)
        ? `/api/bsm/review-workspace/file?sessionHash=${encodeURIComponent(sessionHash)}&reviewItemId=${encodeURIComponent(row.review_item_id as string)}&versionId=${encodeURIComponent(row.version_id as string)}`
        : null;
      const sectionId = (item?.section_id as string | null) ?? null;
      return {
        itemId: row.review_item_id as string,
        versionId: row.version_id as string,
        versionNumber: typeof version?.version_number === "number" ? version.version_number : null,
        title: (item?.title as string | null) ?? "Review document",
        note: (item?.admin_context_note as string | null) ?? null,
        processingStatus: (item?.processing_status as string | null) ?? "pending",
        sectionTitle: sectionId ? sectionTitles.get(sectionId) ?? null : null,
        originalFilename: (version?.original_filename as string | null) ?? null,
        contentType: reviewerDocumentContentType(version),
        previewUrl,
        generatedPagePath,
        proofUrl: previewUrl ?? generatedPagePath ?? privateProofUrl,
        proofContent: proofContentFromMetadata(metadata) ?? proofContentFromMetadata(snapshot),
      };
    })),
    comments: commentRows.flatMap((row) => {
      const threadId = typeof row.thread_id === "string" ? row.thread_id : null;
      if (!threadId) return [];
      const thread = threadsById.get(threadId);
      const authorProfileId = typeof row.author_profile_id === "string" ? row.author_profile_id : null;
      const authorRole = row.comment_kind === "psg_reply" || authorProfileId ? "psg" as const : "client" as const;
      return [{
      id: row.id as string,
      reviewItemId: row.review_item_id as string,
      versionId: row.version_id as string,
      threadId,
      body: row.body as string,
      commentKind: readCommentKind(row.comment_kind),
      pinNumber: (row.pin_number as number | null) ?? (thread?.pin_number as number | null) ?? null,
      threadStatus: (thread?.status as string | null) ?? "open",
      draftStatus: row.draft_status as string,
      authorRole,
      authorDisplayName: authorRole === "psg"
        ? (authorProfileId ? profileNames.get(authorProfileId) : null) ?? "PSG team"
        : access.reviewerName ?? access.reviewerEmail,
      createdAt: (row.created_at as string | null) ?? null,
      viewport: (row.viewport as string | null) ?? null,
      xRatio: row.x_ratio == null ? null : Number(row.x_ratio),
      yRatio: row.y_ratio == null ? null : Number(row.y_ratio),
      selection: readTextSelection(row.selection_jsonb),
      }];
    }),
    decisions: ((decisions ?? []) as Array<Record<string, unknown>>).map((row) => ({
      reviewItemId: row.review_item_id as string,
      versionId: row.version_id as string,
      decision: row.decision as string,
      message: (row.message as string | null) ?? null,
      submittedAt: (row.submitted_at as string | null) ?? null,
    })),
  };
}

export async function getGuestReviewWorkspaceFileDownload(
  input: { sessionHash: string; reviewItemId: string; versionId: string },
  deps: { client?: ReviewWorkspaceDbClient } = {},
): Promise<GuestReviewWorkspaceFileDownload> {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, input.sessionHash);
  const reviewItemId = assertUuid("reviewItemId", input.reviewItemId);
  const versionId = assertUuid("versionId", input.versionId);
  await requireRoundDocumentAccess(client, access, reviewItemId, versionId);

  return downloadReviewWorkspaceFile(client, {
    projectId: access.projectId,
    shopId: access.shopId,
    reviewItemId,
    versionId,
  });
}

export async function getStaffReviewWorkspaceFileDownload(
  input: { projectId: string; actorProfileId: string; actorRole?: ReviewWorkspaceActorRole; reviewItemId: string; versionId: string },
  deps: { client?: ReviewWorkspaceDbClient } = {},
): Promise<GuestReviewWorkspaceFileDownload> {
  const client = resolveClient(deps.client);
  const access = await requireReviewWorkspaceStaffAccess(client, input.projectId, input.actorProfileId, input.actorRole);
  return downloadReviewWorkspaceFile(client, {
    projectId: access.projectId,
    shopId: access.shopId,
    reviewItemId: assertUuid("reviewItemId", input.reviewItemId),
    versionId: assertUuid("versionId", input.versionId),
  });
}

async function downloadReviewWorkspaceFile(
  client: ReviewWorkspaceDbClient,
  input: { projectId: string; shopId: string; reviewItemId: string; versionId: string },
): Promise<GuestReviewWorkspaceFileDownload> {

  const { data: version, error } = await client
    .from("bsm_content_review_versions")
    .select(`
      id,
      project_id,
      original_filename,
      content_type,
      byte_size,
      storage_bucket,
      storage_path,
      processed_storage_bucket,
      processed_storage_path,
      processed_content_type
    `)
    .eq("id", input.versionId)
    .eq("review_item_id", input.reviewItemId)
    .eq("project_id", input.projectId)
    .eq("shop_id", input.shopId)
    .maybeSingle();
  if (error) throw new Error(`Could not load review document file: ${error.message}`);
  if (!version) throw new ReviewWorkspaceInputError(404, "Review document file not found");

  const row = version as Record<string, unknown>;
  const processedBucket = typeof row.processed_storage_bucket === "string" && row.processed_storage_bucket.trim()
    ? row.processed_storage_bucket
    : null;
  const processedPath = typeof row.processed_storage_path === "string" && row.processed_storage_path.trim()
    ? row.processed_storage_path
    : null;
  if (row.project_id && (processedBucket !== BSM_CONTENT_APPROVALS_BUCKET || !processedPath)) {
    throw new ReviewWorkspaceInputError(404, "The processed review copy is not available");
  }
  const bucket = processedBucket ?? (typeof row.storage_bucket === "string" ? row.storage_bucket : null);
  const path = processedPath ?? (typeof row.storage_path === "string" ? row.storage_path : null);
  if (bucket !== BSM_CONTENT_APPROVALS_BUCKET || !path) {
    throw new ReviewWorkspaceInputError(404, "Review document file not found");
  }

  const storage = (client as ReviewWorkspaceStorageClient).storage;
  if (!storage) throw new Error("Review workspace file storage is not configured");
  const { data, error: downloadError } = await storage.from(BSM_CONTENT_APPROVALS_BUCKET).download(path);
  if (downloadError || !data) throw new ReviewWorkspaceInputError(404, "Review document file not found");

  return {
    data,
    originalFilename: (row.original_filename as string | null) ?? "review-file",
    contentType:
      (processedPath ? (row.processed_content_type as string | null) : null) ??
      (row.content_type as string | null) ??
      "application/octet-stream",
    byteSize: data.size || (row.byte_size as number | null) || 0,
  };
}

export async function submitGuestReviewRound(
  input: SubmitGuestReviewRoundInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, input.sessionHash);
  const now = deps.now ?? new Date();
  if (!Array.isArray(input.decisions) || input.decisions.length === 0) {
    throw new ReviewWorkspaceInputError(400, "At least one decision is required");
  }

  const [{ data: existingSubmission, error: existingError }, { data: round, error: roundError }] = await Promise.all([
    client
      .from("bsm_content_review_invitations")
      .select("submitted_at, status")
      .eq("id", access.invitationId)
      .maybeSingle(),
    client.from("bsm_content_review_rounds").select("id, status").eq("id", access.roundId).single(),
  ]);
  if (roundError) throw new Error(`Could not load review round: ${roundError.message}`);
  if (!round || (round.status !== "active" && round.status !== "inviting")) {
    throw new ReviewWorkspaceInputError(409, "This review round is no longer open");
  }
  if (existingError) throw new Error(`Could not load review submission state: ${existingError.message}`);
  if (existingSubmission?.submitted_at || existingSubmission?.status === "submitted") {
    throw new ReviewWorkspaceInputError(409, "This review round was already submitted. Reopen it before sending a revised response.");
  }

  const { data: requiredDocuments, error: requiredDocumentsError } = await client
    .from("bsm_content_review_round_documents")
    .select("review_item_id, version_id")
    .eq("round_id", access.roundId)
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .eq("decision_required", true);
  if (requiredDocumentsError) throw new Error(`Could not load required review documents: ${requiredDocumentsError.message}`);
  const requiredKeys = new Set(((requiredDocuments ?? []) as Array<Record<string, unknown>>).map(
    (row) => `${row.review_item_id}:${row.version_id}`,
  ));
  const submittedKeys = new Set<string>();
  for (const decision of input.decisions) {
    if (decision.decision !== "approved" && decision.decision !== "changes_requested") {
      throw new ReviewWorkspaceInputError(400, "Each document requires an Approved or Changes requested decision");
    }
    const key = `${assertUuid("reviewItemId", decision.reviewItemId)}:${assertUuid("versionId", decision.versionId)}`;
    if (!requiredKeys.has(key)) {
      throw new ReviewWorkspaceInputError(400, "This review document is not part of the active round");
    }
    if (submittedKeys.has(key)) {
      throw new ReviewWorkspaceInputError(400, "Submit exactly one decision for every required document");
    }
    submittedKeys.add(key);
  }
  if (submittedKeys.size !== requiredKeys.size) {
    throw new ReviewWorkspaceInputError(400, "Submit exactly one decision for every required document");
  }

  const submissionRevision = await nextSubmissionRevision(client, access.roundId, access.invitationId);

  for (const decision of input.decisions) {
    const reviewItemId = assertUuid("reviewItemId", decision.reviewItemId);
    const versionId = assertUuid("versionId", decision.versionId);
    await requireRoundDocumentAccess(client, access, reviewItemId, versionId);
    if (decision.decision === "changes_requested") {
      const { data: draftComments, error: draftError } = await client
        .from("bsm_content_review_comments")
        .select("id")
        .eq("round_id", access.roundId)
        .eq("invitation_id", access.invitationId)
        .eq("review_item_id", reviewItemId)
        .eq("version_id", versionId)
        .limit(1);
      if (draftError) throw new Error(`Could not check reviewer comments: ${draftError.message}`);
      if (!draftComments || draftComments.length === 0) {
        throw new ReviewWorkspaceInputError(400, "Changes requested requires at least one pinned or highlighted comment");
      }
    }

    await insertWithSchemaCacheFallback(client, "bsm_content_review_decisions", {
      id: randomUUID(),
      shop_id: access.shopId,
      project_id: access.projectId,
      round_id: access.roundId,
      invitation_id: access.invitationId,
      review_item_id: reviewItemId,
      version_id: versionId,
      submission_revision: submissionRevision,
      decision: decision.decision,
      message: cleanOptionalText("message", decision.message, 2000),
      actor_profile_id: null,
      actor_role: "customer",
      submitted_at: now.toISOString(),
      locked_at: now.toISOString(),
    }, new Set(["submission_revision"]), "Could not record review decision");
  }

  const { error: commentLockError } = await client
    .from("bsm_content_review_comments")
    .update({ draft_status: "locked", submitted_at: now.toISOString(), locked_at: now.toISOString() })
    .eq("round_id", access.roundId)
    .eq("invitation_id", access.invitationId);
  if (commentLockError) throw new Error(`Could not lock reviewer comments: ${commentLockError.message}`);

  const { error: threadSubmitError } = await client
    .from("bsm_content_review_comment_threads")
    .update({ status: "submitted", updated_at: now.toISOString() })
    .eq("round_id", access.roundId)
    .eq("owner_invitation_id", access.invitationId)
    .eq("status", "draft");
  if (threadSubmitError) throw new Error(`Could not submit reviewer comment threads: ${threadSubmitError.message}`);

  const { error: reviewerUpdateError } = await client
    .from("bsm_content_review_reviewers")
    .update({ submission_status: "submitted", submitted_at: now.toISOString() })
    .eq("round_id", access.roundId)
    .eq("invitation_id", access.invitationId);
  if (reviewerUpdateError) throw new Error(`Could not update reviewer submission: ${reviewerUpdateError.message}`);

  const { error: invitationUpdateError } = await client
    .from("bsm_content_review_invitations")
    .update({ status: "submitted", submitted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", access.invitationId);
  if (invitationUpdateError) throw new Error(`Could not mark review invitation submitted: ${invitationUpdateError.message}`);

  const completion = await updateRoundCompletionAfterSubmission(client, {
    projectId: access.projectId,
    roundId: access.roundId,
    shopId: access.shopId,
    nowIso: now.toISOString(),
  });

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: null,
    event_type: "review_workspace_round_submitted",
    actor_profile_id: null,
    payload_jsonb: {
      projectId: access.projectId,
      roundId: access.roundId,
      invitationId: access.invitationId,
      decisionCount: input.decisions.length,
      submissionRevision,
      roundCompleted: completion.completed,
      outcome: completion.outcome,
    },
  });

  return {
    projectId: access.projectId,
    roundId: access.roundId,
    invitationId: access.invitationId,
    status: "submitted",
    submissionRevision,
    roundCompleted: completion.completed,
    outcome: completion.outcome,
  };
}

export async function reopenGuestReviewRound(
  input: ReopenGuestReviewRoundInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, input.sessionHash);
  const now = deps.now ?? new Date();

  const { data: round, error: roundError } = await client
    .from("bsm_content_review_rounds")
    .select("id, status")
    .eq("id", access.roundId)
    .single();
  if (roundError) throw new Error(`Could not load review round: ${roundError.message}`);
  if (!round || (round.status !== "active" && round.status !== "inviting")) {
    throw new ReviewWorkspaceInputError(409, "This review round is no longer open");
  }
  if (access.invitationStatus !== "submitted" && !access.submittedAt) {
    throw new ReviewWorkspaceInputError(409, "This review response is already open");
  }

  const { error: invitationUpdateError } = await client
    .from("bsm_content_review_invitations")
    .update({ status: "viewed", submitted_at: null, updated_at: now.toISOString() })
    .eq("id", access.invitationId);
  if (invitationUpdateError) throw new Error(`Could not reopen review invitation: ${invitationUpdateError.message}`);

  const { error: reviewerUpdateError } = await client
    .from("bsm_content_review_reviewers")
    .update({ submission_status: "draft", submitted_at: null })
    .eq("round_id", access.roundId)
    .eq("invitation_id", access.invitationId);
  if (reviewerUpdateError) throw new Error(`Could not reopen reviewer submission: ${reviewerUpdateError.message}`);

  const { error: threadReopenError } = await client
    .from("bsm_content_review_comment_threads")
    .update({ status: "open", updated_at: now.toISOString() })
    .eq("round_id", access.roundId)
    .eq("owner_invitation_id", access.invitationId)
    .eq("status", "submitted");
  if (threadReopenError) throw new Error(`Could not reopen reviewer comment threads: ${threadReopenError.message}`);

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: null,
    event_type: "review_workspace_round_reopened",
    actor_profile_id: null,
    payload_jsonb: {
      projectId: access.projectId,
      roundId: access.roundId,
      invitationId: access.invitationId,
    },
  });

  return {
    projectId: access.projectId,
    roundId: access.roundId,
    invitationId: access.invitationId,
    status: "reopened",
  };
}

export async function closeReviewWorkspaceRoundEarly(
  input: CloseReviewWorkspaceRoundEarlyInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const projectId = assertUuid("projectId", input.projectId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const reason = cleanText("reason", input.reason, 1000);
  const client = resolveClient(deps.client);
  const now = deps.now ?? new Date();
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);

  const { data: project, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, current_round_id")
    .eq("id", projectId)
    .single();
  if (projectError) throw new Error(`Could not load review workspace project: ${projectError.message}`);
  const roundId = (project as Record<string, unknown>).current_round_id as string | null;
  if (!roundId) throw new ReviewWorkspaceInputError(409, "This review workspace does not have an open round");

  const { data: round, error: roundError } = await client
    .from("bsm_content_review_rounds")
    .select("id, status")
    .eq("id", roundId)
    .eq("project_id", projectId)
    .eq("shop_id", access.shopId)
    .single();
  if (roundError || !round) throw new Error(`Could not load review workspace round: ${roundError?.message ?? "not found"}`);
  if (round.status !== "active" && round.status !== "inviting") {
    throw new ReviewWorkspaceInputError(409, "This review round is no longer open");
  }

  const { data: invitations, error: invitationsError } = await client
    .from("bsm_content_review_invitations")
    .select("id, reviewer_email, reviewer_name, status, submitted_at, revoked_at")
    .eq("round_id", roundId)
    .eq("project_id", projectId)
    .eq("shop_id", access.shopId);
  if (invitationsError) throw new Error(`Could not load review invitations: ${invitationsError.message}`);
  const nonresponders = ((invitations ?? []) as Array<Record<string, unknown>>).filter(
    (row) => !row.revoked_at && row.status !== "submitted" && !row.submitted_at,
  );
  const pendingInvitationIds = nonresponders.map((row) => row.id as string);

  const { error: roundUpdateError } = await client
    .from("bsm_content_review_rounds")
    .update({
      status: "closed_early",
      outcome: "closed_early",
      closed_by_profile_id: actorProfileId,
      closed_at: now.toISOString(),
      closed_reason: reason,
      updated_at: now.toISOString(),
    })
    .eq("id", roundId);
  if (roundUpdateError) throw new Error(`Could not close review round early: ${roundUpdateError.message}`);

  const { error: projectUpdateError } = await client
    .from("bsm_content_review_projects")
    .update({ status: "closed_early", updated_at: now.toISOString() })
    .eq("id", projectId);
  if (projectUpdateError) throw new Error(`Could not close review workspace project: ${projectUpdateError.message}`);

  if (pendingInvitationIds.length > 0) {
    const { error: invitationUpdateError } = await client
      .from("bsm_content_review_invitations")
      .update({
        status: "revoked",
        revoked_by_profile_id: actorProfileId,
        revoked_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .in("id", pendingInvitationIds);
    if (invitationUpdateError) throw new Error(`Could not revoke pending review invitations: ${invitationUpdateError.message}`);

    const { error: sessionUpdateError } = await client
      .from("bsm_content_review_sessions")
      .update({ revoked_at: now.toISOString() })
      .in("invitation_id", pendingInvitationIds);
    if (sessionUpdateError) throw new Error(`Could not revoke pending reviewer sessions: ${sessionUpdateError.message}`);
  }

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: null,
    event_type: "review_workspace_round_closed_early",
    actor_profile_id: actorProfileId,
    payload_jsonb: {
      projectId,
      roundId,
      reason,
      nonresponders: nonresponders.map((row) => ({
        email: row.reviewer_email,
        name: row.reviewer_name ?? null,
      })),
    },
  });

  return {
    projectId,
    roundId,
    status: "closed_early",
    outcome: "closed_early",
    nonresponders: nonresponders.map((row) => ({
      email: row.reviewer_email as string,
      name: (row.reviewer_name as string | null) ?? null,
    })),
  };
}

export async function revokeReviewWorkspaceInvitation(
  input: RevokeReviewWorkspaceInvitationInput,
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const projectId = assertUuid("projectId", input.projectId);
  const invitationId = assertUuid("invitationId", input.invitationId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const reason = cleanText("reason", input.reason, 1000);
  const client = resolveClient(deps.client);
  const nowIso = (deps.now ?? new Date()).toISOString();
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);

  const { data: invitation, error: invitationError } = await client
    .from("bsm_content_review_invitations")
    .select("id, project_id, round_id, shop_id, reviewer_email, reviewer_name, revoked_at")
    .eq("id", invitationId)
    .eq("project_id", projectId)
    .eq("shop_id", access.shopId)
    .maybeSingle();
  if (invitationError || !invitation) {
    throw new ReviewWorkspaceInputError(404, "Review invitation not found");
  }
  if (invitation.revoked_at) throw new ReviewWorkspaceInputError(409, "This review invitation was already revoked");

  const roundId = invitation.round_id as string;
  const { data: round, error: roundError } = await client
    .from("bsm_content_review_rounds")
    .select("id, status")
    .eq("id", roundId)
    .eq("project_id", projectId)
    .eq("shop_id", access.shopId)
    .single();
  if (roundError || !round) throw new Error(`Could not load review workspace round: ${roundError?.message ?? "not found"}`);
  if (round.status !== "active" && round.status !== "inviting") {
    throw new ReviewWorkspaceInputError(409, "This review round is no longer open");
  }

  const { error: revokeError } = await client
    .from("bsm_content_review_invitations")
    .update({
      status: "revoked",
      revoked_by_profile_id: actorProfileId,
      revoked_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", invitationId);
  if (revokeError) throw new Error(`Could not revoke review invitation: ${revokeError.message}`);

  const { error: sessionError } = await client
    .from("bsm_content_review_sessions")
    .update({ revoked_at: nowIso })
    .eq("invitation_id", invitationId);
  if (sessionError) throw new Error(`Could not revoke reviewer sessions: ${sessionError.message}`);

  const { error: reviewerError } = await client
    .from("bsm_content_review_reviewers")
    .update({ submission_status: "revoked", removed_at: nowIso })
    .eq("round_id", roundId)
    .eq("invitation_id", invitationId);
  if (reviewerError) throw new Error(`Could not revoke reviewer assignment: ${reviewerError.message}`);

  const completion = await updateRoundCompletionAfterSubmission(client, {
    projectId,
    roundId,
    shopId: access.shopId,
    nowIso,
  });
  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: null,
    event_type: "review_workspace_invitation_revoked",
    actor_profile_id: actorProfileId,
    payload_jsonb: {
      projectId,
      roundId,
      invitationId,
      reviewerEmail: invitation.reviewer_email,
      reviewerName: invitation.reviewer_name ?? null,
      reason,
      roundCompleted: completion.completed,
      outcome: completion.outcome,
    },
  });

  return {
    projectId,
    roundId,
    invitationId,
    status: "revoked",
    roundCompleted: completion.completed,
    outcome: completion.outcome,
  };
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

export async function removeReviewWorkspaceProject(
  input: {
    projectId: string;
    actorProfileId: string;
    actorRole: ReviewWorkspaceActorRole;
    reason?: string | null;
  },
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  if (!isSuperadminRole(input.actorRole)) {
    throw new ReviewWorkspaceInputError(403, "Only a superadmin can remove review workspaces");
  }

  const client = resolveClient(deps.client);
  const now = deps.now ?? new Date();
  const access = await requireReviewWorkspaceStaffAccess(client, input.projectId, input.actorProfileId, input.actorRole);
  const { data: projectRow, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, title, status")
    .eq("id", access.projectId)
    .single();
  if (projectError || !projectRow) throw new Error(`Could not load review workspace project: ${projectError?.message ?? "not found"}`);

  const project = projectRow as Record<string, unknown>;
  const deletedAt = now.toISOString();
  const purgedAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { error: updateError } = await client
    .from("bsm_content_review_projects")
    .update({
      status: "deleted",
      deleted_at: deletedAt,
      recover_until: purgedAt,
      updated_at: deletedAt,
    })
    .eq("id", access.projectId);
  if (updateError) throw new Error(`Could not remove review workspace project: ${updateError.message}`);

  await createReviewWorkspaceDeletionTombstone(
    {
      projectId: access.projectId,
      shopId: access.shopId,
      projectTitle: project.title as string,
      deletedByProfileId: input.actorProfileId,
      deletedAt,
      purgedAt,
      reason: input.reason ?? "Removed from the superadmin review workspace console.",
    },
    { client },
  );

  await enqueueReviewWorkspaceProcessingJob(
    {
      projectId: access.projectId,
      shopId: access.shopId,
      kind: "purge",
      idempotencyKey: `purge:${access.projectId}:${deletedAt}`,
      actorProfileId: input.actorProfileId,
      input: { recoverUntil: purgedAt },
    },
    { client },
  );

  await insertEvent(client, {
    shop_id: access.shopId,
    review_item_id: null,
    event_type: "review_workspace_project_removed",
    actor_profile_id: input.actorProfileId,
    payload_jsonb: { projectId: access.projectId, title: project.title, deletedAt, purgedAt },
  });

  return { projectId: access.projectId, status: "deleted", deletedAt, recoverUntil: purgedAt };
}
