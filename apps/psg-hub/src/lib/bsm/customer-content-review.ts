import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

const DECISION_STATUS: Record<"approve" | "decline" | "request_updates", string> = {
  approve: "approved",
  decline: "declined",
  request_updates: "updates_requested",
};

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
  comments: Array<{ id: string; body: string; authorProfileId: string; createdAt: string }>;
  decisions: Array<{ id: string; decision: string; message: string | null; createdAt: string }>;
  versions: Array<{ id: string; versionNumber: number; label: string | null; createdAt: string }>;
  restoreRequests: Array<{ id: string; requestedVersionId: string; reason: string; status: string; createdAt: string }>;
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

  const [{ data: versions }, { data: comments }, { data: decisions }, { data: restoreRequests }] = await Promise.all([
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
  ]);

  const rows = (versions ?? []) as Array<Record<string, unknown>>;
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
) {
  const text = cleanText(body, "Comment", 2000);
  const { item } = await requireCustomerAccess(client, reviewItemId, userId);
  const service = createServiceClient();
  const { data, error } = await service
    .from("bsm_content_review_comments")
    .insert({
      review_item_id: item.id,
      shop_id: item.shop_id,
      version_id: item.current_version_id,
      author_profile_id: userId,
      body: text,
      visibility: "shop_and_psg",
    })
    .select("id, body, created_at")
    .single();
  if (error) throw new BsmCustomerReviewError(500, error.message);
  return data;
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
  return data;
}
