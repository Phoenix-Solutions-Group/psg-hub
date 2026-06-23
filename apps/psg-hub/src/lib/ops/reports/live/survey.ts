// v1.4 / PSG-28 — Operational Reports: live (B1-backed) data functions for the
// Survey & CSI batch.
//
// The B1 dependency (PSG-25 v1.1 Ops Foundation) has landed: survey_responses
// is live (20260602105554_remote_schema) with the columns the surveys vertical
// already uses (see src/lib/ops/surveys.ts: SURVEY_SELECT). These functions are
// the "mechanical fast-follow" the framework was designed for — each is wired
// into registry.ts by flipping the report's `dataStatus` to "available" and
// pointing `run` here.
//
// CSI semantics (authoritative): the network headline metric in this system is
// the EMI score — survey_responses.scale_emi_pct, stored as a 0..1 FRACTION and
// displayed ×100 (the same convention public.network_summary / network_trend /
// shop_detail use, with an 88% alert threshold). So a report's "CSI" column is
// avg(scale_emi_pct) × 100. We aggregate in JS over real rows rather than via an
// RPC so the grouping (per shop × month) is exactly what each report needs and
// so the path is unit-testable against a plain stub db.
//
// Shop filtering matches the surveys API convention (src/app/api/surveys): the
// `shop` filter value is matched case-insensitively against shop_name. (Survey
// rows key on shop_name, not the companies.id used elsewhere in ops, so the
// id-based ctx.shopIds scope is not yet applicable here.)

import type { ReportContext, ReportParams, ReportRow } from "../types";
import {
  csiByAttribution,
  recommendRatePct,
  responseRatePct,
  reworkRatePct,
} from "./attribution";
import { fetchAllRows } from "./paginate";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Average of the defined numeric values, or null when none are defined. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Round to 1 decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Coerce a numeric|string|null cell to a finite number, or null. */
function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Case-insensitive substring match, mirroring the surveys API `ilike` filter. */
function shopMatches(shopName: string | null, needle: string): boolean {
  return (shopName ?? "").toLowerCase().includes(needle.toLowerCase());
}

type SurveyRow = {
  shop_name: string | null;
  survey_date: string | null;
  scale_emi_pct: number | string | null;
};

/**
 * Monthly CSI Display — month-by-month CSI (= avg EMI ×100) and survey volume,
 * grouped by shop. Sorted by month ascending, then shop ascending.
 */
export async function monthlyCsiDisplayRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("monthlyCsiDisplayRun requires a db context");

  const data = await fetchAllRows<SurveyRow>(() => {
    let query = ctx
      .db!.from("survey_responses")
      .select("shop_name, survey_date, scale_emi_pct");
    if (params.start && YMD.test(params.start)) {
      query = query.gte("survey_date", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("survey_date", params.end);
    }
    const shop = params.filters.shopId?.trim();
    if (shop) {
      query = query.ilike("shop_name", `%${shop}%`);
    }
    return query;
  });

  // Group by (month, shop). Track survey count separately from the EMI sample
  // (EMI may be null on some rows) so a missing score never deflates the count.
  const groups = new Map<
    string,
    { month: string; shop: string; surveys: number; emis: number[] }
  >();

  for (const row of data) {
    const date = typeof row.survey_date === "string" ? row.survey_date : "";
    if (!YMD.test(date)) continue; // skip rows we can't bucket into a month
    const month = date.slice(0, 7); // YYYY-MM
    const shopName = (row.shop_name ?? "—").trim() || "—";
    const key = `${month}|${shopName}`;

    let g = groups.get(key);
    if (!g) {
      g = { month, shop: shopName, surveys: 0, emis: [] };
      groups.set(key, g);
    }
    g.surveys += 1;

    const emi =
      typeof row.scale_emi_pct === "string"
        ? Number(row.scale_emi_pct)
        : row.scale_emi_pct;
    if (typeof emi === "number" && Number.isFinite(emi)) g.emis.push(emi);
  }

  const rows: ReportRow[] = Array.from(groups.values())
    .sort((a, b) => a.month.localeCompare(b.month) || a.shop.localeCompare(b.shop))
    .map((g) => {
      const avgEmi = mean(g.emis);
      return {
        month: g.month,
        shop: g.shop,
        csi: avgEmi === null ? null : round1(avgEmi * 100),
        surveys: g.surveys,
      };
    });

  return rows;
}

type SurveyMetricRow = {
  shop_name: string | null;
  survey_date: string | null;
  scale_emi_pct: number | string | null;
  q05_01: number | string | null;
  q05_02: number | string | null;
  q05_03: number | string | null;
  q05_04: number | string | null;
};

/**
 * Metrics surfaced by market-dashboard, in display order. Mixed-scale, matching
 * the system convention (public.shop_detail): the EMI headline is a 0..1
 * fraction shown ×100, while the q05_0x sub-scores are shown at their native
 * scale (avg, 1dp — no ×100). Keeping both here means the report's "Overall CSI"
 * column lines up with the CSI everywhere else, and "Quality"/"Cleanliness"/etc.
 * line up with the survey-detail page.
 */
const MARKET_METRICS = [
  { label: "Overall CSI", column: "scale_emi_pct", scale100: true },
  { label: "Quality", column: "q05_01", scale100: false },
  { label: "Cleanliness", column: "q05_02", scale100: false },
  { label: "Communication", column: "q05_03", scale100: false },
  { label: "Courtesy", column: "q05_04", scale100: false },
] as const;

/** Mean of the metric across rows where it is defined, ×100 for EMI. null when empty. */
function metricAvg(
  rows: SurveyMetricRow[],
  column: (typeof MARKET_METRICS)[number]["column"],
  scale100: boolean,
): number | null {
  const vals: number[] = [];
  for (const r of rows) {
    const v = num(r[column]);
    if (v !== null) vals.push(scale100 ? v * 100 : v);
  }
  const m = mean(vals);
  return m === null ? null : round1(m);
}

/**
 * Market Dashboard — the selected shop's CSI/sub-scores vs. the network ("market")
 * benchmark, per metric, with delta. The shop subset is the rows matching the
 * `shop` filter (case-insensitive, surveys-API convention); the market is the
 * full network over the same date range. With no shop filter the shop subset is
 * the whole network, so deltas are 0 (a sensible "you are the network" baseline).
 */
export async function marketDashboardRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("marketDashboardRun requires a db context");

  // Fetch the full network for the date range; the shop subset is sliced in JS
  // so a single query yields both the shop score and the market benchmark.
  const network = await fetchAllRows<SurveyMetricRow>(() => {
    let query = ctx
      .db!.from("survey_responses")
      .select(
        "shop_name, survey_date, scale_emi_pct, q05_01, q05_02, q05_03, q05_04",
      );
    if (params.start && YMD.test(params.start)) {
      query = query.gte("survey_date", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("survey_date", params.end);
    }
    return query;
  });
  const shop = params.filters.shopId?.trim();
  const shopRows = shop
    ? network.filter((r) => shopMatches(r.shop_name, shop))
    : network;

  return MARKET_METRICS.map(({ label, column, scale100 }) => {
    const shopAvg = metricAvg(shopRows, column, scale100);
    const marketAvg = metricAvg(network, column, scale100);
    const delta =
      shopAvg === null || marketAvg === null
        ? null
        : round1(shopAvg - marketAvg);
    return { metric: label, shop: shopAvg, market: marketAvg, delta };
  });
}

type SurveyAlertRow = {
  shop_name: string | null;
  survey_date: string | null;
  scale_emi_pct: number | string | null;
  q05_01: number | string | null;
  q05_02: number | string | null;
  q05_03: number | string | null;
  q05_04: number | string | null;
  response_id: string | null;
};

/** EMI alert threshold (displayed %), shared with network_summary/shop_detail. */
const ALERT_THRESHOLD = 88;

const ALERT_DIMENSIONS = [
  { column: "q05_01", label: "Low Quality" },
  { column: "q05_02", label: "Low Cleanliness" },
  { column: "q05_03", label: "Low Communication" },
  { column: "q05_04", label: "Low Courtesy" },
] as const;

/** Weakest sub-score dimension drives the alert label; falls back to overall. */
function alertLabel(row: SurveyAlertRow): string {
  let worst: { label: string; value: number } | null = null;
  for (const { column, label } of ALERT_DIMENSIONS) {
    const v = num(row[column]);
    if (v === null) continue;
    if (worst === null || v < worst.value) worst = { label, value: v };
  }
  return worst ? worst.label : "Low overall CSI";
}

/**
 * Survey Alert Recap — every survey whose CSI (EMI ×100) fell below the 88%
 * alert threshold in the period, newest first, for follow-up. Score/shop/date/
 * alert all derive from live survey data today. The identifier column shows the
 * survey `response_id`: survey rows are not yet linked to a repair order, so this
 * is the truthful per-survey reference until that join lands (see PSG-80).
 */
export async function surveyAlertRecapRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("surveyAlertRecapRun requires a db context");

  const data = await fetchAllRows<SurveyAlertRow>(() => {
    let query = ctx
      .db!.from("survey_responses")
      .select(
        "shop_name, survey_date, scale_emi_pct, q05_01, q05_02, q05_03, q05_04, response_id",
      );
    if (params.start && YMD.test(params.start)) {
      query = query.gte("survey_date", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("survey_date", params.end);
    }
    const shop = params.filters.shopId?.trim();
    if (shop) {
      query = query.ilike("shop_name", `%${shop}%`);
    }
    return query;
  });

  const rows: (ReportRow & { _date: string; _score: number })[] = [];
  for (const r of data) {
    const emi = num(r.scale_emi_pct);
    if (emi === null) continue; // no score → no alert to report
    const score = round1(emi * 100);
    if (score >= ALERT_THRESHOLD) continue;
    const date = typeof r.survey_date === "string" ? r.survey_date : "";
    rows.push({
      ro: r.response_id ?? "—",
      shop: (r.shop_name ?? "—").trim() || "—",
      score,
      alert: alertLabel(r),
      date: date || null,
      _date: date,
      _score: score,
    });
  }

  // Newest first; ties broken by lowest score (most severe) first.
  rows.sort((a, b) => b._date.localeCompare(a._date) || a._score - b._score);
  return rows.map(({ _date, _score, ...row }) => row);
}

// ───────────────────── Attribution-backed reports (PSG-89) ─────────────────────
//
// The remaining survey-CSI reports join survey_responses → repair_orders →
// repair_order_employees(role) → employees, plus survey_dispatches (sent) and
// survey_responses.would_recommend, all landed by 20260618200000_survey_attribution_v1_4.
// We fetch the joined rows via PostgREST embedded selects and aggregate in JS
// through the pure helpers in ./attribution (unit-tested independently), keeping
// the same "fetch rows → group in JS" shape as the reports above.

/** PostgREST embeds a to-one relation as an object and a to-many as an array. */
function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function first<T>(v: T | T[] | null | undefined): T | null {
  const a = asArray(v);
  return a.length ? a[0] : null;
}

type EmployeeRef = { name: string | null };
type RoEmpLink = {
  role: string | null;
  rework?: boolean | null;
  employees: EmployeeRef | EmployeeRef[] | null;
};
type RoRef = { repair_order_employees: RoEmpLink | RoEmpLink[] | null };
type SurveyAttrRow = {
  scale_emi_pct: number | string | null;
  q05_01: number | string | null;
  would_recommend: boolean | null;
  repair_orders: RoRef | RoRef[] | null;
};

/** One survey, exploded per attributed employee of the requested role. */
type AttrSurveyRow = {
  key: string | null;
  scale_emi_pct: number | string | null;
  q05_01: number | string | null;
  would_recommend: boolean | null;
};

const SURVEY_ATTR_SELECT =
  "scale_emi_pct, q05_01, would_recommend, survey_date, shop_name, " +
  "repair_orders(repair_order_employees(role, employees(name)))";

/** Explode joined survey rows into one row per employee in `role`. */
function attributeSurveys(rows: SurveyAttrRow[], role: string): AttrSurveyRow[] {
  const out: AttrSurveyRow[] = [];
  for (const r of rows) {
    const ro = first(r.repair_orders);
    if (!ro) continue; // survey not linked to an RO → unattributed
    for (const link of asArray(ro.repair_order_employees)) {
      if (link.role !== role) continue;
      const emp = first(link.employees);
      out.push({
        key: emp?.name ?? null,
        scale_emi_pct: r.scale_emi_pct,
        q05_01: r.q05_01,
        would_recommend: r.would_recommend ?? null,
      });
    }
  }
  return out;
}

/** Fetch survey_responses (date/shop-scoped) joined to role attribution. */
async function fetchAttributedSurveys(
  params: ReportParams,
  ctx: ReportContext,
  role: string,
): Promise<AttrSurveyRow[]> {
  const data = await fetchAllRows<SurveyAttrRow>(() => {
    let query = ctx.db!.from("survey_responses").select(SURVEY_ATTR_SELECT);
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
  return attributeSurveys(data, role);
}

/** Group attributed survey rows by (trimmed, non-empty) employee key. */
function groupByKey(rows: AttrSurveyRow[]): Map<string, AttrSurveyRow[]> {
  const m = new Map<string, AttrSurveyRow[]>();
  for (const r of rows) {
    const k = (r.key ?? "").trim();
    if (!k) continue;
    let g = m.get(k);
    if (!g) {
      g = [];
      m.set(k, g);
    }
    g.push(r);
  }
  return m;
}

/**
 * Estimator CSI — survey count, CSI (= avg EMI ×100) and would-recommend rate,
 * attributed to each estimator over the period. Sorted by estimator ascending.
 */
export async function estimatorCsiRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("estimatorCsiRun requires a db context");

  const rows = await fetchAttributedSurveys(params, ctx, "estimator");
  const csi = csiByAttribution(
    rows.map((r) => ({ key: r.key, scale_emi_pct: r.scale_emi_pct })),
  );
  const byKey = groupByKey(rows);
  return csi.map((g) => ({
    estimator: g.key,
    surveys: g.surveys,
    csi: g.csi,
    recommend: recommendRatePct(byKey.get(g.key) ?? []),
  }));
}

type RoEmpJobRow = {
  rework: boolean | null;
  employees: EmployeeRef | EmployeeRef[] | null;
};

/**
 * Per-employee job rows for a role, from the repair_order_employees bridge.
 * Date-scoped by the bridge row's `created_at` (the available timestamp — the
 * legacy repair_orders has no flat date column; this is the documented proxy
 * for "work recorded in the period"). One row per (RO, role, employee) = 1 job.
 */
async function fetchRoleJobs(
  params: ReportParams,
  ctx: ReportContext,
  role: string,
): Promise<{ key: string; rework: boolean }[]> {
  const data = await fetchAllRows<RoEmpJobRow>(() => {
    let query = ctx
      .db!.from("repair_order_employees")
      .select("role, rework, created_at, employees(name)")
      .eq("role", role);
    if (params.start && YMD.test(params.start)) {
      query = query.gte("created_at", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("created_at", `${params.end}T23:59:59.999Z`);
    }
    return query;
  });

  const out: { key: string; rework: boolean }[] = [];
  for (const r of data) {
    const key = (first(r.employees)?.name ?? "").trim();
    if (!key) continue;
    out.push({ key, rework: !!r.rework });
  }
  return out;
}

type RolePerfRow = {
  key: string;
  jobs: number;
  reworkRate: number | null;
  quality: number | null;
};

/**
 * Shared body-tech / painter aggregation. Jobs + rework come from the bridge
 * (every job, surveyed or not); the quality sub-score (q05_01, native scale —
 * the "quality"/"finish" CSI) comes from surveys attributed to that employee.
 * Union of both key sets so an employee with jobs but no returned survey still
 * shows (quality null), and vice-versa. Sorted by name ascending.
 */
async function rolePerformance(
  params: ReportParams,
  ctx: ReportContext,
  role: string,
): Promise<RolePerfRow[]> {
  const jobs = await fetchRoleJobs(params, ctx, role);
  const surveys = await fetchAttributedSurveys(params, ctx, role);

  const jobsByKey = new Map<string, { rework: boolean }[]>();
  for (const j of jobs) {
    let g = jobsByKey.get(j.key);
    if (!g) {
      g = [];
      jobsByKey.set(j.key, g);
    }
    g.push({ rework: j.rework });
  }

  const qualByKey = new Map<string, number[]>();
  for (const s of surveys) {
    const k = (s.key ?? "").trim();
    if (!k) continue;
    const q = num(s.q05_01);
    if (q === null) continue;
    let g = qualByKey.get(k);
    if (!g) {
      g = [];
      qualByKey.set(k, g);
    }
    g.push(q);
  }

  const keys = Array.from(
    new Set([...jobsByKey.keys(), ...qualByKey.keys()]),
  ).sort((a, b) => a.localeCompare(b));

  return keys.map((key) => {
    const jrows = jobsByKey.get(key) ?? [];
    const q = mean(qualByKey.get(key) ?? []);
    return {
      key,
      jobs: jrows.length,
      reworkRate: reworkRatePct(jrows),
      quality: q === null ? null : round1(q),
    };
  });
}

/**
 * Body Tech Performance — jobs, comeback (rework) rate, and quality CSI sub-score
 * per body technician.
 */
export async function bodyTechPerformanceRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("bodyTechPerformanceRun requires a db context");
  const rows = await rolePerformance(params, ctx, "body_tech");
  return rows.map((r) => ({
    tech: r.key,
    jobs: r.jobs,
    comebackRate: r.reworkRate,
    quality: r.quality,
  }));
}

/**
 * Painter Performance — jobs, redo (rework) rate, and finish-quality CSI sub-score
 * per painter. Same computation as body-tech, viewed for the painter role.
 */
export async function painterPerformanceRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("painterPerformanceRun requires a db context");
  const rows = await rolePerformance(params, ctx, "painter");
  return rows.map((r) => ({
    painter: r.key,
    jobs: r.jobs,
    redoRate: r.reworkRate,
    finish: r.quality,
  }));
}

type PerfSurveyRow = {
  shop_name: string | null;
  scale_emi_pct: number | string | null;
  would_recommend: boolean | null;
};
type DispatchRow = { shop_name: string | null };

/**
 * Performance Dashboard — headline KPIs per shop: surveys returned, CSI
 * (= avg EMI ×100), response rate (returned / sent, sent from survey_dispatches)
 * and would-recommend rate. Shops are the union of those with returned surveys
 * and those that were sent surveys (so a 0%-response shop still surfaces).
 * Sorted by shop ascending.
 */
export async function performanceDashboardRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("performanceDashboardRun requires a db context");

  const shop = params.filters.shopId?.trim();

  const [sData, dData] = await Promise.all([
    fetchAllRows<PerfSurveyRow>(() => {
      let sQuery = ctx
        .db!.from("survey_responses")
        .select("shop_name, survey_date, scale_emi_pct, would_recommend");
      if (params.start && YMD.test(params.start)) {
        sQuery = sQuery.gte("survey_date", params.start);
      }
      if (params.end && YMD.test(params.end)) {
        sQuery = sQuery.lte("survey_date", params.end);
      }
      if (shop) sQuery = sQuery.ilike("shop_name", `%${shop}%`);
      return sQuery;
    }),
    fetchAllRows<DispatchRow>(() => {
      let dQuery = ctx
        .db!.from("survey_dispatches")
        .select("shop_name, sent_date");
      if (params.start && YMD.test(params.start)) {
        dQuery = dQuery.gte("sent_date", params.start);
      }
      if (params.end && YMD.test(params.end)) {
        dQuery = dQuery.lte("sent_date", params.end);
      }
      if (shop) dQuery = dQuery.ilike("shop_name", `%${shop}%`);
      return dQuery;
    }),
  ]);

  // Normalize the cross-table join key (lower-cased) but keep a display label.
  type Group = {
    shop: string;
    returned: number;
    emis: number[];
    recRows: { would_recommend: boolean | null }[];
    sent: number;
  };
  const groups = new Map<string, Group>();
  const groupFor = (rawName: string | null): Group => {
    const display = (rawName ?? "—").trim() || "—";
    const key = display.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { shop: display, returned: 0, emis: [], recRows: [], sent: 0 };
      groups.set(key, g);
    }
    return g;
  };

  for (const r of sData) {
    const g = groupFor(r.shop_name);
    g.returned += 1;
    const emi = num(r.scale_emi_pct);
    if (emi !== null) g.emis.push(emi);
    g.recRows.push({ would_recommend: r.would_recommend ?? null });
  }
  for (const r of dData) {
    groupFor(r.shop_name).sent += 1;
  }

  return Array.from(groups.values())
    .sort((a, b) => a.shop.localeCompare(b.shop))
    .map((g) => {
      const avgEmi = mean(g.emis);
      return {
        shop: g.shop,
        returned: g.returned,
        csi: avgEmi === null ? null : round1(avgEmi * 100),
        responseRate: responseRatePct(g.returned, g.sent),
        recommend: recommendRatePct(g.recRows),
      };
    });
}

// ───────────────────── Rental + cycle time (PSG-96) ─────────────────────
//
// rental-car-analysis was the last sample-only Survey & CSI report: its rental
// days / cost and cycle time are RO/insurer-side, not survey-side, so neither
// PSG-25 (spine) nor PSG-89 (survey attribution) carried them. The data model
// landed in 20260618210000_rental_cycle_time_v1_5:
//   rentalDays / cost -> public.rental_assignments(rental_days, rental_cost)
//   cycleTime         -> repair_orders.dates_json (date_out - date_in, in days)
//   shop / insurer    -> repair_orders -> companies.name / insurance_companies.name
// We fetch rental_assignments (scoped by start_date) with the RO + shop + insurer
// embedded, then aggregate per (shop, insurer) in JS — same "fetch rows → group
// in JS" shape as the reports above. The shop filter is applied in JS against the
// resolved company name (like marketDashboardRun slices in JS) rather than via a
// fragile embedded-resource filter.

/** Round to 2 decimal places (currency). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Cycle time in days = date_out - date_in, read from repair_orders.dates_json.
 * Returns null when either date is missing/unparseable or out precedes in (bad
 * data) so a partial pair never poisons the average — it just omits that RO from
 * the cycleTime sample while its rental days/cost still count.
 */
function cycleDays(dates: Record<string, unknown> | null | undefined): number | null {
  if (!dates) return null;
  const di = typeof dates.date_in === "string" ? dates.date_in : null;
  const dout = typeof dates.date_out === "string" ? dates.date_out : null;
  if (!di || !dout || !YMD.test(di) || !YMD.test(dout)) return null;
  const inMs = Date.parse(`${di}T00:00:00Z`);
  const outMs = Date.parse(`${dout}T00:00:00Z`);
  if (Number.isNaN(inMs) || Number.isNaN(outMs)) return null;
  const days = (outMs - inMs) / 86_400_000;
  return days >= 0 ? days : null;
}

type NamedRef = { name: string | null };
type RentalRoRef = {
  dates_json: Record<string, unknown> | null;
  companies: NamedRef | NamedRef[] | null;
  insurance_companies: NamedRef | NamedRef[] | null;
};
type RentalRow = {
  rental_days: number | string | null;
  rental_cost: number | string | null;
  repair_orders: RentalRoRef | RentalRoRef[] | null;
};

const RENTAL_SELECT =
  "rental_days, rental_cost, start_date, " +
  "repair_orders(dates_json, companies(name), insurance_companies(name))";

/**
 * Rental Car Analysis — rental days and cost by shop × insurer relative to cycle
 * time over the period. Each row is one shop × insurer pairing; the three numeric
 * columns are per-RO AVERAGES so they are directly comparable (the report's point
 * is "are we paying for more rental days than the car is actually in the shop?"):
 *   rentalDays = avg billed rental days   (rental_assignments.rental_days)
 *   cycleTime  = avg days in shop         (date_out - date_in from dates_json)
 *   cost       = avg rental charge        (rental_assignments.rental_cost, 2dp)
 * Scoped by rental start_date over [start, end]; shop filter matched in JS
 * (case-insensitive, surveys-API convention). Sorted by shop, then insurer asc.
 */
export async function rentalCarAnalysisRun(
  params: ReportParams,
  ctx: ReportContext,
): Promise<ReportRow[]> {
  if (!ctx.db) throw new Error("rentalCarAnalysisRun requires a db context");

  const data = await fetchAllRows<RentalRow>(() => {
    let query = ctx.db!.from("rental_assignments").select(RENTAL_SELECT);
    if (params.start && YMD.test(params.start)) {
      query = query.gte("start_date", params.start);
    }
    if (params.end && YMD.test(params.end)) {
      query = query.lte("start_date", params.end);
    }
    return query;
  });

  const shopFilter = params.filters.shopId?.trim();

  type Group = {
    shop: string;
    insurer: string;
    days: number[];
    cycles: number[];
    costs: number[];
  };
  const groups = new Map<string, Group>();

  for (const r of data) {
    const ro = first(r.repair_orders);
    const shop = (first(ro?.companies)?.name ?? "—").trim() || "—";
    if (shopFilter && !shopMatches(shop, shopFilter)) continue;
    const insurer =
      (first(ro?.insurance_companies)?.name ?? "—").trim() || "—";

    const key = `${shop.toLowerCase()}|${insurer.toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = { shop, insurer, days: [], cycles: [], costs: [] };
      groups.set(key, g);
    }

    const days = num(r.rental_days);
    if (days !== null) g.days.push(days);
    const cost = num(r.rental_cost);
    if (cost !== null) g.costs.push(cost);
    const cyc = cycleDays(ro?.dates_json);
    if (cyc !== null) g.cycles.push(cyc);
  }

  return Array.from(groups.values())
    .sort(
      (a, b) =>
        a.shop.localeCompare(b.shop) || a.insurer.localeCompare(b.insurer),
    )
    .map((g) => {
      const avgDays = mean(g.days);
      const avgCycle = mean(g.cycles);
      const avgCost = mean(g.costs);
      return {
        shop: g.shop,
        insurer: g.insurer,
        rentalDays: avgDays === null ? null : round1(avgDays),
        cycleTime: avgCycle === null ? null : round1(avgCycle),
        cost: avgCost === null ? null : round2(avgCost),
      };
    });
}
