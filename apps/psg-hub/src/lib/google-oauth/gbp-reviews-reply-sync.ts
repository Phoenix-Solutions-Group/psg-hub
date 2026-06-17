import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeLastError } from "@/lib/google-ads/sanitize";
import { GoogleApiError, mapGoogleApiError } from "./client";
import { markAccountError } from "./accounts";
import { publishReply, type GbpReplyDeps } from "./gbp-reviews-reply";

/**
 * GBP reply-publish orchestrator (Phase 14 / 14-02). Consumes APPROVED review_responses and PUTs
 * the draft to Google v4 updateReply, tracking the lifecycle ON each row (NO ledger — the per-row
 * publish_status/publish_error/publish_attempts ARE the audit). Structural sibling of the 14-01
 * ingest orchestrator, but row-driven (review_responses) rather than account-driven.
 *
 * BUILD-LOCAL: the only invokers are unit tests (injected publishReply) and the UNSCHEDULED publish
 * cron. Live publish is gated behind the consent/authorization decision (14-RESEARCH §Policy).
 *
 * Dirty-publish: a row is published when status='approved' AND (published_version IS NULL OR
 * published_version < version) — so an edited+re-approved reply (version bumped) re-posts the
 * latest text (updateReply is an upsert, so re-posting is safe). The col<col dirty test is not a
 * PostgREST filter, so it is applied in JS after the approved/non-publishing fetch.
 *
 * No pre-claim lock: at pilot scale on an unscheduled cron, concurrent double-posting is not a
 * concern and updateReply's upsert makes a double-post idempotent. Concurrency hardening (a claim
 * state / max-attempts cap) is deferred. publish_attempts is read-modify-write (no PostgREST
 * expression update) — exact under single-run, fine at this scale.
 */

export type ReplySyncResult = {
  published: number; // submitted to Google (published or pending-moderation)
  skipped: number; // not dirty, not a gbp v4 review, or empty draft
  failed: number; // moderation-rejected or a thrown publish error
};

export type GbpReviewsReplySyncOptions = {
  /** Test seam for the per-row publish. */
  publishReply?: typeof publishReply;
  /** Passed through to the real publishReply (deps seam). */
  replyDeps?: GbpReplyDeps;
};

type EmbeddedReviewItem = {
  shop_id: string;
  external_review_id: string | null;
};

type ApprovedRow = {
  id: string;
  draft_text: string | null;
  version: number;
  published_version: number | null;
  publish_attempts: number;
  review_items: EmbeddedReviewItem | EmbeddedReviewItem[] | null;
};

/** PostgREST may return a to-one embed as an object or a single-element array — normalize. */
function embeddedReviewItem(row: ApprovedRow): EmbeddedReviewItem | null {
  const ri = row.review_items;
  return Array.isArray(ri) ? (ri[0] ?? null) : ri;
}

/**
 * Map the output-only reviewReplyState to our publish_status. There is no dedicated
 * reviewReplyState column; PENDING (pending Google moderation) is NOT reported as 'published'
 * (AC-3), REJECTED is a moderation failure, everything else (APPROVED / UNSPECIFIED / absent) is
 * published.
 */
function statusForState(
  state: string | null
): "published" | "publishing" | "publish_failed" {
  if (state === "PENDING") return "publishing";
  if (state === "REJECTED") return "publish_failed";
  return "published";
}

/** Resolve the shop's linked gbp account id (only needed on the auth_failed flip path). */
async function gbpAccountId(
  service: SupabaseClient,
  shopId: string
): Promise<string | null> {
  const { data } = await service
    .from("google_oauth_accounts")
    .select("id")
    .eq("shop_id", shopId)
    .eq("source", "gbp")
    .eq("status", "linked")
    .order("linked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function syncGbpReviewReplies(
  service: SupabaseClient,
  options: GbpReviewsReplySyncOptions = {}
): Promise<ReplySyncResult> {
  const publish = options.publishReply ?? publishReply;
  const result: ReplySyncResult = { published: 0, skipped: 0, failed: 0 };

  const { data: rows, error } = await service
    .from("review_responses")
    .select(
      "id, draft_text, version, published_version, publish_attempts, review_items!inner(shop_id, external_review_id)"
    )
    .eq("status", "approved")
    .neq("publish_status", "publishing");
  if (error) {
    throw new Error(`review_responses read failed: ${error.message}`);
  }

  for (const row of (rows ?? []) as ApprovedRow[]) {
    const dirty =
      row.published_version === null || row.published_version < row.version;
    if (!dirty) {
      result.skipped += 1;
      continue;
    }

    const reviewItem = embeddedReviewItem(row);
    const externalReviewId = reviewItem?.external_review_id ?? null;
    const shopId = reviewItem?.shop_id ?? null;
    const comment = (row.draft_text ?? "").trim();
    // A Places-only row (no v4 review name) or an empty draft cannot post a gbp reply.
    if (!externalReviewId || !shopId || comment.length === 0) {
      result.skipped += 1;
      continue;
    }

    try {
      const { reviewReplyState } = await publish(
        shopId,
        externalReviewId,
        comment,
        options.replyDeps
      );
      const publish_status = statusForState(reviewReplyState);
      const now = new Date().toISOString();
      // Optimistic: record only if the row hasn't moved on. A concurrent edit bumps version, so
      // the guard misses, published_version stays behind, and the newer text re-posts next run.
      await service
        .from("review_responses")
        .update({
          publish_status,
          published_version: row.version,
          published_at: now,
          external_reply_updated_at: now,
          publish_error:
            publish_status === "publish_failed" ? "moderation_rejected" : null,
        })
        .eq("id", row.id)
        .eq("version", row.version);
      if (publish_status === "publish_failed") result.failed += 1;
      else result.published += 1;
    } catch (rowError) {
      result.failed += 1;
      const mapped =
        rowError instanceof GoogleApiError
          ? rowError
          : mapGoogleApiError(rowError);
      // auth_failed = a dead token → flip the shared gbp account (needs re-link). An unverified-
      // location WRITE rejection should map to bad_request (FAILED_PRECONDITION→400) and NOT flip;
      // whether unverified surfaces as 400 vs 403 is the deferred gate-batch live-smoke (mirrors
      // the 14-01 AC-2 DRIFT).
      if (mapped.code === "auth_failed") {
        const accountId = await gbpAccountId(service, shopId);
        if (accountId) await markAccountError(accountId, mapped.message);
      }
      // Permanent failures (bad_request: unverified/oversize; auth_failed: needs re-link) pin
      // published_version so they do not auto-retry; transient ones (rate/timeout/upstream) leave
      // it behind to retry next run.
      const permanent =
        mapped.code === "bad_request" || mapped.code === "auth_failed";
      await service
        .from("review_responses")
        .update({
          publish_status: "publish_failed",
          publish_error: sanitizeLastError(mapped.message),
          publish_attempts: row.publish_attempts + 1,
          ...(permanent ? { published_version: row.version } : {}),
        })
        .eq("id", row.id);
    }
  }

  return result;
}
