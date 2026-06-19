// v1.4 / PSG-89 — Survey attribution + response-rate/recommend computations.
//
// The data-model foundation (20260618200000_survey_attribution_v1_4) adds the
// joins the remaining 5 Survey & CSI reports need:
//   survey_responses.repair_order_id → repair_orders
//   repair_order_employees(role)     → employees   (estimator / body_tech / painter)
//   survey_dispatches                → surveys_sent (response-rate denominator)
//   survey_responses.would_recommend → recommend rate
//
// These are the pure, deterministic aggregations each report applies once it has
// fetched its joined rows. Keeping them here (SQL-agnostic, unit-tested against a
// plain row shape) means wiring the reports in PSG-80 is "fetch joined rows + call
// a helper", and the attribution math is verified independently of the DB. CSI
// convention matches survey.ts: CSI = avg(scale_emi_pct) × 100 (EMI is a 0..1
// fraction). All rates are returned as display percentages (0..100, 1dp) or null.

/** Coerce a numeric|string|null cell to a finite number, or null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Round to 1 decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Average of defined numeric values, or null when none are defined. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Response rate (performance-dashboard) = returned / sent, as a display %.
 * `sent` comes from survey_dispatches, `returned` from survey_responses.
 * null when nothing was sent (avoid divide-by-zero).
 */
export function responseRatePct(returned: number, sent: number): number | null {
  if (sent <= 0) return null;
  return round1((returned / sent) * 100);
}

/**
 * "Would Recommend" rate = recommends / answered, as a display %. Rows where
 * would_recommend is null (unanswered) are excluded from the denominator.
 * null when no one answered.
 */
export function recommendRatePct(
  rows: readonly { would_recommend: boolean | null }[],
): number | null {
  let answered = 0;
  let yes = 0;
  for (const r of rows) {
    if (r.would_recommend == null) continue;
    answered += 1;
    if (r.would_recommend) yes += 1;
  }
  if (answered === 0) return null;
  return round1((yes / answered) * 100);
}

/** A survey row carrying an EMI score plus the attribution key to group by. */
export type AttributedSurvey = {
  key: string | null; // estimator / tech / painter name (or id)
  scale_emi_pct: number | string | null;
};

export type CsiGroup = { key: string; surveys: number; csi: number | null };

/**
 * Group surveys by attribution key (estimator-csi / body-tech / painter CSI):
 * survey count + CSI (= avg EMI × 100). Survey count is tracked separately from
 * the EMI sample so a missing score never deflates the count. Rows with a null
 * key are dropped (unattributed). Sorted by key ascending.
 */
export function csiByAttribution(rows: AttributedSurvey[]): CsiGroup[] {
  const groups = new Map<string, { surveys: number; emis: number[] }>();
  for (const r of rows) {
    const key = (r.key ?? "").trim();
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { surveys: 0, emis: [] };
      groups.set(key, g);
    }
    g.surveys += 1;
    const emi = num(r.scale_emi_pct);
    if (emi !== null) g.emis.push(emi);
  }
  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, g]) => {
      const avg = mean(g.emis);
      return { key, surveys: g.surveys, csi: avg === null ? null : round1(avg * 100) };
    });
}

/**
 * Rework rate over jobs, as a display % — the body-tech "comeback rate" and
 * painter "redo rate" (same computation, different role). null when no jobs.
 */
export function reworkRatePct(
  rows: readonly { rework: boolean }[],
): number | null {
  if (rows.length === 0) return null;
  const rework = rows.reduce((n, r) => n + (r.rework ? 1 : 0), 0);
  return round1((rework / rows.length) * 100);
}
