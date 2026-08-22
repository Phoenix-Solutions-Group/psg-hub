import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { recordAuditEvent } from "@/lib/audit/access-audit";
import {
  BSM_CONTENT_APPROVALS_BUCKET,
  MAX_APPROVAL_FILE_BYTES,
} from "@/lib/bsm/content-approvals-shared";
import { normalizeApprovalFileName } from "@/lib/bsm/content-approvals";
import {
  ReviewWorkspaceInputError,
  requireReviewWorkspaceStaffAccess,
  type ReviewWorkspaceDbClient,
} from "@/lib/bsm/review-workspace";
import {
  buildMarkdownDiff,
  isContentFeedbackDisposition,
  parseContentWireframe,
  type ContentWireframeDiagnostic,
  type ContentWireframeManifest,
  type MarkdownDiffLine,
} from "@/lib/bsm/content-wireframe";
import type { ContentDraftFeedbackReference, ReviewContentAsset, ReviewContentDraft } from "@/lib/bsm/content-draft-contract";

export const CONTENT_DRAFT_MAX_BYTES = 256 * 1024;

type ActorRole = "psg_superadmin" | "psg_internal" | null | string;
type ContentDraftClient = ReviewWorkspaceDbClient & {
  storage: {
    from(bucket: string): {
      upload(path: string, body: ArrayBuffer | Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: { message: string; statusCode?: string } | null }>;
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};

export class ContentDraftConflictError extends ReviewWorkspaceInputError {
  localMarkdown: string;
  latest: ReviewContentDraft;

  constructor(localMarkdown: string, latest: ReviewContentDraft) {
    super(409, "This Content Draft was changed in another session.");
    this.name = "ContentDraftConflictError";
    this.localMarkdown = localMarkdown;
    this.latest = latest;
  }
}

export class ContentDraftPublishError extends ReviewWorkspaceInputError {
  diagnostics: ContentWireframeDiagnostic[];
  feedbackStatuses: string[];

  constructor(message: string, diagnostics: ContentWireframeDiagnostic[] = [], feedbackStatuses: string[] = []) {
    super(422, message);
    this.name = "ContentDraftPublishError";
    this.diagnostics = diagnostics;
    this.feedbackStatuses = feedbackStatuses;
  }
}

export function prepareContentDraftPublication(input: {
  documentId: string;
  baseVersionId: string | null;
  baseMarkdown: string;
  markdown: string;
  versionNote: string;
  assets: Array<{ id: string; documentId: string }>;
  feedbackStatuses: string[];
}): {
  manifest: ContentWireframeManifest;
  diagnostics: ContentWireframeDiagnostic[];
  diff: MarkdownDiffLine[];
  metadata: {
    sourceKind: "content_draft";
    baseVersionId: string | null;
    versionNote: string;
    parserContractVersion: number;
    orderedAssetIds: string[];
    markdownDiff: MarkdownDiffLine[];
  };
} {
  const versionNote = input.versionNote.trim();
  if (!versionNote) throw new ContentDraftPublishError("A version note is required before publishing.");
  if (versionNote.length > 300) throw new ContentDraftPublishError("The version note must be 300 characters or fewer.");

  const { manifest, diagnostics } = parseContentWireframe(input.markdown, {
    documentId: input.documentId,
    assets: input.assets,
  });
  const blockingFeedback = input.feedbackStatuses.filter((status) => !isContentFeedbackDisposition(status));
  const hasDiagnosticErrors = diagnostics.some((item) => item.severity === "error");
  if (hasDiagnosticErrors || blockingFeedback.length) {
    throw new ContentDraftPublishError(
      hasDiagnosticErrors && blockingFeedback.length
        ? "Resolve Content Wireframe diagnostics and disposition every base-version feedback thread before publishing."
        : hasDiagnosticErrors
          ? "Resolve the blocking Content Wireframe diagnostics before publishing."
          : "Disposition every feedback thread on the base version before publishing.",
      diagnostics,
      blockingFeedback,
    );
  }

  const diff = buildMarkdownDiff(input.baseMarkdown, input.markdown);
  return {
    manifest,
    diagnostics,
    diff,
    metadata: {
      sourceKind: "content_draft",
      baseVersionId: input.baseVersionId,
      versionNote,
      parserContractVersion: manifest.contractVersion,
      orderedAssetIds: manifest.assetIds,
      markdownDiff: diff,
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(label: string, value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ReviewWorkspaceInputError(400, `${label} is required`);
  }
  return value;
}

function assertMarkdown(value: unknown): string {
  if (typeof value !== "string") throw new ReviewWorkspaceInputError(400, "markdown is required");
  if (new TextEncoder().encode(value).byteLength > CONTENT_DRAFT_MAX_BYTES) {
    throw new ReviewWorkspaceInputError(413, "Markdown must be 256 KiB or smaller");
  }
  return value;
}

function readDraft(row: Record<string, unknown>): ReviewContentDraft {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    shopId: row.shop_id as string,
    documentId: row.review_item_id as string,
    markdown: row.markdown_text as string,
    revision: Number(row.revision),
    baseVersionId: (row.base_version_id as string | null) ?? null,
    createdByProfileId: row.created_by_profile_id as string,
    lastWriterProfileId: row.last_writer_profile_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function readAsset(row: Record<string, unknown>): ReviewContentAsset {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    shopId: row.shop_id as string,
    documentId: row.review_item_id as string,
    originalFilename: row.original_filename as string,
    contentType: row.content_type as ReviewContentAsset["contentType"],
    byteSize: Number(row.byte_size),
    createdAt: row.created_at as string,
  };
}

function resolveClient(client?: ReviewWorkspaceDbClient): ReviewWorkspaceDbClient {
  return client ?? (createServiceClient() as SupabaseClient);
}

function resolveContentDraftClient(client?: ReviewWorkspaceDbClient): ContentDraftClient {
  return (client ?? createServiceClient()) as unknown as ContentDraftClient;
}

async function requireDocument(
  client: ReviewWorkspaceDbClient,
  projectId: string,
  shopId: string,
  documentId: string,
): Promise<{ id: string; currentVersionId: string | null }> {
  const { data, error } = await client
    .from("bsm_content_review_items")
    .select("id, current_version_id")
    .eq("id", documentId)
    .eq("project_id", projectId)
    .eq("shop_id", shopId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Could not load Review Document: ${error.message}`);
  if (!data) throw new ReviewWorkspaceInputError(404, "Review Document not found");
  return { id: data.id as string, currentVersionId: (data.current_version_id as string | null) ?? null };
}

async function requireMarkdownDocument(
  client: ReviewWorkspaceDbClient,
  projectId: string,
  shopId: string,
  documentId: string,
): Promise<{ id: string; currentVersionId: string }> {
  const document = await requireDocument(client, projectId, shopId, documentId);
  if (!document.currentVersionId) throw new ReviewWorkspaceInputError(409, "Content Drafts require a Markdown Review Document");
  const { data: version, error } = await client
    .from("bsm_content_review_versions")
    .select("content_type, original_filename, preview_type")
    .eq("id", document.currentVersionId)
    .eq("project_id", projectId)
    .eq("shop_id", shopId)
    .eq("review_item_id", documentId)
    .maybeSingle();
  if (error) throw new Error(`Could not check Review Document type: ${error.message}`);
  const isMarkdown = version?.content_type === "text/markdown" ||
    version?.preview_type === "content_wireframe" ||
    /\.(?:md|markdown)$/i.test(String(version?.original_filename ?? ""));
  if (!isMarkdown) throw new ReviewWorkspaceInputError(409, "Content Drafts require a Markdown Review Document");
  return { ...document, currentVersionId: document.currentVersionId };
}

async function loadDraftRow(
  client: ReviewWorkspaceDbClient,
  projectId: string,
  shopId: string,
  documentId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await client
    .from("bsm_content_review_drafts")
    .select("id, project_id, shop_id, review_item_id, markdown_text, revision, base_version_id, created_by_profile_id, last_writer_profile_id, created_at, updated_at")
    .eq("project_id", projectId)
    .eq("shop_id", shopId)
    .eq("review_item_id", documentId)
    .maybeSingle();
  if (error) throw new Error(`Could not load Content Draft: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function loadAssets(
  client: ReviewWorkspaceDbClient,
  projectId: string,
  shopId: string,
  documentId: string,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await client
    .from("bsm_content_review_assets")
    .select("id, project_id, shop_id, review_item_id, storage_bucket, storage_path, original_filename, content_type, byte_size, checksum_sha256, created_at")
    .eq("project_id", projectId)
    .eq("shop_id", shopId)
    .eq("review_item_id", documentId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load Content Assets: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function loadVersionMarkdown(
  client: ContentDraftClient,
  input: { projectId: string; shopId: string; documentId: string; versionId: string | null },
): Promise<string> {
  if (!input.versionId) return "";
  const { data: version, error } = await client
    .from("bsm_content_review_versions")
    .select("id, content_type, storage_bucket, storage_path, original_storage_bucket, original_storage_path")
    .eq("id", input.versionId)
    .eq("project_id", input.projectId)
    .eq("shop_id", input.shopId)
    .eq("review_item_id", input.documentId)
    .maybeSingle();
  if (error) throw new Error(`Could not load Review Document version: ${error.message}`);
  if (!version) throw new ReviewWorkspaceInputError(404, "Review Document version not found");
  if (version.content_type !== "text/markdown") return "";
  const bucket = (version.storage_bucket as string | null) ?? (version.original_storage_bucket as string | null);
  const path = (version.storage_path as string | null) ?? (version.original_storage_path as string | null);
  if (!bucket || !path) return "";
  const download = await client.storage.from(bucket).download(path);
  if (download.error || !download.data) throw new Error(`Could not load Markdown version: ${download.error?.message ?? "file unavailable"}`);
  const markdown = await download.data.text();
  return assertMarkdown(markdown);
}

async function loadFeedbackStatuses(
  client: ReviewWorkspaceDbClient,
  input: { projectId: string; shopId: string; documentId: string; versionId: string | null },
): Promise<string[]> {
  if (!input.versionId) return [];
  const { data, error } = await client
    .from("bsm_content_review_comment_threads")
    .select("status")
    .eq("project_id", input.projectId)
    .eq("shop_id", input.shopId)
    .eq("review_item_id", input.documentId)
    .eq("version_id", input.versionId);
  if (error) throw new Error(`Could not load feedback dispositions: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => row.status as string);
}

async function loadFeedbackReferences(
  client: ReviewWorkspaceDbClient,
  input: { projectId: string; shopId: string; documentId: string; versionId: string | null },
): Promise<ContentDraftFeedbackReference[]> {
  if (!input.versionId) return [];
  const [{ data: threads, error: threadsError }, { data: comments, error: commentsError }] = await Promise.all([
    client
      .from("bsm_content_review_comment_threads")
      .select("id, status")
      .eq("project_id", input.projectId)
      .eq("shop_id", input.shopId)
      .eq("review_item_id", input.documentId)
      .eq("version_id", input.versionId),
    client
      .from("bsm_content_review_comments")
      .select("id, thread_id, body, comment_kind, pin_number, selection_jsonb, created_at")
      .eq("project_id", input.projectId)
      .eq("shop_id", input.shopId)
      .eq("review_item_id", input.documentId)
      .eq("version_id", input.versionId)
      .in("comment_kind", ["pin", "highlight"])
      .order("created_at", { ascending: true }),
  ]);
  if (threadsError) throw new Error(`Could not load feedback dispositions: ${threadsError.message}`);
  if (commentsError) throw new Error(`Could not load feedback references: ${commentsError.message}`);
  const statuses = new Map(((threads ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row.status as string]));
  return ((comments ?? []) as Array<Record<string, unknown>>).flatMap((row) => {
    const threadId = row.thread_id as string | null;
    if (!threadId || !statuses.has(threadId)) return [];
    const selection = row.selection_jsonb && typeof row.selection_jsonb === "object"
      ? row.selection_jsonb as Record<string, unknown>
      : {};
    return [{
      id: row.id as string,
      threadId,
      kind: row.comment_kind === "highlight" ? "highlight" as const : "pin" as const,
      pinNumber: typeof row.pin_number === "number" ? row.pin_number : null,
      body: row.body as string,
      selectedText: typeof selection.text === "string" ? selection.text : null,
      status: statuses.get(threadId) ?? "open",
      createdAt: row.created_at as string,
    }];
  });
}

async function recordDraftEvent(
  client: ReviewWorkspaceDbClient,
  input: { shopId: string; documentId: string; actorProfileId: string; eventType: string; payload: Record<string, unknown> },
): Promise<void> {
  const { error } = await client.from("bsm_content_review_events").insert({
    shop_id: input.shopId,
    review_item_id: input.documentId,
    event_type: input.eventType,
    actor_profile_id: input.actorProfileId,
    payload_jsonb: input.payload,
  });
  if (error) throw new Error(`Could not record Content Draft event: ${error.message}`);
}

async function recordSupportAccess(
  client: ReviewWorkspaceDbClient,
  input: {
    role: string;
    shopId: string;
    projectId: string;
    documentId: string;
    actorProfileId: string;
    operation: string;
    draftId?: string | null;
  },
): Promise<void> {
  if (input.role !== "superadmin") return;
  const payload = {
    projectId: input.projectId,
    documentId: input.documentId,
    draftId: input.draftId ?? null,
    operation: input.operation,
  };
  await Promise.all([
    recordDraftEvent(client, {
      shopId: input.shopId,
      documentId: input.documentId,
      actorProfileId: input.actorProfileId,
      eventType: "content_draft_support_accessed",
      payload,
    }),
    recordAuditEvent({
      actorProfileId: input.actorProfileId,
      action: "bsm_content_draft.support_access",
      targetShopId: input.shopId,
      payload,
    }),
  ]);
}

export async function createReviewContentDraft(
  input: {
    projectId: string;
    documentId: string;
    actorProfileId: string;
    actorRole?: ActorRole;
    source: "blank" | "import" | "clone";
    markdown?: string;
    cloneVersionId?: string | null;
  },
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
): Promise<ReviewContentDraft> {
  const client = resolveContentDraftClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const documentId = assertUuid("documentId", input.documentId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  const document = await requireMarkdownDocument(client, access.projectId, access.shopId, documentId);
  await recordSupportAccess(client, { ...access, documentId, actorProfileId, operation: input.source });
  const existing = await loadDraftRow(client, access.projectId, access.shopId, documentId);
  if (existing) {
    if (input.source === "blank") return readDraft(existing);
    throw new ReviewWorkspaceInputError(409, "This Review Document already has a Content Draft");
  }

  const cloneVersionId = input.source === "clone" ? assertUuid("cloneVersionId", input.cloneVersionId) : null;
  const markdown = input.source === "clone"
    ? await loadVersionMarkdown(client, {
        projectId: access.projectId,
        shopId: access.shopId,
        documentId,
        versionId: cloneVersionId,
      })
    : assertMarkdown(input.source === "blank" ? input.markdown ?? "" : input.markdown);

  const now = (deps.now ?? new Date()).toISOString();
  const { data, error } = await client
    .from("bsm_content_review_drafts")
    .insert({
      id: randomUUID(),
      project_id: access.projectId,
      shop_id: access.shopId,
      review_item_id: documentId,
      markdown_text: markdown,
      revision: 0,
      last_published_revision: -1,
      base_version_id: cloneVersionId ?? document.currentVersionId,
      created_by_profile_id: actorProfileId,
      last_writer_profile_id: actorProfileId,
      created_at: now,
      updated_at: now,
    })
    .select("id, project_id, shop_id, review_item_id, markdown_text, revision, base_version_id, created_by_profile_id, last_writer_profile_id, created_at, updated_at")
    .maybeSingle();
  if (error) throw new Error(`Could not create Content Draft: ${error.message}`);
  if (!data) throw new Error("Could not create Content Draft");
  const draft = readDraft(data as Record<string, unknown>);
  await recordDraftEvent(client, {
    shopId: access.shopId,
    documentId,
    actorProfileId,
    eventType: input.source === "import"
      ? "content_draft_imported"
      : input.source === "clone"
        ? "content_draft_cloned"
        : "content_draft_created",
    payload: { projectId: access.projectId, documentId, draftId: draft.id, baseVersionId: draft.baseVersionId },
  });
  return draft;
}

export async function getReviewContentDraftWorkspace(
  input: {
    projectId: string;
    documentId: string;
    actorProfileId: string;
    actorRole?: ActorRole;
  },
  deps: { client?: ReviewWorkspaceDbClient } = {},
) {
  const client = resolveContentDraftClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const documentId = assertUuid("documentId", input.documentId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  const document = await requireMarkdownDocument(client, access.projectId, access.shopId, documentId);
  const [draftRow, assetRows] = await Promise.all([
    loadDraftRow(client, access.projectId, access.shopId, documentId),
    loadAssets(client, access.projectId, access.shopId, documentId),
  ]);
  const draft = draftRow ? readDraft(draftRow) : null;
  const assets = assetRows.map(readAsset);
  const [baseMarkdown, feedbackStatuses, feedbackReferences] = draft
    ? await Promise.all([
        loadVersionMarkdown(client, {
          projectId: access.projectId,
          shopId: access.shopId,
          documentId,
          versionId: draft.baseVersionId,
        }),
        loadFeedbackStatuses(client, {
          projectId: access.projectId,
          shopId: access.shopId,
          documentId,
          versionId: draft.baseVersionId,
        }),
        loadFeedbackReferences(client, {
          projectId: access.projectId,
          shopId: access.shopId,
          documentId,
          versionId: draft.baseVersionId,
        }),
      ])
    : ["", [] as string[], [] as ContentDraftFeedbackReference[]];
  const parsed = draft
    ? parseContentWireframe(draft.markdown, {
        documentId,
        assets: assets.map((asset) => ({ id: asset.id, documentId: asset.documentId })),
      })
    : null;

  await recordSupportAccess(client, {
    ...access,
    documentId,
    actorProfileId,
    operation: "read",
    draftId: draft?.id ?? null,
  });

  return {
    draft,
    currentVersionId: document.currentVersionId,
    assets,
    manifest: parsed?.manifest ?? null,
    diagnostics: parsed?.diagnostics ?? [],
    baseMarkdown,
    diff: draft ? buildMarkdownDiff(baseMarkdown, draft.markdown) : [],
    feedbackStatuses,
    feedbackReferences,
    approvalStatement: "Approval covers copy, hierarchy, CTA intent, selected images or placeholders, and block order only. It does not approve final design or production launch.",
  };
}

const CONTENT_ASSET_TYPES = new Set<ReviewContentAsset["contentType"]>(["image/png", "image/jpeg", "image/webp"]);

function contentAssetBytesMatchType(bytes: Uint8Array, contentType: ReviewContentAsset["contentType"]): boolean {
  if (contentType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  }
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
}

export async function uploadReviewContentAsset(
  input: {
    projectId: string;
    documentId: string;
    actorProfileId: string;
    actorRole?: ActorRole;
    fileName: string;
    contentType: string;
    bytes: Uint8Array;
  },
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
): Promise<{ asset: ReviewContentAsset; markdownReference: string }> {
  const client = resolveContentDraftClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const documentId = assertUuid("documentId", input.documentId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const contentType = input.contentType.toLowerCase() as ReviewContentAsset["contentType"];
  if (!CONTENT_ASSET_TYPES.has(contentType)) {
    throw new ReviewWorkspaceInputError(415, "Content Assets must be PNG, JPEG, or WebP images");
  }
  if (!input.bytes.byteLength) throw new ReviewWorkspaceInputError(400, "The selected Content Asset is empty");
  if (input.bytes.byteLength > MAX_APPROVAL_FILE_BYTES) {
    throw new ReviewWorkspaceInputError(413, "Content Assets must be 25 MB or smaller");
  }
  if (!contentAssetBytesMatchType(input.bytes, contentType)) {
    throw new ReviewWorkspaceInputError(415, "Content Asset bytes do not match the selected image type");
  }
  const fileName = normalizeApprovalFileName(input.fileName);
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  await requireMarkdownDocument(client, access.projectId, access.shopId, documentId);
  await recordSupportAccess(client, { ...access, documentId, actorProfileId, operation: "upload_asset" });
  const id = randomUUID();
  const storagePath = `${access.shopId}/${access.projectId}/${documentId}/assets/${id}/${fileName}`;
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const upload = await client.storage.from(BSM_CONTENT_APPROVALS_BUCKET).upload(storagePath, input.bytes, {
    contentType,
    upsert: false,
  });
  if (upload.error) throw new Error(`Could not upload Content Asset: ${upload.error.message}`);

  const now = (deps.now ?? new Date()).toISOString();
  const { data, error } = await client
    .from("bsm_content_review_assets")
    .insert({
      id,
      project_id: access.projectId,
      shop_id: access.shopId,
      review_item_id: documentId,
      storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
      storage_path: storagePath,
      original_filename: fileName,
      content_type: contentType,
      byte_size: input.bytes.byteLength,
      checksum_sha256: checksum,
      created_by_profile_id: actorProfileId,
      created_at: now,
    })
    .select("id, project_id, shop_id, review_item_id, original_filename, content_type, byte_size, created_at")
    .maybeSingle();
  if (error || !data) {
    await client.storage.from(BSM_CONTENT_APPROVALS_BUCKET).remove([storagePath]);
    throw new Error(`Could not record Content Asset: ${error?.message ?? "insert failed"}`);
  }
  const asset = readAsset(data as Record<string, unknown>);
  await recordDraftEvent(client, {
    shopId: access.shopId,
    documentId,
    actorProfileId,
    eventType: "content_asset_uploaded",
    payload: { projectId: access.projectId, documentId, assetId: asset.id, contentType, byteSize: asset.byteSize },
  });
  return { asset, markdownReference: `![${fileName.replace(/\.[^.]+$/, "").replaceAll("-", " ")}](asset:${asset.id})` };
}

function manifestAssetIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const assetIds = (value as Record<string, unknown>).assetIds;
  return Array.isArray(assetIds) ? assetIds.filter((id): id is string => typeof id === "string") : [];
}

export async function deleteReviewContentAsset(
  input: {
    projectId: string;
    documentId: string;
    assetId: string;
    actorProfileId: string;
    actorRole?: ActorRole;
  },
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
): Promise<{ id: string; deletedAt: string }> {
  const client = resolveClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const documentId = assertUuid("documentId", input.documentId);
  const assetId = assertUuid("assetId", input.assetId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  await requireMarkdownDocument(client, access.projectId, access.shopId, documentId);
  await recordSupportAccess(client, { ...access, documentId, actorProfileId, operation: "delete_asset" });
  const { data: asset, error: assetError } = await client
    .from("bsm_content_review_assets")
    .select("id")
    .eq("id", assetId)
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .eq("review_item_id", documentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (assetError) throw new Error(`Could not load Content Asset: ${assetError.message}`);
  if (!asset) throw new ReviewWorkspaceInputError(404, "Content Asset not found");
  const { data: versions, error: versionError } = await client
    .from("bsm_content_review_versions")
    .select("id, artifact_manifest_jsonb")
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .eq("review_item_id", documentId);
  if (versionError) throw new Error(`Could not check Content Asset references: ${versionError.message}`);
  if (((versions ?? []) as Array<Record<string, unknown>>).some((version) => manifestAssetIds(version.artifact_manifest_jsonb).includes(assetId))) {
    throw new ReviewWorkspaceInputError(409, "Published Content Wireframes still reference this Content Asset");
  }
  const deletedAt = (deps.now ?? new Date()).toISOString();
  const { data: deleted, error: deleteError } = await client
    .from("bsm_content_review_assets")
    .update({ deleted_at: deletedAt })
    .eq("id", assetId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (deleteError) throw new Error(`Could not delete Content Asset: ${deleteError.message}`);
  if (!deleted) throw new ReviewWorkspaceInputError(409, "Content Asset was already deleted");
  await recordDraftEvent(client, {
    shopId: access.shopId,
    documentId,
    actorProfileId,
    eventType: "content_asset_deleted",
    payload: { projectId: access.projectId, documentId, assetId },
  });
  return { id: assetId, deletedAt };
}

export async function getAdminContentAsset(
  input: { projectId: string; documentId: string; assetId: string; actorProfileId: string; actorRole?: ActorRole },
  deps: { client?: ReviewWorkspaceDbClient } = {},
): Promise<{ data: Blob; contentType: string; fileName: string }> {
  const client = resolveContentDraftClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const documentId = assertUuid("documentId", input.documentId);
  const assetId = assertUuid("assetId", input.assetId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  await requireMarkdownDocument(client, access.projectId, access.shopId, documentId);
  await recordSupportAccess(client, { ...access, documentId, actorProfileId, operation: "read_asset" });
  const { data: asset, error } = await client
    .from("bsm_content_review_assets")
    .select("storage_bucket, storage_path, original_filename, content_type")
    .eq("id", assetId)
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .eq("review_item_id", documentId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`Could not load Content Asset: ${error.message}`);
  if (!asset) throw new ReviewWorkspaceInputError(404, "Content Asset not found");
  const download = await client.storage.from(asset.storage_bucket as string).download(asset.storage_path as string);
  if (download.error || !download.data) throw new Error(`Could not download Content Asset: ${download.error?.message ?? "file unavailable"}`);
  return { data: download.data, contentType: asset.content_type as string, fileName: asset.original_filename as string };
}

export async function publishReviewContentDraft(
  input: {
    projectId: string;
    documentId: string;
    actorProfileId: string;
    actorRole?: ActorRole;
    expectedRevision: number;
    versionId: string;
    versionNote: string;
  },
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
) {
  const client = resolveContentDraftClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const documentId = assertUuid("documentId", input.documentId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const versionId = assertUuid("versionId", input.versionId);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ReviewWorkspaceInputError(400, "expectedRevision must be a non-negative integer");
  }
  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  await requireMarkdownDocument(client, access.projectId, access.shopId, documentId);
  const draftRow = await loadDraftRow(client, access.projectId, access.shopId, documentId);
  if (!draftRow) throw new ReviewWorkspaceInputError(404, "Content Draft not found");
  const draft = readDraft(draftRow);
  await recordSupportAccess(client, { ...access, documentId, actorProfileId, operation: "publish", draftId: draft.id });
  if (draft.revision !== input.expectedRevision) throw new ContentDraftConflictError(draft.markdown, draft);

  const bytes = new TextEncoder().encode(draft.markdown);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const { data: existingVersion, error: existingVersionError } = await client
    .from("bsm_content_review_versions")
    .select("id, version_number, checksum_sha256, source_metadata_jsonb, artifact_manifest_jsonb")
    .eq("id", versionId)
    .eq("project_id", access.projectId)
    .eq("shop_id", access.shopId)
    .eq("review_item_id", documentId)
    .maybeSingle();
  if (existingVersionError) throw new Error(`Could not check publication identity: ${existingVersionError.message}`);
  if (existingVersion) {
    const metadata = (existingVersion.source_metadata_jsonb as Record<string, unknown> | null) ?? {};
    const manifest = existingVersion.artifact_manifest_jsonb as ContentWireframeManifest | null;
    const identityMatches = existingVersion.checksum_sha256 === checksum &&
      metadata.sourceKind === "content_draft" &&
      metadata.draftId === draft.id &&
      metadata.draftRevision === draft.revision &&
      manifest?.contractVersion === 1 && Array.isArray(manifest.blocks) && Array.isArray(manifest.assetIds);
    if (!identityMatches) throw new ReviewWorkspaceInputError(409, "Publication identity is not available");
    return {
      versionId,
      versionNumber: typeof existingVersion.version_number === "number" ? existingVersion.version_number : null,
      status: "ready" as const,
      manifest,
      diff: Array.isArray(metadata.markdownDiff) ? metadata.markdownDiff as MarkdownDiffLine[] : [],
      versionNote: typeof metadata.versionNote === "string" ? metadata.versionNote : "",
      sentInvitations: 0,
      activeRoundChanged: false,
    };
  }

  const [assetRows, feedbackStatuses, baseMarkdown] = await Promise.all([
    loadAssets(client, access.projectId, access.shopId, documentId),
    loadFeedbackStatuses(client, {
      projectId: access.projectId,
      shopId: access.shopId,
      documentId,
      versionId: draft.baseVersionId,
    }),
    loadVersionMarkdown(client, {
      projectId: access.projectId,
      shopId: access.shopId,
      documentId,
      versionId: draft.baseVersionId,
    }),
  ]);
  const assets = assetRows.map(readAsset);
  const publication = prepareContentDraftPublication({
    documentId,
    baseVersionId: draft.baseVersionId,
    baseMarkdown,
    markdown: draft.markdown,
    versionNote: input.versionNote,
    assets: assets.map((asset) => ({ id: asset.id, documentId: asset.documentId })),
    feedbackStatuses,
  });
  const storagePath = `${access.shopId}/${documentId}/${versionId}/content.md`;
  const upload = await client.storage.from(BSM_CONTENT_APPROVALS_BUCKET).upload(storagePath, bytes, {
    contentType: "text/plain",
    upsert: false,
  });
  if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) {
    throw new Error(`Could not store published Markdown: ${upload.error.message}`);
  }

  const now = (deps.now ?? new Date()).toISOString();
  const { data, error } = await client.rpc("publish_bsm_content_draft_version", {
    p_version_id: versionId,
    p_project_id: access.projectId,
    p_shop_id: access.shopId,
    p_review_item_id: documentId,
    p_draft_id: draft.id,
    p_expected_revision: draft.revision,
    p_storage_path: storagePath,
    p_byte_size: bytes.byteLength,
    p_checksum_sha256: checksum,
    p_source_metadata: {
      ...publication.metadata,
      draftId: draft.id,
      draftRevision: draft.revision,
    },
    p_artifact_manifest: publication.manifest,
    p_actor_profile_id: actorProfileId,
    p_now: now,
  });
  if (error) {
    if (error.code === "40001") {
      const latestRow = await loadDraftRow(client, access.projectId, access.shopId, documentId);
      if (latestRow) throw new ContentDraftConflictError(draft.markdown, readDraft(latestRow));
    }
    if (error.code === "23514") {
      throw new ContentDraftPublishError("Disposition every feedback thread on the base version before publishing.", publication.diagnostics, feedbackStatuses);
    }
    if (error.code === "23505") throw new ReviewWorkspaceInputError(409, "This saved Content Draft revision was already published");
    throw new Error(`Could not publish Content Draft: ${error.message}`);
  }
  const rawVersion = Array.isArray(data) ? data[0] : data;
  const version = rawVersion && typeof rawVersion === "object" ? rawVersion as Record<string, unknown> : {};
  return {
    versionId: (version.id as string | undefined) ?? versionId,
    versionNumber: typeof version.version_number === "number" ? version.version_number : null,
    status: "ready" as const,
    manifest: publication.manifest,
    diff: publication.diff,
    versionNote: publication.metadata.versionNote,
    sentInvitations: 0,
    activeRoundChanged: false,
  };
}

export async function saveContentDraft(
  input: {
    projectId: string;
    documentId: string;
    actorProfileId: string;
    actorRole?: ActorRole;
    expectedRevision: number;
    markdown: string;
  },
  deps: { client?: ReviewWorkspaceDbClient; now?: Date } = {},
): Promise<ReviewContentDraft> {
  const client = resolveClient(deps.client);
  const projectId = assertUuid("projectId", input.projectId);
  const documentId = assertUuid("documentId", input.documentId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const markdown = assertMarkdown(input.markdown);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new ReviewWorkspaceInputError(400, "expectedRevision must be a non-negative integer");
  }

  const access = await requireReviewWorkspaceStaffAccess(client, projectId, actorProfileId, input.actorRole);
  await requireMarkdownDocument(client, access.projectId, access.shopId, documentId);
  const current = await loadDraftRow(client, access.projectId, access.shopId, documentId);
  if (!current) throw new ReviewWorkspaceInputError(404, "Content Draft not found");
  await recordSupportAccess(client, {
    ...access,
    documentId,
    actorProfileId,
    operation: "save",
    draftId: current.id as string,
  });

  const updatedAt = (deps.now ?? new Date()).toISOString();
  const { data, error } = await client
    .from("bsm_content_review_drafts")
    .update({
      markdown_text: markdown,
      revision: input.expectedRevision + 1,
      last_writer_profile_id: actorProfileId,
      updated_at: updatedAt,
    })
    .eq("id", current.id as string)
    .eq("revision", input.expectedRevision)
    .select("id, project_id, shop_id, review_item_id, markdown_text, revision, base_version_id, created_by_profile_id, last_writer_profile_id, created_at, updated_at")
    .maybeSingle();
  if (error) throw new Error(`Could not save Content Draft: ${error.message}`);

  if (!data) {
    const latestRow = await loadDraftRow(client, access.projectId, access.shopId, documentId);
    if (!latestRow) throw new ReviewWorkspaceInputError(404, "Content Draft not found");
    const latest = readDraft(latestRow);
    await recordDraftEvent(client, {
      shopId: access.shopId,
      documentId,
      actorProfileId,
      eventType: "content_draft_save_conflict",
      payload: { projectId: access.projectId, documentId, expectedRevision: input.expectedRevision, latestRevision: latest.revision },
    });
    throw new ContentDraftConflictError(markdown, latest);
  }

  const saved = readDraft(data as Record<string, unknown>);
  await recordDraftEvent(client, {
    shopId: access.shopId,
    documentId,
    actorProfileId,
    eventType: "content_draft_saved",
    payload: { projectId: access.projectId, documentId, revision: saved.revision },
  });
  return saved;
}
