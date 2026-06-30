// PSG-446 — Pipedrive forecast query + export surface (PSG-435 TODO 4 + 7).
// Turns the mirrored deal set into the artifact Reese hands John (PSG-432 §2.1):
//   • the pipeline-weighted forecast (committed ≤ weighted ≤ best-case) + per-stage
//     S0–S8 breakdown — from the pure `buildForecast`;
//   • a per-open-deal list (the fields Reese's spec names);
//   • the WON/BOOKED reconciled set as a DISTINCT line, kept disjoint from the open
//     pipeline so John can reconcile it against Invoiced MRR without double-counting;
//   • stale-pipeline + data-quality diagnostics.
// CSV is RFC-4180 (CRLF), mirroring `src/lib/ops/reports/export.ts`. All pure: callers
// pass the deal set + `asOf`, so this is fully unit-tested with no DB and no token.

import { buildForecast, type ForecastOptions } from "./forecast";
import { diagnoseDeals, type DealDiagnostics } from "./analysis";
import type { PipedriveDeal, PipelineForecast, RevenueType } from "./types";

export interface DealsExportOptions extends ForecastOptions {
  asOf: Date;
  staleDays?: number;
  /** Stage_ids that are "won" stages (S7 signed / S8) — for the open-in-won warning. */
  wonStageIds?: ReadonlySet<number>;
  /**
   * Recently-closed reconcile window (PSG-463): won/booked deals are kept only when
   * their `closeDate` falls in `[asOf - closedWithinDays, asOf]` (inclusive). Bounds the
   * tie-out to a defined range vs the Invoiced MRR base instead of every won deal ever.
   * Default 90 days. Won deals with a null `closeDate` cannot be windowed and are excluded.
   */
  closedWithinDays?: number;
  /**
   * Optional Pipedrive custom-field key holding the recurring/one-time signal (PSG-463).
   * When set and the deal's `customFields[key]` resolves a value, the export maps it
   * deterministically to `revenue_type`; otherwise the row is `unknown` (Pipedrive has no
   * native recurring flag — never a guessed default).
   */
  revenueTypeFieldKey?: string;
  /**
   * Optional deterministic map from a raw custom-field value → revenue_type, used with
   * `revenueTypeFieldKey`. When omitted, a built-in normalization recognizes `recurring`
   * and `one_time`/`one-time` (case/spacing-insensitive); anything else stays `unknown`.
   */
  revenueTypeMap?: Record<string, RevenueType>;
}

/** Emitted revenue_type on a won/booked row — always a value, `unknown` when unmapped. */
export type WonBookedRevenueType = RevenueType | "unknown";

const DEFAULT_CLOSED_WITHIN_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A single open-pipeline deal row in the export (Reese's PSG-435 field list). */
export interface OpenDealRow {
  dealId: number;
  title: string | null;
  value: number;
  currency: string;
  stageId: number | null;
  stageName: string | null;
  status: string;
  ownerId: number | null;
  ownerName: string | null;
  expectedCloseDate: string | null;
  lastActivityDate: string | null;
  /** Stale = no logged activity in `staleDays`; discountable, not silently summed. */
  stale: boolean;
}

/** A won/booked deal — the DISTINCT reconciled set (disjoint from open pipeline). */
export interface WonBookedRow {
  dealId: number;
  orgName: string | null;
  title: string | null;
  value: number;
  currency: string;
  closeDate: string | null;
  /**
   * REQUIRED column (PSG-435 / John's §2.1). Always carried as a value (never null):
   * `recurring` → netted out vs Invoiced MRR; `one_time` → additive net-new; `unknown`
   * → no custom-field source resolved it, NEVER netted by default — surfaced as a distinct
   * subtotal so the gap is resolved before the tie-out.
   */
  revenueType: WonBookedRevenueType;
  /**
   * Normalized **monthly** MRR basis (PSG-468 / John's §2.1 tightening B). For
   * `revenueType === 'recurring'`: the deal's monthly MRR contribution — face `value` is
   * total-contract/annual `$` with no period, and this is what John nets against Invoiced
   * monthly MRR. `null` for `one_time`/`unknown`, AND for a recurring deal whose
   * interval/basis can't be derived (honest-null — counted for manual reconcile, never
   * silently annualized or netted). Never an MRR figure for a non-recurring row. */
  monthlyValue: number | null;
}

/** Σ face-$ of the won/booked set split by revenue_type, for John's reconciliation. */
export interface WonBookedByType {
  recurring: number;
  oneTime: number;
  /** Σ value of won deals whose revenue_type is still `unknown` — must be resolved. */
  unknown: number;
  /** Count of won deals whose revenue_type is still `unknown`. */
  unknownCount: number;
}

/** The recently-closed reconcile window the won/booked set is bounded to (PSG-463). */
export interface WonBookedWindow {
  /** Width of the window in days (the `closedWithinDays` option, default 90). */
  days: number;
  /** Inclusive lower bound — ISO date (`asOf - days`). */
  start: string;
  /** Inclusive upper bound — ISO date (`asOf`). */
  end: string;
}

export interface DealsExport {
  generatedAt: string; // ISO (the `asOf` the caller passed)
  forecast: PipelineForecast; // open-only rollups (committed/weighted/best-case + perStage)
  openDeals: OpenDealRow[];
  /** Disjoint from `openDeals` — realized revenue in the recently-closed window,
   *  reconciled vs Invoiced MRR. */
  wonBooked: WonBookedRow[];
  wonBookedTotal: number;
  /** wonBookedTotal split by revenue_type — recurring nets vs MRR, one_time is additive. */
  wonBookedByType: WonBookedByType;
  /** The recently-closed window `wonBooked` is bounded to (PSG-463). */
  wonBookedWindow: WonBookedWindow;
  /**
   * Σ `monthlyValue` over recurring rows with a NON-null `monthlyValue` (PSG-468) — the
   * normalized monthly figure John subtracts from Invoiced MRR (~$75.2K). Recurring rows
   * with a null basis are NOT in this sum; they are flagged below for manual reconcile. */
  wonBookedRecurringMonthlyTotal: number;
  /**
   * Count of recurring rows whose `monthlyValue` is null (basis underivable). These are
   * counted, never mechanically netted — they must be resolved by hand before the tie-out. */
  wonBookedRecurringMonthlyNullCount: number;
  diagnostics: DealDiagnostics;
}

/** Build the structured export from the mirrored deal set. */
export function buildDealsExport(
  deals: readonly PipedriveDeal[],
  opts: DealsExportOptions,
): DealsExport {
  const forecast = buildForecast(deals, opts);
  const diagnostics = diagnoseDeals(deals, {
    asOf: opts.asOf,
    staleDays: opts.staleDays,
    wonStageIds: opts.wonStageIds,
  });
  const stale = new Set(diagnostics.staleDealIds);

  const openDeals: OpenDealRow[] = deals
    .filter((d) => d.status === "open")
    .map((d) => ({
      dealId: d.dealId,
      title: d.title,
      value: Number.isFinite(d.value) ? d.value : 0,
      currency: d.currency,
      stageId: d.stageId,
      stageName: d.stageName,
      status: d.status,
      ownerId: d.ownerId,
      ownerName: d.ownerName,
      expectedCloseDate: d.expectedCloseDate,
      lastActivityDate: d.lastActivityDate,
      stale: stale.has(d.dealId),
    }));

  // PSG-463 — recently-closed reconcile window. A won deal counts only when its
  // ACTUAL closeDate is in [asOf - closedWithinDays, asOf]; a null closeDate cannot be
  // placed in the window and is excluded (it can't be reconciled by date).
  const windowDays = opts.closedWithinDays ?? DEFAULT_CLOSED_WITHIN_DAYS;
  const endMs = opts.asOf.getTime();
  const startMs = endMs - windowDays * MS_PER_DAY;
  const wonBookedWindow: WonBookedWindow = {
    days: windowDays,
    start: new Date(startMs).toISOString().slice(0, 10),
    end: new Date(endMs).toISOString().slice(0, 10),
  };

  const wonBooked: WonBookedRow[] = deals
    .filter((d) => d.status === "won" && inWindow(d.closeDate, startMs, endMs))
    .map((d) => {
      // Honest-not-guessed: resolve from a custom-field key when configured, else the
      // sync-populated mirror value, else `unknown` — never a silently-defaulted bucket.
      const revenueType = resolveRevenueType(d, opts);
      return {
        dealId: d.dealId,
        orgName: d.orgName,
        title: d.title,
        value: Number.isFinite(d.value) ? d.value : 0,
        currency: d.currency,
        closeDate: d.closeDate,
        revenueType,
        // PSG-468 — monthly MRR basis only for recurring rows; honest-null otherwise (and
        // null too when the recurring deal's basis was underivable upstream).
        monthlyValue:
          revenueType === "recurring" && Number.isFinite(d.monthlyValue ?? NaN)
            ? (d.monthlyValue as number)
            : null,
      };
    });

  // John's §2.1 hard tie-out (elevated from "recommend" → REQUIRED): the three
  // revenue_type subtotals MUST reconcile EXACTLY to wonBookedTotal. revenue_type is an
  // exhaustive partition of the row set ({recurring, one_time, unknown} — resolveRevenueType
  // never returns anything else), so the raw subset sums add up to the raw total with no
  // gap. To keep the tie exact at the *rounded* (cents) level too — independently rounding
  // each subtotal can drift ~1¢ from a separately-rounded grand total on sub-cent inputs —
  // we round each part once and DEFINE the headline as the sum of those parts. The headline
  // therefore always equals the sum of its disclosed parts, which is the honest contract for
  // a reconciliation artifact. assertTieOut() below fails loud if this invariant ever breaks.
  const sumWhere = (pred: (r: WonBookedRow) => boolean) =>
    round2(wonBooked.filter(pred).reduce((s, d) => s + d.value, 0));
  const wonBookedByType: WonBookedByType = {
    recurring: sumWhere((d) => d.revenueType === "recurring"),
    oneTime: sumWhere((d) => d.revenueType === "one_time"),
    unknown: sumWhere((d) => d.revenueType === "unknown"),
    unknownCount: wonBooked.filter((d) => d.revenueType === "unknown").length,
  };
  const wonBookedTotal = round2(
    wonBookedByType.recurring + wonBookedByType.oneTime + wonBookedByType.unknown,
  );
  assertTieOut(wonBookedTotal, wonBookedByType);

  // PSG-468 — netting-ready monthly basis. Σ monthlyValue over recurring rows that HAVE a
  // non-null basis (the figure John subtracts from Invoiced MRR); recurring rows with a
  // null basis are counted separately for manual reconcile, never folded into the sum.
  const recurringRows = wonBooked.filter((r) => r.revenueType === "recurring");
  const wonBookedRecurringMonthlyTotal = round2(
    recurringRows.reduce((s, r) => s + (r.monthlyValue ?? 0), 0),
  );
  const wonBookedRecurringMonthlyNullCount = recurringRows.filter(
    (r) => r.monthlyValue === null,
  ).length;

  return {
    generatedAt: opts.asOf.toISOString(),
    forecast,
    openDeals,
    wonBooked,
    wonBookedTotal,
    wonBookedByType,
    wonBookedWindow,
    wonBookedRecurringMonthlyTotal,
    wonBookedRecurringMonthlyNullCount,
    diagnostics,
  };
}

/**
 * The §2.1 reconciliation invariant John depends on: the three revenue_type subtotals
 * tie EXACTLY to the headline. Pure + exported so the same check backs both the
 * build-time guard (in `buildDealsExport`) and Tess's QA assertion (PSG-447) — one
 * definition of "ties out", not two that can drift. Returns the (signed) cent gap;
 * `0` means an exact tie.
 */
export function wonBookedTieOutGap(
  wonBookedTotal: number,
  byType: WonBookedByType,
): number {
  return round2(
    wonBookedTotal - (byType.recurring + byType.oneTime + byType.unknown),
  );
}

/** Fail loud if the revenue_type split ever stops reconciling to the headline. */
function assertTieOut(wonBookedTotal: number, byType: WonBookedByType): void {
  const gap = wonBookedTieOutGap(wonBookedTotal, byType);
  if (gap !== 0) {
    throw new Error(
      `won/booked revenue_type subtotals do not tie out to wonBookedTotal ` +
        `(recurring ${byType.recurring} + one_time ${byType.oneTime} + ` +
        `unknown ${byType.unknown} != ${wonBookedTotal}; gap ${gap})`,
    );
  }
}

/** True when an ISO `closeDate` (date-only) falls inclusively within [startMs, endMs]. */
function inWindow(closeDate: string | null, startMs: number, endMs: number): boolean {
  if (!closeDate) return false;
  const t = Date.parse(closeDate);
  if (Number.isNaN(t)) return false;
  return t >= startMs && t <= endMs;
}

/**
 * Resolve a won deal's `revenue_type` (PSG-463). Precedence: (1) an options-supplied
 * custom-field key, mapped deterministically; (2) the sync-populated mirror value; else
 * `unknown`. Pipedrive carries no native recurring flag, so an unmapped deal is honestly
 * `unknown` and never netted against MRR by default.
 */
function resolveRevenueType(
  deal: PipedriveDeal,
  opts: DealsExportOptions,
): WonBookedRevenueType {
  if (opts.revenueTypeFieldKey) {
    const mapped = mapRevenueTypeValue(
      deal.customFields?.[opts.revenueTypeFieldKey],
      opts.revenueTypeMap,
    );
    if (mapped) return mapped;
  }
  if (deal.revenueType === "recurring" || deal.revenueType === "one_time") {
    return deal.revenueType;
  }
  return "unknown";
}

/** Deterministically map a raw custom-field value to a revenue_type, or null if unrecognized. */
function mapRevenueTypeValue(
  raw: unknown,
  map?: Record<string, RevenueType>,
): RevenueType | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const key = String(raw);
  if (map) {
    const m = map[key];
    return m === "recurring" || m === "one_time" ? m : null;
  }
  const norm = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (norm === "recurring") return "recurring";
  if (norm === "one_time" || norm === "onetime") return "one_time";
  return null;
}

// ── serializers ──────────────────────────────────────────────────────────────────

export function dealsExportToJSON(
  exp: DealsExport,
): Record<string, unknown> {
  return {
    generatedAt: exp.generatedAt,
    summary: {
      openDealCount: exp.forecast.openDealCount,
      totalOpenPipeline: exp.forecast.bestCaseValue,
      committedValue: exp.forecast.committedValue,
      committedWeightedValue: exp.forecast.committedWeightedValue,
      committedDealCount: exp.forecast.committedDealCount,
      weightedValue: exp.forecast.weightedValue,
      bestCaseValue: exp.forecast.bestCaseValue,
      currency: exp.forecast.currency,
      staleDealCount: exp.diagnostics.staleDealIds.length,
      staleValue: exp.diagnostics.staleValue,
      wonBookedCount: exp.wonBooked.length,
      wonBookedTotal: exp.wonBookedTotal,
      wonBookedWindowDays: exp.wonBookedWindow.days,
      wonBookedWindowStart: exp.wonBookedWindow.start,
      wonBookedWindowEnd: exp.wonBookedWindow.end,
      wonBookedRecurringTotal: exp.wonBookedByType.recurring,
      wonBookedOneTimeTotal: exp.wonBookedByType.oneTime,
      wonBookedUnknownTotal: exp.wonBookedByType.unknown,
      wonBookedUnknownCount: exp.wonBookedByType.unknownCount,
      // PSG-468 — monthly MRR basis John nets vs Invoiced MRR, + unresolved-basis count.
      wonBookedRecurringMonthlyTotal: exp.wonBookedRecurringMonthlyTotal,
      wonBookedRecurringMonthlyNullCount: exp.wonBookedRecurringMonthlyNullCount,
      warningCount: exp.diagnostics.warnings.length,
    },
    perStage: exp.forecast.perStage,
    openDeals: exp.openDeals,
    wonBooked: exp.wonBooked,
    warnings: exp.diagnostics.warnings,
  };
}

function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function row(cells: unknown[]): string {
  return cells.map((c) => csvEscape(cell(c))).join(",");
}

/**
 * RFC-4180 CSV with named sections (SUMMARY / PER-STAGE / OPEN DEALS / WON-BOOKED /
 * WARNINGS). One file Reese can open in Sheets; the won/booked block is clearly a
 * separate section so it is never mistaken for open pipeline.
 */
export function dealsExportToCSV(exp: DealsExport): string {
  const f = exp.forecast;
  const lines: string[] = [];

  lines.push(row(["SECTION", "SUMMARY"]));
  lines.push(row(["metric", "value"]));
  lines.push(row(["generated_at", exp.generatedAt]));
  lines.push(row(["currency", f.currency]));
  lines.push(row(["open_deal_count", f.openDealCount]));
  lines.push(row(["total_open_pipeline", f.bestCaseValue]));
  lines.push(row(["committed_value", f.committedValue]));
  lines.push(row(["committed_weighted_value", f.committedWeightedValue]));
  lines.push(row(["committed_deal_count", f.committedDealCount]));
  lines.push(row(["weighted_value", f.weightedValue]));
  lines.push(row(["best_case_value", f.bestCaseValue]));
  lines.push(row(["stale_deal_count", exp.diagnostics.staleDealIds.length]));
  lines.push(row(["stale_value", exp.diagnostics.staleValue]));
  lines.push(row(["won_booked_count", exp.wonBooked.length]));
  lines.push(row(["won_booked_total", exp.wonBookedTotal]));
  lines.push(row(["won_booked_window_days", exp.wonBookedWindow.days]));
  lines.push(row(["won_booked_window_start", exp.wonBookedWindow.start]));
  lines.push(row(["won_booked_window_end", exp.wonBookedWindow.end]));
  lines.push(row(["won_booked_recurring_total", exp.wonBookedByType.recurring]));
  lines.push(row(["won_booked_one_time_total", exp.wonBookedByType.oneTime]));
  lines.push(row(["won_booked_unknown_total", exp.wonBookedByType.unknown]));
  lines.push(row(["won_booked_unknown_count", exp.wonBookedByType.unknownCount]));
  lines.push(row(["won_booked_recurring_monthly_total", exp.wonBookedRecurringMonthlyTotal]));
  lines.push(row(["won_booked_recurring_monthly_null_count", exp.wonBookedRecurringMonthlyNullCount]));
  lines.push("");

  lines.push(row(["SECTION", "PER-STAGE"]));
  lines.push(row(["stage_id", "stage_name", "count", "value", "probability", "weighted_value"]));
  for (const s of f.perStage) {
    lines.push(row([s.stageId, s.stageName, s.count, s.value, s.probability, s.weightedValue]));
  }
  lines.push("");

  lines.push(row(["SECTION", "OPEN DEALS"]));
  lines.push(
    row([
      "deal_id", "title", "value", "currency", "stage_id", "stage_name",
      "status", "owner_id", "owner_name", "expected_close_date",
      "last_activity_date", "stale",
    ]),
  );
  for (const d of exp.openDeals) {
    lines.push(
      row([
        d.dealId, d.title, d.value, d.currency, d.stageId, d.stageName,
        d.status, d.ownerId, d.ownerName, d.expectedCloseDate,
        d.lastActivityDate, d.stale ? "yes" : "no",
      ]),
    );
  }
  lines.push("");

  lines.push(row([
    "SECTION",
    `WON-BOOKED (DISTINCT — closed ${exp.wonBookedWindow.start}..${exp.wonBookedWindow.end} (${exp.wonBookedWindow.days}d); reconcile vs Invoiced MRR, do NOT sum into pipeline)`,
  ]));
  lines.push(row(["deal_id", "org_name", "title", "value", "currency", "close_date", "revenue_type", "monthly_value"]));
  for (const d of exp.wonBooked) {
    lines.push(row([d.dealId, d.orgName, d.title, d.value, d.currency, d.closeDate, d.revenueType, d.monthlyValue]));
  }
  lines.push(row(["TOTAL", "", "", exp.wonBookedTotal, f.currency, "", "", ""]));
  lines.push(row(["RECURRING (face $)", "", "", exp.wonBookedByType.recurring, f.currency, "", "recurring", ""]));
  // PSG-468 — the normalized monthly basis John nets vs Invoiced MRR (NOT the face-$ above);
  // monthly_value carries the Σ, and the label flags how many recurring rows are unresolved.
  lines.push(row([
    `RECURRING MONTHLY (Σ vs Invoiced MRR; ${exp.wonBookedRecurringMonthlyNullCount} unresolved/manual)`,
    "", "", "", f.currency, "", "recurring", exp.wonBookedRecurringMonthlyTotal,
  ]));
  lines.push(row(["ONE-TIME (additive)", "", "", exp.wonBookedByType.oneTime, f.currency, "", "one_time", ""]));
  lines.push(row(["UNKNOWN (resolve before tie-out)", "", "", exp.wonBookedByType.unknown, f.currency, "", "unknown", ""]));
  lines.push("");

  if (exp.diagnostics.warnings.length > 0) {
    lines.push(row(["SECTION", "WARNINGS"]));
    lines.push(row(["kind", "deal_id", "stage_id", "stage_name", "value", "message"]));
    for (const w of exp.diagnostics.warnings) {
      lines.push(row([w.kind, w.dealId, w.stageId, w.stageName, w.value, w.message]));
    }
  }

  return lines.join("\r\n");
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
