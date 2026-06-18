import type { SupabaseClient } from "@supabase/supabase-js";

// Phase 14 / 14-03b — shared read-side aggregate over review_sentiment (14-03 writes it
// via the Haiku classify-on-ingest). Consumed by the analytics dashboard panel AND the
// monthly report sentiment block. Pure + deps-light (NO "server-only") so it is node-testable
// with a fake Supabase builder; the caller passes the RLS-clamped (user-session) or service
// client. Per-shop only — an MSO cross-shop theme blend is noise (same rule as gbp_presence).

export type SentimentSummary = {
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  actionableOpen: number; // rows flagged actionable_complaint
  avgConfidence: number | null; // mean over rows that carry a numeric confidence
  topThemes: { theme: string; count: number }[];
};

type SentimentRow = {
  polarity: string | null;
  confidence: number | null;
  themes: string[] | null;
  actionable_complaint: boolean | null;
};

// ponytail: per-shop fetch cap + JS aggregation — correct for the pilot. At fleet scale
// (842 shops, deep history) the precise counts move to a DB rollup (rpc/view); this caps
// the read and tallies in memory, the same shape the 14-03 sync uses.
const FETCH_CAP = 2000;
const TOP_THEMES = 6;

/** First day of the month AFTER `month` ('YYYY-MM' -> 'YYYY-MM-01'), December rolls the year. */
function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export function summarizeSentiment(rows: SentimentRow[]): SentimentSummary {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let actionableOpen = 0;
  let confSum = 0;
  let confN = 0;
  const themeCounts = new Map<string, number>();

  for (const r of rows) {
    if (r.polarity === "positive") positive += 1;
    else if (r.polarity === "neutral") neutral += 1;
    else if (r.polarity === "negative") negative += 1;
    if (r.actionable_complaint) actionableOpen += 1;
    if (typeof r.confidence === "number") {
      confSum += r.confidence;
      confN += 1;
    }
    for (const t of r.themes ?? []) {
      if (t && t.trim()) themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    }
  }

  const topThemes = [...themeCounts.entries()]
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme))
    .slice(0, TOP_THEMES);

  return {
    total: rows.length,
    positive,
    neutral,
    negative,
    actionableOpen,
    avgConfidence: confN > 0 ? confSum / confN : null,
    topThemes,
  };
}

/**
 * Aggregate one shop's review sentiment. With `month` ('YYYY-MM') the count is scoped to that
 * report month via the review_items.reviewed_at join (the report block); without it the count is
 * the shop's full classified history (the dashboard panel). RLS clamps the read to the caller's
 * shops; the explicit shop_id eq narrows within that set.
 */
export async function getReviewSentimentSummary(
  client: SupabaseClient,
  { shopId, month }: { shopId: string; month?: string }
): Promise<SentimentSummary> {
  let query = client
    .from("review_sentiment")
    .select(
      month
        ? "polarity, confidence, themes, actionable_complaint, review_items!inner(reviewed_at)"
        : "polarity, confidence, themes, actionable_complaint"
    )
    .eq("shop_id", shopId);

  if (month) {
    query = query
      .gte("review_items.reviewed_at", `${month}-01`)
      .lt("review_items.reviewed_at", nextMonthStart(month));
  }

  const { data, error } = await query.limit(FETCH_CAP);
  if (error) {
    throw new Error(`review_sentiment read failed: ${error.message}`);
  }
  return summarizeSentiment((data ?? []) as unknown as SentimentRow[]);
}
