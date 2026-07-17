import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  BSM_CONTENT_APPROVALS_BUCKET,
  MAX_APPROVAL_FILE_BYTES,
  SUPPORTED_APPROVAL_FILE_TYPES,
  type BsmContentApprovalListItem,
} from "@/lib/bsm/content-approvals-shared";

export {
  BSM_CONTENT_APPROVALS_BUCKET,
  MAX_APPROVAL_FILE_BYTES,
  SUPPORTED_APPROVAL_FILE_TYPES,
  type BsmContentApprovalListItem,
} from "@/lib/bsm/content-approvals-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

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
  title: string;
  contextNote: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  actorProfileId: string;
};

export type GeneratedPageApprovalInput = {
  shopId: string;
  customerProfileId?: string | null;
  title: string;
  contextNote: string;
  generatedPagePath: string;
  previewUrl?: string | null;
  sourceContentItemId?: string | null;
  snapshot?: Record<string, unknown> | null;
  actorProfileId: string;
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

export function validateApprovalFile(contentType: unknown, byteSize: unknown) {
  if (typeof contentType !== "string" || !(contentType in SUPPORTED_APPROVAL_FILE_TYPES)) {
    throw new ApprovalUploadInputError(
      "This file type is not supported. Upload a PDF, image, Word document, or text file.",
    );
  }
  if (typeof byteSize !== "number" || !Number.isFinite(byteSize) || byteSize <= 0) {
    throw new ApprovalUploadInputError("The selected file is empty");
  }
  if (byteSize > MAX_APPROVAL_FILE_BYTES) {
    throw new ApprovalUploadInputError("The file is too large. Upload a file under 25 MB.");
  }
  return SUPPORTED_APPROVAL_FILE_TYPES[contentType as keyof typeof SUPPORTED_APPROVAL_FILE_TYPES];
}

export function approvalStoragePath(input: {
  shopId: string;
  itemId: string;
  versionId: string;
  fileName: string;
}): string {
  return `${input.shopId}/${input.itemId}/${input.versionId}/${input.fileName}`;
}

function resolveStorage(deps: { storage?: ContentApprovalStorage }) {
  return deps.storage ?? (createServiceClient().storage as unknown as ContentApprovalStorage);
}

export async function createBsmContentApprovalUpload(
  input: ApprovalUploadInput,
  deps: { client?: SupabaseClient; storage?: ContentApprovalStorage } = {},
): Promise<ApprovalUploadResult> {
  const shopId = assertUuid("shopId", input.shopId);
  const actorProfileId = assertUuid("actorProfileId", input.actorProfileId);
  const customerProfileId = cleanOptionalUuid("customerProfileId", input.customerProfileId);
  const title = cleanText("title", input.title, 160);
  const contextNote = cleanText("contextNote", input.contextNote, 3000);
  const fileName = normalizeApprovalFileName(input.fileName);
  const file = validateApprovalFile(input.contentType, input.byteSize);
  const itemId = randomUUID();
  const versionId = randomUUID();
  const path = approvalStoragePath({ shopId, itemId, versionId, fileName });
  const client = deps.client ?? createServiceClient();

  const { error: itemError } = await client.from("bsm_content_review_items").insert({
    id: itemId,
    shop_id: shopId,
    customer_profile_id: customerProfileId,
    title,
    content_type: file.contentType,
    source_kind: "uploaded_file",
    status: "draft",
    admin_context_note: contextNote,
    created_by_profile_id: actorProfileId,
  });
  if (itemError) throw new Error(`Could not create review item: ${itemError.message}`);

  const { error: versionError } = await client.from("bsm_content_review_versions").insert({
    id: versionId,
    review_item_id: itemId,
    shop_id: shopId,
    version_number: 1,
    status: "current",
    storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
    storage_path: path,
    original_filename: fileName,
    content_type: input.contentType,
    byte_size: input.byteSize,
    preview_type: file.contentType === "image" ? "image" : "file",
    created_by_profile_id: actorProfileId,
  });
  if (versionError) throw new Error(`Could not create review version: ${versionError.message}`);

  const { error: updateError } = await client
    .from("bsm_content_review_items")
    .update({ current_version_id: versionId, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (updateError) throw new Error(`Could not link current version: ${updateError.message}`);

  const { error: reviewerError } = await client.from("bsm_content_review_reviewers").insert({
    review_item_id: itemId,
    shop_id: shopId,
    profile_id: customerProfileId,
    reviewer_role: "reviewer",
    notification_preference: "email",
  });
  if (reviewerError) throw new Error(`Could not add reviewer: ${reviewerError.message}`);

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
  const { data, error: uploadError } = await storage
    .from(BSM_CONTENT_APPROVALS_BUCKET)
    .createSignedUploadUrl(path);
  if (uploadError || !data) {
    throw new Error(`Could not start upload: ${uploadError?.message ?? "no upload URL returned"}`);
  }

  return {
    item: {
      id: itemId,
      shopId,
      customerProfileId,
      title,
      status: "draft",
      contentType: file.contentType,
      sourceKind: "uploaded_file",
      contextNote,
      updatedAt: new Date().toISOString(),
      currentVersion: {
        id: versionId,
        originalFilename: fileName,
        contentType: input.contentType,
        byteSize: input.byteSize,
        storagePath: path,
        previewType: file.contentType === "image" ? "image" : "file",
        sourceMetadata: {},
        createdAt: new Date().toISOString(),
      },
      latestDecision: null,
      commentCount: 0,
    },
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
  const sourceContentItemId = cleanOptionalUuid("sourceContentItemId", input.sourceContentItemId);
  const title = cleanText("title", input.title, 160);
  const contextNote = cleanText("contextNote", input.contextNote, 3000);
  const generatedPagePath = cleanGeneratedPagePath(input.generatedPagePath);
  const previewUrl = cleanOptionalUrl("previewUrl", input.previewUrl);
  const itemId = randomUUID();
  const versionId = randomUUID();
  const client = deps.client ?? createServiceClient();
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
    source_content_item_id: sourceContentItemId,
    customer_profile_id: customerProfileId,
    title,
    content_type: "generated_page",
    source_kind: "generated_page",
    status: "draft",
    admin_context_note: contextNote,
    created_by_profile_id: actorProfileId,
    metadata_jsonb: { sourceKind: "generated_page" },
  });
  if (itemError) throw new Error(`Could not create generated page review item: ${itemError.message}`);

  const { error: versionError } = await client.from("bsm_content_review_versions").insert({
    id: versionId,
    review_item_id: itemId,
    shop_id: shopId,
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

  const { error: reviewerError } = await client.from("bsm_content_review_reviewers").insert({
    review_item_id: itemId,
    shop_id: shopId,
    profile_id: customerProfileId,
    reviewer_role: "reviewer",
    notification_preference: "email",
  });
  if (reviewerError) throw new Error(`Could not add reviewer: ${reviewerError.message}`);

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
    item: {
      id: itemId,
      shopId,
      customerProfileId,
      title,
      status: "draft",
      contentType: "generated_page",
      sourceKind: "generated_page",
      contextNote,
      updatedAt: new Date().toISOString(),
      currentVersion: {
        id: versionId,
        originalFilename: null,
        contentType: "text/html",
        byteSize: 1,
        storagePath: null,
        previewType: "generated_page",
        sourceMetadata,
        createdAt: new Date().toISOString(),
      },
      latestDecision: null,
      commentCount: 0,
    },
  };
}

export async function listBsmContentApprovals(
  client: SupabaseClient,
  opts: { shopId?: string | null } = {},
): Promise<BsmContentApprovalListItem[]> {
  let query = client
    .from("bsm_content_review_items")
    .select("id, shop_id, customer_profile_id, title, status, content_type, admin_context_note, current_version_id, updated_at, metadata_jsonb")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (opts.shopId) query = query.eq("shop_id", opts.shopId);

  const { data: items, error } = await query;
  if (error) throw new Error(`Could not load content approvals: ${error.message}`);
  const rows = (items ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const itemIds = rows.map((row) => row.id as string);
  const versionIds = rows.map((row) => row.current_version_id).filter(Boolean) as string[];

  const [{ data: versions }, { data: decisions }, { data: comments }] = await Promise.all([
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
  ]);

  const versionsById = new Map((versions ?? []).map((v) => [(v as { id: string }).id, v as Record<string, unknown>]));
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

  return rows.map((row) => {
    const version = row.current_version_id
      ? versionsById.get(row.current_version_id as string) ?? null
      : null;
    const decision = latestDecisionByItem.get(row.id as string) ?? null;
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
      commentCount: commentCounts.get(row.id as string) ?? 0,
    };
  });
}
