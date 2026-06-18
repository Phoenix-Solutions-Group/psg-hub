// Survey EMI conversion helpers (v1.1 / PSG-36). Centralizes the one piece of
// schema coordination that is easy to get wrong: survey_responses.scale_emi_pct
// is stored as a 0..1 FRACTION (column is numeric(7,6)), while the
// network_summary / shop_detail / network_trend SQL functions multiply by 100
// for display and compare against an 88% alert threshold. The UI works in human
// percentages (0..100), so all entry/display must round-trip through here.

/** Human percentage (0..100) → stored 0..1 fraction. null passes through. */
export function emiPctToFraction(pct: number | null | undefined): number | null {
  if (pct == null) return null;
  return pct / 100;
}

/** Stored 0..1 fraction → display percentage string, 1dp. */
export function formatEmi(fraction: number | null | undefined): string {
  if (fraction == null) return "—";
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Survey columns returned by the API + ops pages. */
export const SURVEY_SELECT =
  "id, shop_name, survey_date, scale_emi_pct, q05_01, q05_02, q05_03, q05_04, text_customer_comments, source, response_id, created_at" as const;

/**
 * q05_01..q05_04 sub-score → label mapping (per public.shop_detail):
 * quality / cleanliness / communication / courtesy.
 */
export const SURVEY_SCORE_FIELDS = [
  { key: "quality", column: "q05_01", label: "Quality" },
  { key: "cleanliness", column: "q05_02", label: "Cleanliness" },
  { key: "communication", column: "q05_03", label: "Communication" },
  { key: "courtesy", column: "q05_04", label: "Courtesy" },
] as const;
