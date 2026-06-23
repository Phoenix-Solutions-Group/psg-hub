// v1.6 / 16-02 — Nightly competitor-scoring orchestrator.
// One run = re-score every shop's competitor set and upsert competitor_scores
// (idempotent on competitor_id). This is the BUILD-LOCAL pass: it scores competitors
// already persisted in `competitors`. Live discovery of NEW competitors (web_grounded via
// the router, or Yext) is the G5-gated step wired separately in discovery.ts — scoring
// itself spends nothing, so the nightly cron is safe to run before G5 clears (it just
// scores whatever rows exist). A single shop's failure is contained; the batch continues.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreShopCompetitors } from "./scoring";
import type {
  Competitor,
  CompetitorScore,
  CompetitorType,
  CompetitorSource,
  ShopContext,
} from "./types";

export const MODEL_VERSION = "competitor-engine-v1";

export type CompetitorScoringResult = {
  shopsProcessed: number;
  competitorsScored: number;
  failed: number;
};

type ShopRow = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  search_radius_miles: number | null;
};

type CompetitorRow = {
  id: string;
  shop_id: string;
  name: string;
  type: string | null;
  consolidator_group: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_miles: number | null;
  rating: number | null;
  review_count: number | null;
  website: string | null;
  source: string | null;
};

/** Pure row → domain mapper (exported for tests). */
export function rowToCompetitor(row: CompetitorRow): Competitor {
  return {
    id: row.id,
    shopId: row.shop_id,
    name: row.name,
    type: (row.type as CompetitorType) ?? "independent",
    consolidatorGroup: row.consolidator_group,
    latitude: row.latitude,
    longitude: row.longitude,
    distanceMiles: row.distance_miles == null ? null : Number(row.distance_miles),
    rating: row.rating == null ? null : Number(row.rating),
    reviewCount: row.review_count,
    website: row.website,
    source: (row.source as CompetitorSource) ?? "manual",
  };
}

function rowToShop(row: ShopRow): ShopContext {
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    searchRadiusMiles: row.search_radius_miles,
  };
}

/** Pure domain → upsert-row mapper (exported for tests). */
export function scoreToRow(score: CompetitorScore, scoredAt: string) {
  return {
    competitor_id: score.competitorId,
    shop_id: score.shopId,
    threat_score: score.threatScore,
    proximity_score: score.proximityScore,
    presence_score: score.presenceScore,
    consolidator_weight: score.consolidatorWeight,
    rank: score.rank,
    rationale: score.rationale,
    model_version: MODEL_VERSION,
    scored_at: scoredAt,
    updated_at: scoredAt,
  };
}

export type SyncOptions = {
  /** Injectable "now" (ISO) so the scored_at stamp stays out of callers' render paths. */
  now?: string;
};

const COMPETITOR_SELECT =
  "id, shop_id, name, type, consolidator_group, latitude, longitude, distance_miles, rating, review_count, website, source";

/**
 * Re-score ONE shop's competitor set against a pre-loaded shop row and upsert the results
 * (idempotent on competitor_id). Service-role client (RLS bypassed); every read/write is
 * clamped to `shopRow.id`, so this never touches another tenant's rows. Pure-scoring + one
 * upsert = zero vendor spend. Returns the number of competitors scored (0 when the shop has
 * none). Throws on a DB read/upsert error so callers can contain per-shop failures.
 *
 * Shared by the nightly all-shops `syncCompetitorScores` loop and the per-shop monitor
 * (PSG-226), so the scoring/upsert path is written exactly once.
 */
export async function scoreShopRow(
  service: SupabaseClient,
  shopRow: ShopRow,
  scoredAt: string,
): Promise<{ competitorsScored: number }> {
  const { data: compRows, error: compErr } = await service
    .from("competitors")
    .select(COMPETITOR_SELECT)
    .eq("shop_id", shopRow.id);
  if (compErr) throw new Error(compErr.message);

  const competitors = ((compRows ?? []) as CompetitorRow[]).map(rowToCompetitor);
  if (competitors.length === 0) return { competitorsScored: 0 };

  const scores = scoreShopCompetitors(competitors, rowToShop(shopRow));
  const rows = scores.map((s) => scoreToRow(s, scoredAt));

  const { error: upsertErr } = await service
    .from("competitor_scores")
    .upsert(rows, { onConflict: "competitor_id" });
  if (upsertErr) throw new Error(upsertErr.message);

  return { competitorsScored: scores.length };
}

/**
 * Re-score one shop by id: load that shop's row (tenant-scoped to `shopId`), then delegate to
 * `scoreShopRow`. Service-role client (RLS bypassed). Used by the per-shop monitor (PSG-226)
 * to refresh scores immediately before generating that shop's report. Throws if the shop is
 * missing or a DB read fails.
 */
export async function scoreShopById(
  service: SupabaseClient,
  shopId: string,
  opts: SyncOptions = {},
): Promise<{ competitorsScored: number }> {
  const scoredAt = opts.now ?? new Date().toISOString();
  const { data: shopRows, error: shopErr } = await service
    .from("shops")
    .select("id, latitude, longitude, search_radius_miles")
    .eq("id", shopId)
    .limit(1);
  if (shopErr) throw new Error(`[competitor-scoring] shop ${shopId} load failed: ${shopErr.message}`);
  const shopRow = ((shopRows ?? []) as ShopRow[])[0];
  if (!shopRow) throw new Error(`[competitor-scoring] shop ${shopId} not found`);
  return scoreShopRow(service, shopRow, scoredAt);
}

/**
 * Re-score all competitors for all shops and upsert the results. Service-role client
 * (RLS bypassed). Returns a per-run summary.
 */
export async function syncCompetitorScores(
  service: SupabaseClient,
  opts: SyncOptions = {},
): Promise<CompetitorScoringResult> {
  const scoredAt = opts.now ?? new Date().toISOString();

  const { data: shops, error: shopsErr } = await service
    .from("shops")
    .select("id, latitude, longitude, search_radius_miles");
  if (shopsErr) {
    throw new Error(`[competitor-scoring] shop load failed: ${shopsErr.message}`);
  }

  let competitorsScored = 0;
  let failed = 0;
  let shopsProcessed = 0;

  for (const shopRow of (shops ?? []) as ShopRow[]) {
    try {
      const { competitorsScored: n } = await scoreShopRow(service, shopRow, scoredAt);
      competitorsScored += n;
      shopsProcessed += 1;
    } catch (err) {
      // Contain the shop's failure; the rest of the fleet still gets scored.
      failed += 1;
      console.error(
        `[competitor-scoring] shop ${shopRow.id} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { shopsProcessed, competitorsScored, failed };
}
