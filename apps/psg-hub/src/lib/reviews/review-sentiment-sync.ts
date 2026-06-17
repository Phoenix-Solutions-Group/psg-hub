import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logLLMCall } from "@/lib/logging/llm-call";
import {
  classifyReviewSentiment,
  gatewayClassify,
  SENTIMENT_MODEL,
  type ClassifyFn,
} from "./sentiment";
import { SENTIMENT_PROMPT_VERSION } from "./sentiment-prompt";

/**
 * Phase 14 / 14-03 — Sentiment classify-on-ingest orchestrator. Selects review_items that
 * need (re)classification, runs the Haiku classifier per row with contained failure, and
 * upserts one review_sentiment row per review. NO ledger (per-row review_sentiment columns +
 * llm_call_log are the audit) and NO source-CHECK widen — purpose is free-text.
 *
 * Called AFTER syncGbpReviews in the gbp-reviews-sync cron (the primary trigger); the first
 * post-deploy run sweeps all pre-existing unclassified rows (the one-shot backfill).
 */

export type SentimentSyncResult = {
  classified: number;
  skipped: number; // candidates fetched but already current (dirty-key miss)
  failed: number; // rows whose classify/upsert threw (contained)
};

export type ClassifyPendingOptions = {
  /** Max rows to classify in one run (drains the backfill over runs). */
  limit?: number;
  /** Test seam for the model call (mirrors gbp-reviews-sync's fetchReviews seam). */
  generate?: ClassifyFn;
  /** Model override (defaults to SENTIMENT_MODEL). */
  model?: string;
};

const DEFAULT_BATCH = 200;
// ponytail: coarse fetch window — col<col dirty-key can't be a PostgREST filter, so we
// fetch the newest review_items and filter in JS. At fleet scale (842 shops, deep history)
// the precise "where stale or unclassified" query is a DB view/rpc upgrade; build-local +
// the daily cron draining newest-first is correct for the pilot.
const FETCH_CAP = 1000;

type SentimentEmbed = {
  prompt_version: string | null;
  classified_updated_at: string | null;
  version: number | null;
};

type CandidateRow = {
  id: string;
  shop_id: string;
  text: string | null;
  rating: number | null;
  updated_at: string | null;
  review_sentiment: SentimentEmbed | SentimentEmbed[] | null;
};

/** PostgREST returns a reverse (to-one via UNIQUE) embed as an object or a single-element array. */
function existingSentiment(row: CandidateRow): SentimentEmbed | null {
  const s = row.review_sentiment;
  if (!s) return null;
  return Array.isArray(s) ? s[0] ?? null : s;
}

/**
 * Needs (re)classification if: no sentiment row, OR the prompt version changed, OR the review
 * was edited after it was classified (review_items.updated_at > classified_updated_at — the
 * 14-01 updateTime dirty-key). A null review_items.updated_at can only be classified once.
 */
function needsClassify(row: CandidateRow, existing: SentimentEmbed | null): boolean {
  if (!existing) return true;
  if (existing.prompt_version !== SENTIMENT_PROMPT_VERSION) return true;
  if (
    row.updated_at &&
    existing.classified_updated_at &&
    row.updated_at > existing.classified_updated_at // ISO strings, same source format
  ) {
    return true;
  }
  return false;
}

export async function classifyPendingSentiment(
  service: SupabaseClient,
  options: ClassifyPendingOptions = {}
): Promise<SentimentSyncResult> {
  const generate = options.generate ?? gatewayClassify;
  const model = options.model ?? SENTIMENT_MODEL;
  const limit = options.limit ?? DEFAULT_BATCH;
  const result: SentimentSyncResult = { classified: 0, skipped: 0, failed: 0 };

  const { data, error } = await service
    .from("review_items")
    .select(
      "id, shop_id, text, rating, updated_at, review_sentiment(prompt_version, classified_updated_at, version)"
    )
    .not("text", "is", null)
    .order("updated_at", { ascending: false })
    .limit(FETCH_CAP);
  if (error) {
    throw new Error(`review_items read failed: ${error.message}`);
  }

  const rows = (data ?? []) as CandidateRow[];
  const pending: { row: CandidateRow; existing: SentimentEmbed | null }[] = [];
  for (const row of rows) {
    if (!row.text) continue; // defensive — the filter already excludes null text
    const existing = existingSentiment(row);
    if (needsClassify(row, existing)) pending.push({ row, existing });
    else result.skipped += 1;
  }

  for (const { row, existing } of pending.slice(0, limit)) {
    try {
      const sentiment = await classifyReviewSentiment(
        { text: row.text as string, rating: row.rating },
        {
          generate,
          model,
          logCall: (e) =>
            logLLMCall({
              purpose: "review_sentiment_classify",
              userId: null,
              shopId: row.shop_id,
              reviewId: row.id,
              modelId: e.modelId,
              inputTokens: e.inputTokens,
              outputTokens: e.outputTokens,
              result: e.result,
            }),
        }
      );

      const { error: upErr } = await service
        .from("review_sentiment")
        .upsert(
          {
            review_item_id: row.id,
            shop_id: row.shop_id,
            polarity: sentiment.polarity,
            confidence: sentiment.confidence,
            themes: sentiment.themes,
            actionable_complaint: sentiment.actionable_complaint,
            raw: sentiment,
            model_id: model,
            prompt_version: SENTIMENT_PROMPT_VERSION,
            version: (existing?.version ?? 0) + 1,
            classified_updated_at: row.updated_at,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "review_item_id" }
        );
      if (upErr) {
        throw new Error(`review_sentiment upsert failed: ${upErr.message}`);
      }
      result.classified += 1;
    } catch (rowError) {
      // Contained: one row's failure never aborts the batch (classifyReviewSentiment
      // already logged result='error' via the injected logCall before rethrowing).
      result.failed += 1;
      console.error(
        `[review-sentiment-sync] review ${row.id} failed: ${
          rowError instanceof Error ? rowError.message : String(rowError)
        }`
      );
    }
  }

  return result;
}
