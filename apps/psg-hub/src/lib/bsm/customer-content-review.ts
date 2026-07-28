import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { BSM_CONTENT_APPROVALS_BUCKET } from "@/lib/bsm/content-approvals-shared";

const DECISION_STATUS: Record<"approve" | "decline" | "request_updates", string> = {
  approve: "approved",
  decline: "declined",
  request_updates: "updates_requested",
};

export const REPLY_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const REPLY_PHOTO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SAFE_ATTACHMENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export type BsmCustomerReviewItem = {
  id: string;
  shopId: string;
  title: string;
  status: string;
  contentType: string;
  contextNote: string | null;
  currentVersionId: string | null;
  updatedAt: string;
  currentVersion: {
    id: string;
    versionNumber: number;
    originalFilename: string | null;
    storagePath: string | null;
    previewType: string | null;
    sourceMetadata: Record<string, unknown>;
    createdAt: string;
  } | null;
  comments: Array<{
    id: string;
    body: string;
    authorProfileId: string;
    createdAt: string;
    attachment: {
      id: string;
      originalFilename: string;
      contentType: string;
      byteSize: number;
      storagePath: string;
      screeningStatus: string;
    } | null;
  }>;
  decisions: Array<{ id: string; decision: string; message: string | null; createdAt: string }>;
  versions: Array<{ id: string; versionNumber: number; label: string | null; createdAt: string }>;
  restoreRequests: Array<{ id: string; requestedVersionId: string; reason: string; status: string; createdAt: string }>;
};

export type BsmCustomerReplyPhotoAttachment = {
  fileName: string;
  contentType: string;
  byteSize: number;
  bytes: ArrayBuffer | Uint8Array;
};

export class BsmCustomerReviewError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BsmCustomerReviewError";
    this.status = status;
  }
}

function cleanText(value: unknown, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BsmCustomerReviewError(400, `${label} required`);
  if (text.length > max) throw new BsmCustomerReviewError(400, `${label} must be ${max} characters or fewer`);
  return text;
}

function cleanAttachmentFileName(value: unknown): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, "-") : "";
  if (!text) throw new BsmCustomerReviewError(400, "Choose a photo before uploading");
  if (text.includes("..") || text.includes("/") || text.includes("\\") || !SAFE_ATTACHMENT_NAME_RE.test(text)) {
    throw new BsmCustomerReviewError(
      400,
      "Rename the photo using letters, numbers, dots, dashes, or underscores, then try again",
    );
  }
  return text;
}

function bytesView(bytes: ArrayBuffer | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function sniffPhotoMimeType(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function validateBsmReplyPhotoAttachment(input: BsmCustomerReplyPhotoAttachment) {
  const fileName = cleanAttachmentFileName(input.fileName);
  const declaredContentType = input.contentType.trim().toLowerCase();
  if (!REPLY_PHOTO_MIME_TYPES.has(declaredContentType)) {
    throw new BsmCustomerReviewError(400, "Only JPG, PNG, or WebP photos can be attached.");
  }
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    throw new BsmCustomerReviewError(400, "The attached photo is empty.");
  }
  if (input.byteSize > REPLY_PHOTO_MAX_BYTES) {
    throw new BsmCustomerReviewError(400, "The photo is too large. Attach one photo under 8 MB.");
  }

  const bytes = bytesView(input.bytes);
  if (bytes.byteLength !== input.byteSize) {
    throw new BsmCustomerReviewError(400, "The attached photo could not be read. Please try again.");
  }

  const detectedContentType = sniffPhotoMimeType(bytes);
  if (!detectedContentType || detectedContentType !== declaredContentType) {
    throw new BsmCustomerReviewError(400, "This does not look like a valid JPG, PNG, or WebP photo.");
  }

  return { fileName, contentType: detectedContentType, byteSize: input.byteSize, bytes };
}

async function requireCustomerAccess(
  client: SupabaseClient,
  reviewItemId: string,
  userId: string,
): Promise<{ item: Record<string, unknown>; membership: { role: string } }> {
  const { data: item, error } = await client
    .from("bsm_content_review_items")
    .select("id, shop_id, title, status, content_type, admin_context_note, current_version_id, updated_at")
    .eq("id", reviewItemId)
    .maybeSingle();

  if (error) throw new BsmCustomerReviewError(500, error.message);
  if (!item) throw new BsmCustomerReviewError(404, "Not found");

  const { data: membership, error: membershipError } = await client
    .from("shop_users")
    .select("role")
    .eq("user_id", userId)
    .eq("shop_id", item.shop_id as string)
    .maybeSingle();

  if (membershipError) throw new BsmCustomerReviewError(500, membershipError.message);
  if (!membership) throw new BsmCustomerReviewError(403, "Forbidden");

  return { item: item as Record<string, unknown>, membership: membership as { role: string } };
}

function ownerOrManager(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function getBsmCustomerReviewItem(
  client: SupabaseClient,
  reviewItemId: string,
  userId: string,
): Promise<BsmCustomerReviewItem> {
  const { item } = await requireCustomerAccess(client, reviewItemId, userId);
  const service = createServiceClient();
  const itemId = item.id as string;

  const [{ data: versions }, { data: comments }, { data: decisions }, { data: restoreRequests }, { data: attachments }] = await Promise.all([
    service
      .from("bsm_content_review_versions")
      .select("id, version_number, original_filename, storage_path, preview_type, source_metadata_jsonb, created_at")
      .eq("review_item_id", itemId)
      .order("version_number", { ascending: false }),
    service
      .from("bsm_content_review_comments")
      .select("id, body, author_profile_id, created_at")
      .eq("review_item_id", itemId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    service
      .from("bsm_content_review_decisions")
      .select("id, decision, message, created_at")
      .eq("review_item_id", itemId)
      .order("created_at", { ascending: false }),
    service
      .from("bsm_content_restore_requests")
      .select("id, requested_version_id, reason, status, created_at")
      .eq("review_item_id", itemId)
      .order("created_at", { ascending: false }),
    service
      .from("bsm_content_review_comment_attachments")
      .select("id, comment_id, original_filename, content_type, byte_size, storage_path, screening_status")
      .eq("review_item_id", itemId),
  ]);

  const rows = (versions ?? []) as Array<Record<string, unknown>>;
  const attachmentsByCommentId = new Map(
    ((attachments ?? []) as Array<Record<string, unknown>>).map((row) => [row.comment_id as string, row]),
  );
  const currentVersion =
    rows.find((row) => row.id === item.current_version_id) ?? rows[0] ?? null;

  return {
    id: itemId,
    shopId: item.shop_id as string,
    title: item.title as string,
    status: item.status as string,
    contentType: item.content_type as string,
    contextNote: (item.admin_context_note as string | null) ?? null,
    currentVersionId: (item.current_version_id as string | null) ?? null,
    updatedAt: item.updated_at as string,
    currentVersion: currentVersion
      ? {
          id: currentVersion.id as string,
          versionNumber: currentVersion.version_number as number,
          originalFilename: (currentVersion.original_filename as string | null) ?? null,
          storagePath: (currentVersion.storage_path as string | null) ?? null,
          previewType: (currentVersion.preview_type as string | null) ?? null,
          sourceMetadata: (currentVersion.source_metadata_jsonb as Record<string, unknown> | null) ?? {},
          createdAt: currentVersion.created_at as string,
        }
      : null,
    comments: ((comments ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      body: row.body as string,
      authorProfileId: row.author_profile_id as string,
      createdAt: row.created_at as string,
      attachment: attachmentsByCommentId.has(row.id as string)
        ? {
            id: attachmentsByCommentId.get(row.id as string)?.id as string,
            originalFilename: attachmentsByCommentId.get(row.id as string)?.original_filename as string,
            contentType: attachmentsByCommentId.get(row.id as string)?.content_type as string,
            byteSize: attachmentsByCommentId.get(row.id as string)?.byte_size as number,
            storagePath: attachmentsByCommentId.get(row.id as string)?.storage_path as string,
            screeningStatus: attachmentsByCommentId.get(row.id as string)?.screening_status as string,
          }
        : null,
    })),
    decisions: ((decisions ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      decision: row.decision as string,
      message: (row.message as string | null) ?? null,
      createdAt: row.created_at as string,
    })),
    versions: rows.map((row) => ({
      id: row.id as string,
      versionNumber: row.version_number as number,
      label: (row.original_filename as string | null) ?? null,
      createdAt: row.created_at as string,
    })),
    restoreRequests: ((restoreRequests ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string,
      requestedVersionId: row.requested_version_id as string,
      reason: row.reason as string,
      status: row.status as string,
      createdAt: row.created_at as string,
    })),
  };
}

export async function addBsmCustomerReviewComment(
  client: SupabaseClient,
  reviewItemId: string,
  userId: string,
  body: unknown,
  attachment?: BsmCustomerReplyPhotoAttachment | null,
) {
  const text = typeof body === "string" && body.trim() ? cleanText(body, "Comment", 2000) : null;
  if (!text && !attachment) throw new BsmCustomerReviewError(400, "Comment or photo required");
  const { item } = await requireCustomerAccess(client, reviewItemId, userId);
  const service = createServiceClient();
  const photo = attachment ? validateBsmReplyPhotoAttachment(attachment) : null;
  const commentId = randomUUID();
  const attachmentId = photo ? randomUUID() : null;
  const attachmentPath =
    photo && attachmentId
      ? `${item.shop_id as string}/${item.id as string}/comments/${commentId}/${attachmentId}/${photo.fileName}`
      : null;

  if (photo && attachmentPath) {
    const { error: uploadError } = await service.storage
      .from(BSM_CONTENT_APPROVALS_BUCKET)
      .upload(attachmentPath, photo.bytes, {
        contentType: photo.contentType,
        upsert: false,
      });
    if (uploadError) throw new BsmCustomerReviewError(500, `Could not upload photo: ${uploadError.message}`);
  }

  const { data, error } = await service
    .from("bsm_content_review_comments")
    .insert({
      id: commentId,
      review_item_id: item.id,
      shop_id: item.shop_id,
      version_id: item.current_version_id,
      author_profile_id: userId,
      body: text ?? "Photo attached.",
      visibility: "shop_and_psg",
    })
    .select("id, body, created_at")
    .single();
  if (error) throw new BsmCustomerReviewError(500, error.message);

  if (photo && attachmentId && attachmentPath) {
    const { error: attachmentError } = await service.from("bsm_content_review_comment_attachments").insert({
      id: attachmentId,
      shop_id: item.shop_id,
      review_item_id: item.id,
      comment_id: commentId,
      version_id: item.current_version_id,
      uploader_profile_id: userId,
      storage_bucket: BSM_CONTENT_APPROVALS_BUCKET,
      storage_path: attachmentPath,
      original_filename: photo.fileName,
      content_type: photo.contentType,
      byte_size: photo.byteSize,
      screening_status: "passed_basic_screen",
    });
    if (attachmentError) throw new BsmCustomerReviewError(500, attachmentError.message);
  }

  const { error: eventError } = await service.from("bsm_content_review_events").insert({
    shop_id: item.shop_id,
    review_item_id: item.id,
    version_id: item.current_version_id,
    event_type: "comment_created",
    actor_profile_id: userId,
    payload_jsonb: {
      commentId: data.id,
      visibility: "shop_and_psg",
      attachmentId,
      attachmentScreeningStatus: photo ? "passed_basic_screen" : null,
    },
  });
  if (eventError) throw new BsmCustomerReviewError(500, eventError.message);
  return {
    ...data,
    attachment: photo && attachmentId && attachmentPath
      ? {
          id: attachmentId,
          originalFilename: photo.fileName,
          contentType: photo.contentType,
          byteSize: photo.byteSize,
          storagePath: attachmentPath,
          screeningStatus: "passed_basic_screen",
        }
      : null,
  };
}

export async function recordBsmCustomerReviewDecision(
  client: SupabaseClient,
  reviewItemId: string,
  userId: string,
  decision: unknown,
  message: unknown,
) {
  if (decision !== "approve" && decision !== "decline" && decision !== "request_updates") {
    throw new BsmCustomerReviewError(400, "Unsupported decision");
  }
  const note = typeof message === "string" && message.trim() ? message.trim().slice(0, 2000) : null;
  const { item, membership } = await requireCustomerAccess(client, reviewItemId, userId);
  if (!ownerOrManager(membership.role)) throw new BsmCustomerReviewError(403, "Forbidden");
  if (!item.current_version_id) throw new BsmCustomerReviewError(409, "No current version to review");

  const service = createServiceClient();
  const { data, error } = await service
    .from("bsm_content_review_decisions")
    .insert({
      review_item_id: item.id,
      shop_id: item.shop_id,
      version_id: item.current_version_id,
      decision,
      message: note,
      actor_profile_id: userId,
      actor_role: "customer",
    })
    .select("id, decision, message, created_at")
    .single();
  if (error) throw new BsmCustomerReviewError(500, error.message);

  const { error: updateError } = await service
    .from("bsm_content_review_items")
    .update({ status: DECISION_STATUS[decision], updated_at: new Date().toISOString() })
    .eq("id", item.id)
    .eq("shop_id", item.shop_id);
  if (updateError) throw new BsmCustomerReviewError(500, updateError.message);

  const { error: eventError } = await service.from("bsm_content_review_events").insert({
    shop_id: item.shop_id,
    review_item_id: item.id,
    version_id: item.current_version_id,
    event_type: "decision_recorded",
    actor_profile_id: userId,
    payload_jsonb: { decisionId: data.id, decision, actorRole: "customer" },
  });
  if (eventError) throw new BsmCustomerReviewError(500, eventError.message);

  return data;
}

export async function requestBsmContentRestore(
  client: SupabaseClient,
  reviewItemId: string,
  userId: string,
  versionId: unknown,
  reason: unknown,
) {
  const requestedVersionId = cleanText(versionId, "Version", 80);
  const text = cleanText(reason, "Reason", 1000);
  const { item, membership } = await requireCustomerAccess(client, reviewItemId, userId);
  if (!ownerOrManager(membership.role)) throw new BsmCustomerReviewError(403, "Forbidden");

  const service = createServiceClient();
  const { data: version, error: versionError } = await service
    .from("bsm_content_review_versions")
    .select("id")
    .eq("id", requestedVersionId)
    .eq("review_item_id", item.id as string)
    .maybeSingle();
  if (versionError) throw new BsmCustomerReviewError(500, versionError.message);
  if (!version) throw new BsmCustomerReviewError(404, "Version not found");

  const { data, error } = await service
    .from("bsm_content_restore_requests")
    .insert({
      review_item_id: item.id,
      shop_id: item.shop_id,
      requested_version_id: requestedVersionId,
      requester_profile_id: userId,
      reason: text,
      status: "pending",
    })
    .select("id, requested_version_id, reason, status, created_at")
    .single();
  if (error) throw new BsmCustomerReviewError(500, error.message);
  const { error: eventError } = await service.from("bsm_content_review_events").insert({
    shop_id: item.shop_id,
    review_item_id: item.id,
    version_id: requestedVersionId,
    event_type: "restore_requested",
    actor_profile_id: userId,
    payload_jsonb: { restoreRequestId: data.id, requestedVersionId },
  });
  if (eventError) throw new BsmCustomerReviewError(500, eventError.message);
  return data;
}
