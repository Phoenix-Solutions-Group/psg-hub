// v1.4 / PSG-28 — Operational Reports: live (B1-backed) data functions for the
// Individual Survey Responses batch (PSG-49). Fast-follow to the Survey & CSI
// batch (PSG-80, ./survey.ts) — same "fetch rows → group/filter in JS" shape,
// db-injected and unit-testable against a plain stub.
//
// These reports read survey_responses at the INDIVIDUAL-RESPONSE grain (not the
// per-shop/month aggregation the CSI batch uses), plus — for the referral views
// — the spine edges the survey's repair_order_id resolves to:
//   survey_responses → repair_orders → insurance_companies / insurance_agents
//                                     → repair_customers (name) / repair_order_employees(role → employees.name)
// fetched via PostgREST embedded selects (repair_order_id is a single FK off
// survey_responses, so the embed is unambiguous), then filtered/grouped in JS.
//
// PII guard (critical for this batch — these are ROW-LEVEL survey reports):
// survey_responses.text_customer_comments and .raw_payload carry free-text /
// untyped customer content, and repair_customers.phone/email/address are PII.
// NONE of those are ever selected or output. We select only non-PII columns
// (the EMI/sub-scores, shop, date, response/ro reference) plus the customer's
// NAME (first/last only — the same name-only disclosure the shipped Customer &
// Insurance batch makes; see ./customer-insurance.ts). This mirrors how
// ./survey.ts restricts its SURVEY_SELECT to non-PII columns.
//
// Honest-source discipline (documented in registry.ts + ./customer-insurance.ts —
// a column is wired only when it has a REAL source; otherwise the report stays
// pending-data, never fabricated):
//
//   • perfect-score / mis-fire / hot-spot are pure survey-score filters over real
//     columns — scale_emi_pct (0..1 fraction, displayed ×100, 88% alert line) and
//     the q05_01..04 sub-scores (native 0..10 scale; the 88% line is 8.8 here).
//   • referral-noted / referral-comparison derive the referral CATEGORY from the
//     spine insurer/agent edges (Insurance Agent → agent, else Insurance Company →
//     insurer, else Direct) — the SAME derivation the shipped referral-directory
//     report (Customer & Insurance batch) uses. A free-form, customer-NAMED
//     referral field does not exist on survey_responses or the spine, so "Source
//     Named" surfaces the resolved agent/insurer name (the verifiable referral
//     edge), not an invented free-text value.
//   • unresolved-issue stays pending-data: it needs an issue description + a
//     logged-resolution state + days-open, and survey_responses carries no
//     resolution / service-recovery tracking and no typed issue field (only the
//     PII free-text comment). No honest source exists yet — see PSG-49 thread.
//
// Date scoping uses survey_date; the shop FILTER (params.filters.shopId) is
// matched case-insensitively against shop_name, the surveys-API convention
// ./survey.ts follows. (Survey rows key on shop_name, not companies.id, so the
// id-based ctx.shopIds scope is not applicable to this batch — same as ./survey.ts.)

import type { ReportContext, ReportParams, ReportRow } from "../types";
import { fetchAllRows } from "./paginate";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** EMI alert threshold as a display % (shared with survey.ts / network_summary). */
const ALERT_THRESHOLD_PCT = 88;
/** Sub-scores are native 0..10; the 88% alert line is 8.8 on that scale. */
const SUB_FLOOR = ALERT_THRESHOLD_PCT / 10;

/** The four q05 sub-score dimensions, per public.shop_detail (see surveys.ts). */
const SUB_DIMENSIONS = [
  { column: "q05_01", label: "Quality" },
  { column: "q05_02", label: "Cleanliness" },
  { column: "q05_03", label: "Communication" },
  { column: "q05_04", label: "Courtesy" },
] as const;

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

/** Average of the defined numeric values, or null when none are defined. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** PostgREST embeds a to-one relation as an object and a to-many as an array. */
function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function first<T>(v: T | T[] | null | undefined): T | null {
  const a = asArray(v);
  return a.length ? a[0] : null;
}

function label(s: string | null | undefined): string {
  return (s ?? "").trim() || "—";
}

// ───────────────────── Shared embed shapes / fetch ─────────────────────

type EmployeeRef = { name: string | null };
type RoEmpLink = {
  role: string | null;
  employees: EmployeeRef | EmployeeRef[] | null;
};
type NamedRef = { name: string | null };
type CustomerRef = { first_name: string | null; last_name: string | null };
type SurveyRoRef = {
  insurance_companies: NamedRef | NamedRef[] | null;
  insurance_agents: NamedRef | NamedRef[] | null;
  repair_customers: CustomerRef | CustomerRef[] | null;
  repair_order_employees: RoEmpLink | RoEmpLink[] | null;
};

/** Customer display name from the embedded RO, or "—". Name only — no PII. */
function customerNameOf(ro: SurveyRoRef | null): string {
  const c = first(ro?.repair_customers);
  const full = `${(c?.first_name ?? "").trim()} ${(c?.last_name ?? "").trim()}`.trim();
  return full || "—";
}

/** Estimator name attributed to the embedded RO, or "—". */
function estimatorNameOf(ro: SurveyRoRef | null): string {
  for (const link of asArray(ro?.repair_order_employees)) {
    if (link.role === "estimator") return label(first(link.employees)?.name);
  }
  return "—";
}

/**
 * Referral category for a survey's RO, mirroring the shipped referral-directory
 * report (./customer-insurance.ts): Insurance Agent when an agent edge resolves,
 * else Insurance Company when an insurer edge resolves, else Direct. `source` is
 * the resolved agent/insurer name (the verifiable referral edge) or "—".
 */
function referralOf(ro: SurveyRoRef | null): { category: string; source: string } {
  const agent = first(ro?.insurance_agents)?.name?.trim();
  if (agent) return { category: "Insurance Agent", source: agent };
  const insurer = first(ro?.insurance_companies)?.name?.trim();
  if (insurer) return { category: "Insurance Company", source: insurer };
  return { category: "Direct", source: "—" };
}

/** survey_date as YYYY-MM-DD, or "" when missing/unparseable. */
function surveyYmd(d: string | null | undefined): string {
  const s = typeof d === "string" ? d.slice(0, 10) : "";
  return YMD.test(s) ? s : "";
}

// ───────────────────── Score-filter reports ─────────────────────

type ScoreRow = {
  shop_name: string | null;
  survey_date: string | null;
  scale_emi_pct: number | string | null;
  q05_01: number | string | null;
  q05_02: number | string | null;
  q05_03: number | string | null;
  q05_04: number | string | null;
  ro_number: string | null;
  repair_orders: SurveyRoRef | SurveyRoRef[] | null;
};

const SCORE_SELECT =
  "shop_name, survey_date, scale_emi_pct, q05_01, q05_02, q05_03, q05_04, ro_number, " +
  "repair_orders(insurance_companies(name), insurance_agents(name), " +
  "repair_customers(first_name, last_name), repair_order_employees(role, employees(name)))";

/** Fetch survey_responses (date/shop-scoped) with the RO referral/name embeds. */
async function fetchScoreRows(
  params: ReportParams,
  ctx: ReportContext,
  cols: string,
): Promise<ScoreRow[]> {
  return fetchAllRows<ScoreRow>(() => {
    let query = ctx.db!.from("survey_responses").select(cols);
    if (params.start && YMD.test(params.start)) {
      query = query.gte("survey_date", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("survey_date", params.end);
    }
    const shop = params.filters.shopId?.trim();
    if (shop) query = query.ilike("shop_name", `%${shop}%`);
    return query;
  });
}

/** The lowest defined sub-score on a row, with its dimension label, or null. */
function lowestSub(
  row: ScoreRow,
): { label: string; value: number } | null {
  let worst: { label: string; value: number } | null = null;
  for (const { column, label: dim } of SUB_DIMENSIONS) {
    const v = num(row[column as keyof ScoreRow] as number | string | null);
    if (v === null) continue;
    if (worst === null || v < worst.value) worst = { label: dim, value: v };
  }
  return worst;
}

/**
 * Perfect Score — individual surveys returned with a perfect overall score (EMI
 * = 100%): recognition + testimonial sources. Customer + estimator resolve from
 * the survey's repair_order_id when linked (else "—"). Newest first.
 */
export async function perfectScoreRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("perfectScoreRun requires a db context");

  const data = await fetchScoreRows(params, ctx, SCORE_SELECT);

  const rows: (ReportRow & { _date: string })[] = [];
  for (const r of data) {
    const emi = num(r.scale_emi_pct);
    if (emi === null) continue; // no score → not a perfect score
    if (round1(emi * 100) < 100) continue; // perfect = 100% EMI
    const ro = first(r.repair_orders);
    const date = surveyYmd(r.survey_date);
    rows.push({
      ro: r.ro_number?.trim() || "—",
      shop: label(r.shop_name),
      customer: customerNameOf(ro),
      estimator: estimatorNameOf(ro),
      date: date || null,
      _date: date,
    });
  }

  rows.sort((a, b) => b._date.localeCompare(a._date));
  return rows.map(({ _date, ...row }) => row);
}

/**
 * Mis-Fire — surveys where a HIGH overall score (EMI ×100 ≥ the 88% alert line,
 * i.e. in good standing) masks a LOW sub-score (the weakest q05 dimension below
 * 8.8, the same alert line on the native 0..10 sub-score scale) — a "mis-fire"
 * to coach on. Worst masked sub-score first.
 */
export async function misFireRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("misFireRun requires a db context");

  const data = await fetchScoreRows(params, ctx, SCORE_SELECT);

  const rows: (ReportRow & { _sub: number })[] = [];
  for (const r of data) {
    const emi = num(r.scale_emi_pct);
    if (emi === null) continue;
    const overall = round1(emi * 100);
    if (overall < ALERT_THRESHOLD_PCT) continue; // not a "high overall"
    const low = lowestSub(r);
    if (!low || low.value >= SUB_FLOOR) continue; // no masked low sub-score
    rows.push({
      ro: r.ro_number?.trim() || "—",
      shop: label(r.shop_name),
      overall,
      lowSub: low.label,
      subScore: round1(low.value),
      _sub: low.value,
    });
  }

  // Most severe mis-fire (lowest masked sub-score) first, then shop.
  rows.sort(
    (a, b) =>
      a._sub - b._sub || String(a.shop).localeCompare(String(b.shop)),
  );
  return rows.map(({ _sub, ...row }) => row);
}

/**
 * Hot Spot — surveys clustering a recurring negative theme by shop: each survey
 * contributes a "mention" to a theme (q05 dimension) only when that dimension is
 * below the 8.8 sub-score alert line (a genuine negative). Grouped by shop ×
 * theme: count of mentions + avg of the flagged dimension's score. Hottest
 * (most-mentioned) clusters first.
 */
export async function hotSpotRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("hotSpotRun requires a db context");

  const data = await fetchScoreRows(
    params,
    ctx,
    "shop_name, survey_date, q05_01, q05_02, q05_03, q05_04",
  );

  type Group = { shop: string; theme: string; scores: number[] };
  const groups = new Map<string, Group>();
  for (const r of data) {
    const shop = label(r.shop_name);
    for (const { column, label: theme } of SUB_DIMENSIONS) {
      const v = num(r[column as keyof ScoreRow] as number | string | null);
      if (v === null || v >= SUB_FLOOR) continue; // only negative mentions
      const key = `${shop.toLowerCase()}|${theme}`;
      let g = groups.get(key);
      if (!g) {
        g = { shop, theme, scores: [] };
        groups.set(key, g);
      }
      g.scores.push(v);
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      shop: g.shop,
      theme: g.theme,
      count: g.scores.length,
      avgScore: (() => {
        const m = mean(g.scores);
        return m === null ? null : round1(m);
      })(),
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.shop.localeCompare(b.shop) ||
        a.theme.localeCompare(b.theme),
    );
}

// ───────────────────── Referral reports ─────────────────────

type ReferralRow = {
  shop_name: string | null;
  survey_date: string | null;
  ro_number: string | null;
  repair_orders: SurveyRoRef | SurveyRoRef[] | null;
};

const REFERRAL_SELECT =
  "shop_name, survey_date, ro_number, " +
  "repair_orders(insurance_companies(name), insurance_agents(name), " +
  "repair_customers(first_name, last_name))";

/**
 * Referral Noted — surveys whose RO resolves to a referral edge (an insurance
 * agent or insurance company), with the resolved source named — feeds the
 * referral directory. Direct (no referral edge) rows are excluded, since there
 * is no referral source to note. Sorted by category, then customer.
 */
export async function referralNotedRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("referralNotedRun requires a db context");

  const data = await fetchAllRows<ReferralRow>(() => {
    let query = ctx.db!.from("survey_responses").select(REFERRAL_SELECT);
    if (params.start && YMD.test(params.start)) {
      query = query.gte("survey_date", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("survey_date", params.end);
    }
    const shop = params.filters.shopId?.trim();
    if (shop) query = query.ilike("shop_name", `%${shop}%`);
    return query;
  });

  const rows: ReportRow[] = [];
  for (const r of data) {
    const ro = first(r.repair_orders);
    const { category, source } = referralOf(ro);
    if (category === "Direct") continue; // no referral source named
    rows.push({
      ro: r.ro_number?.trim() || "—",
      customer: customerNameOf(ro),
      category,
      source,
    });
  }

  rows.sort(
    (a, b) =>
      String(a.category).localeCompare(String(b.category)) ||
      String(a.customer).localeCompare(String(b.customer)),
  );
  return rows;
}

/** ms at UTC midnight for a YYYY-MM-DD string. */
function ymdMs(d: string): number {
  return Date.parse(`${d}T00:00:00Z`);
}
/** ms → YYYY-MM-DD (UTC). */
function msYmd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
const DAY_MS = 86_400_000;

/**
 * Referral Comparison — period-over-period referral VOLUME by category (current
 * vs. the immediately preceding equal-length window). Categories are derived per
 * survey from the spine insurer/agent edges (Insurance Agent / Insurance Company
 * / Direct), counted by survey_date window. Delta is the % change (null when the
 * prior period had none). Requires a date range to define the prior window;
 * without one, every survey counts as "current" and prior is 0.
 */
export async function referralComparisonRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("referralComparisonRun requires a db context");

  const hasRange =
    !!params.start &&
    YMD.test(params.start) &&
    !!params.end &&
    YMD.test(params.end);

  // When a range is given, fetch the prior window too (single query) so both
  // periods come from one pass; bucket each survey by its date.
  let priorStart = "";
  let priorEnd = "";
  let fetchStart = params.start;
  if (hasRange) {
    const startMs = ymdMs(params.start!);
    const endMs = ymdMs(params.end!);
    const lenMs = Math.max(0, endMs - startMs);
    priorEnd = msYmd(startMs - DAY_MS); // day before current start
    priorStart = msYmd(startMs - DAY_MS - lenMs);
    fetchStart = priorStart;
  }

  const data = await fetchAllRows<ReferralRow>(() => {
    let query = ctx.db!.from("survey_responses").select(REFERRAL_SELECT);
    if (fetchStart && YMD.test(fetchStart)) {
      query = query.gte("survey_date", fetchStart);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("survey_date", params.end);
    }
    const shop = params.filters.shopId?.trim();
    if (shop) query = query.ilike("shop_name", `%${shop}%`);
    return query;
  });

  type Bucket = { prior: number; current: number };
  const cats = new Map<string, Bucket>();
  const bucketFor = (category: string): Bucket => {
    let b = cats.get(category);
    if (!b) {
      b = { prior: 0, current: 0 };
      cats.set(category, b);
    }
    return b;
  };

  for (const r of data) {
    const { category } = referralOf(first(r.repair_orders));
    const date = surveyYmd(r.survey_date);
    const b = bucketFor(category);
    if (!hasRange) {
      // No window defined → everything is "current".
      b.current += 1;
      continue;
    }
    if (!date) continue; // unbucketable
    if (date >= params.start! && date <= params.end!) b.current += 1;
    else if (date >= priorStart && date <= priorEnd) b.prior += 1;
  }

  return Array.from(cats.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, b]) => ({
      category,
      prior: b.prior,
      current: b.current,
      delta:
        b.prior > 0 ? round1(((b.current - b.prior) / b.prior) * 100) : null,
    }));
}
