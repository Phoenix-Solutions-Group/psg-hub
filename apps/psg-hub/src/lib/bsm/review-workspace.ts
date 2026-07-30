import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  invitationStatus: string;
  submittedAt: string | null;
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
  project: { id: string; title: string; status: string };
  round: { id: string; status: string };
  reviewer: { email: string; submittedAt: string | null; readOnly: boolean };
  documents: Array<{
    itemId: string;
    versionId: string;
    title: string;
    processingStatus: string;
    sectionTitle: string | null;
    originalFilename: string | null;
    contentType: string | null;
    previewUrl: string | null;
    generatedPagePath: string | null;
    proofUrl: string | null;
    proofContent: ReviewWorkspaceProofContent | null;
  }>;
  comments: Array<{ id: string; reviewItemId: string; versionId: string; body: string; pinNumber: number | null; draftStatus: string }>;
  decisions: Array<{ reviewItemId: string; versionId: string; decision: string; message: string | null; submittedAt: string | null }>;
};

export type StaffReviewWorkspaceResult = {
  project: { id: string; shopId: string; title: string; status: string; currentRoundId: string | null };
  round: { id: string; status: string; outcome: string | null; completedAt: string | null } | null;
  documents: Array<{
    itemId: string;
    versionId: string | null;
    title: string;
    processingStatus: string;
    status: string;
    proofUrl: string | null;
    proofContent: ReviewWorkspaceProofContent | null;
  }>;
  submittedComments: Array<{ id: string; invitationId: string | null; reviewItemId: string; body: string; pinNumber: number | null; draftStatus: string }>;
  decisions: Array<{ id: string; invitationId: string | null; reviewItemId: string; decision: string; message: string | null; submittedAt: string | null }>;
};

export type SubmitGuestReviewRoundInput = {
  sessionHash: string;
  decisions: Array<{ reviewItemId: string; versionId: string; decision: "approved" | "changes_requested"; message?: string | null }>;
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

function resolveClient(client?: ReviewWorkspaceDbClient): ReviewWorkspaceDbClient {
  return client ?? createServiceClient();
}

export function bsmReviewWorkspaceInternalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BSM_REVIEW_WORKSPACE_INTERNAL_ENABLED === "1" || env.BSM_REVIEW_WORKSPACE_INTERNAL_ENABLED === "true";
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

  const path = typeof version?.storage_path === "string" && version.storage_path.trim()
    ? version.storage_path
    : null;
  const bucket = typeof version?.storage_bucket === "string" && version.storage_bucket.trim()
    ? version.storage_bucket
    : null;
  return path && bucket ? { bucket, path } : null;
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

export async function getStaffReviewWorkspaceResult(
  projectId: string,
  actorProfileId: string,
  deps: { client?: ReviewWorkspaceDbClient } = {},
): Promise<StaffReviewWorkspaceResult> {
  const client = resolveClient(deps.client);
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId);

  const { data: projectRow, error: projectError } = await client
    .from("bsm_content_review_projects")
    .select("id, shop_id, title, status, current_round_id")
    .eq("id", access.projectId)
    .single();
  if (projectError || !projectRow) throw new Error(`Could not load review workspace project: ${projectError?.message ?? "not found"}`);
  const project = projectRow as Record<string, unknown>;
  const roundId = (project.current_round_id as string | null) ?? null;

  const [{ data: roundRows }, { data: itemRows }, { data: commentRows }, { data: decisionRows }] = await Promise.all([
    roundId
      ? client
          .from("bsm_content_review_rounds")
          .select("id, status, outcome, completed_at")
          .eq("id", roundId)
      : Promise.resolve({ data: [] }),
    client
      .from("bsm_content_review_items")
      .select(`
        id,
        current_version_id,
        title,
        processing_status,
        status,
        version:bsm_content_review_versions (
          id,
          preview_url,
          generated_page_path,
          storage_bucket,
          storage_path,
          processed_storage_bucket,
          processed_storage_path,
          source_metadata_jsonb,
          snapshot_jsonb
        )
      `)
      .eq("project_id", access.projectId)
      .is("deleted_at", null)
      .order("position", { ascending: true }),
    roundId
      ? client
          .from("bsm_content_review_comments")
          .select("id, invitation_id, review_item_id, body, pin_number, draft_status")
          .eq("round_id", roundId)
          .in("draft_status", ["submitted", "locked"])
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    roundId
      ? client
          .from("bsm_content_review_decisions")
          .select("id, invitation_id, review_item_id, decision, message, submitted_at")
          .eq("round_id", roundId)
          .order("submitted_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const round = ((roundRows ?? []) as Array<Record<string, unknown>>)[0] ?? null;

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
    documents: await Promise.all(((itemRows ?? []) as Array<Record<string, unknown>>).map(async (row) => {
      const rawVersion = row.version;
      const version = rawVersion && typeof rawVersion === "object"
        ? (Array.isArray(rawVersion) ? rawVersion[0] : rawVersion) as Record<string, unknown> | undefined
        : undefined;
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
      const signedProofUrl = await createSignedProofUrl(client, version);
      return {
        itemId: row.id as string,
        versionId: (row.current_version_id as string | null) ?? null,
        title: row.title as string,
        processingStatus: row.processing_status as string,
        status: row.status as string,
        proofUrl: previewUrl ?? generatedPagePath ?? signedProofUrl,
        proofContent: proofContentFromMetadata(sourceMetadata) ?? proofContentFromMetadata(snapshot),
      };
    })),
    submittedComments: ((commentRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      invitationId: (row.invitation_id as string | null) ?? null,
      reviewItemId: row.review_item_id as string,
      body: row.body as string,
      pinNumber: (row.pin_number as number | null) ?? null,
      draftStatus: row.draft_status as string,
    })),
    decisions: ((decisionRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      invitationId: (row.invitation_id as string | null) ?? null,
      reviewItemId: row.review_item_id as string,
      decision: row.decision as string,
      message: (row.message as string | null) ?? null,
      submittedAt: (row.submitted_at as string | null) ?? null,
    })),
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
    invitationStatus: invitation.status as string,
    submittedAt: (invitation.submitted_at as string | null) ?? null,
  };
}

export async function addGuestReviewPinComment(
  input: AddGuestPinCommentInput,
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

  const { error: threadUpdateError } = await client
    .from("bsm_content_review_comment_threads")
    .update({ root_comment_id: commentId, updated_at: new Date().toISOString() })
    .eq("id", threadId);
  if (threadUpdateError) throw new Error(`Could not link reviewer comment thread: ${threadUpdateError.message}`);

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

export async function getGuestReviewWorkspace(
  sessionHash: string,
  deps: { client?: ReviewWorkspaceDbClient } = {},
): Promise<GuestReviewWorkspace> {
  const client = resolveClient(deps.client);
  const access = await requireGuestReviewSession(client, sessionHash);

  const [{ data: project }, { data: round }, { data: docs }, { data: comments }, { data: decisions }] = await Promise.all([
    client.from("bsm_content_review_projects").select("id, title, status").eq("id", access.projectId).single(),
    client.from("bsm_content_review_rounds").select("id, status").eq("id", access.roundId).single(),
    client
      .from("bsm_content_review_round_documents")
      .select("review_item_id, version_id")
      .eq("round_id", access.roundId),
    client
      .from("bsm_content_review_comments")
      .select("id, review_item_id, version_id, body, pin_number, draft_status")
      .eq("round_id", access.roundId)
      .eq("invitation_id", access.invitationId)
      .order("created_at", { ascending: true }),
    client
      .from("bsm_content_review_decisions")
      .select("review_item_id, version_id, decision, message, submitted_at")
      .eq("round_id", access.roundId)
      .eq("invitation_id", access.invitationId),
  ]);

  const itemIds = ((docs ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.review_item_id)
    .filter((value): value is string => typeof value === "string");
  const versionIds = ((docs ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.version_id)
    .filter((value): value is string => typeof value === "string");
  const { data: items } = itemIds.length
    ? await client.from("bsm_content_review_items").select("id, title, processing_status, section_id").in("id", itemIds)
    : { data: [] };
  const itemsById = new Map(((items ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row]));
  const { data: versions } = versionIds.length
    ? await client
        .from("bsm_content_review_versions")
        .select("id, original_filename, content_type, preview_url, generated_page_path, storage_bucket, storage_path, processed_storage_bucket, processed_storage_path, source_metadata_jsonb, snapshot_jsonb")
        .in("id", versionIds)
    : { data: [] };
  const versionsById = new Map(((versions ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row]));
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
      const signedProofUrl = await createSignedProofUrl(client, version);
      const sectionId = (item?.section_id as string | null) ?? null;
      return {
        itemId: row.review_item_id as string,
        versionId: row.version_id as string,
        title: (item?.title as string | null) ?? "Review document",
        processingStatus: (item?.processing_status as string | null) ?? "pending",
        sectionTitle: sectionId ? sectionTitles.get(sectionId) ?? null : null,
        originalFilename: (version?.original_filename as string | null) ?? null,
        contentType: (version?.content_type as string | null) ?? null,
        previewUrl,
        generatedPagePath,
        proofUrl: previewUrl ?? generatedPagePath ?? signedProofUrl,
        proofContent: proofContentFromMetadata(metadata) ?? proofContentFromMetadata(snapshot),
      };
    })),
    comments: ((comments ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      reviewItemId: row.review_item_id as string,
      versionId: row.version_id as string,
      body: row.body as string,
      pinNumber: (row.pin_number as number | null) ?? null,
      draftStatus: row.draft_status as string,
    })),
    decisions: ((decisions ?? []) as Array<Record<string, unknown>>).map((row) => ({
      reviewItemId: row.review_item_id as string,
      versionId: row.version_id as string,
      decision: row.decision as string,
      message: (row.message as string | null) ?? null,
      submittedAt: (row.submitted_at as string | null) ?? null,
    })),
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

  const { data: existingSubmission, error: existingError } = await client
    .from("bsm_content_review_invitations")
    .select("submitted_at, status")
    .eq("id", access.invitationId)
    .maybeSingle();
  if (existingError) throw new Error(`Could not load review submission state: ${existingError.message}`);
  if (existingSubmission?.submitted_at || existingSubmission?.status === "submitted") {
    throw new ReviewWorkspaceInputError(409, "This review round was already submitted");
  }

  for (const decision of input.decisions) {
    const reviewItemId = assertUuid("reviewItemId", decision.reviewItemId);
    const versionId = assertUuid("versionId", decision.versionId);
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
        throw new ReviewWorkspaceInputError(400, "Changes requested requires at least one pin comment");
      }
    }

    const { error } = await client.from("bsm_content_review_decisions").insert({
      id: randomUUID(),
      shop_id: access.shopId,
      project_id: access.projectId,
      round_id: access.roundId,
      invitation_id: access.invitationId,
      review_item_id: reviewItemId,
      version_id: versionId,
      decision: decision.decision,
      message: cleanOptionalText("message", decision.message, 2000),
      actor_profile_id: null,
      actor_role: "customer",
      submitted_at: now.toISOString(),
      locked_at: now.toISOString(),
    });
    if (error) throw new Error(`Could not record review decision: ${error.message}`);
  }

  const { error: commentLockError } = await client
    .from("bsm_content_review_comments")
    .update({ draft_status: "locked", submitted_at: now.toISOString(), locked_at: now.toISOString() })
    .eq("round_id", access.roundId)
    .eq("invitation_id", access.invitationId);
  if (commentLockError) throw new Error(`Could not lock reviewer comments: ${commentLockError.message}`);

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

  const { error: roundUpdateError } = await client
    .from("bsm_content_review_rounds")
    .update({ status: "completed", completed_at: now.toISOString(), outcome: input.decisions.some((d) => d.decision === "changes_requested") ? "changes_requested" : "approved" })
    .eq("id", access.roundId);
  if (roundUpdateError) throw new Error(`Could not complete review round: ${roundUpdateError.message}`);

  const { error: projectUpdateError } = await client
    .from("bsm_content_review_projects")
    .update({ status: "completed", updated_at: now.toISOString() })
    .eq("id", access.projectId);
  if (projectUpdateError) throw new Error(`Could not complete review project: ${projectUpdateError.message}`);

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
    },
  });

  return {
    projectId: access.projectId,
    roundId: access.roundId,
    invitationId: access.invitationId,
    status: "submitted",
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
