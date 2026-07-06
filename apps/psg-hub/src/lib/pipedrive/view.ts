// PSG-594 — Sales Pipeline review screen presenter (pure, no DB / no token).
// Maps the finished `DealsExport` (from buildDealsExport / the mirror read-path) into a
// serializable, display-ready view model for the superadmin `/ops/sales-pipeline` page.
//
// CONTRACT: this NEVER recomputes any forecast figure. Every number is read straight off
// the `DealsExport` that `buildDealsExport` (PSG-446, QA-passed) already produced — the
// open-pipeline rollups from `forecast`, the DISTINCT won/booked line from `wonBooked*`.
// The open totals and the won/booked line are kept as separate fields on purpose so the
// UI can render them visually distinct and never fold realized revenue into the pipeline.
// This module is fully unit-tested against the pure lib (see __tests__/view.test.ts).

import type { DealsExport } from "./export";

/** Freshness read off the latest `pipedrive_sync_runs` row (or null if never synced). */
export interface SyncRunFreshness {
  /** When the last sync started (ISO), or null. */
  startedAt: string | null;
  /** When the last sync finished (ISO), or null if it never finished. */
  finishedAt: string | null;
  /** Whether the last run succeeded. */
  ok: boolean | null;
  /** Open-deal count the sync recorded. */
  openDeals: number | null;
  /** Total-deal count the sync recorded (the mirror row count). */
  totalDeals: number | null;
}

/** One S0–S8 stage line for the breakdown table. */
export interface StageView {
  stageId: number | null;
  stageName: string | null;
  /** Number of open deals in this stage. */
  count: number;
  /** Σ face-$ of open deals in this stage (un-weighted). */
  value: number;
  /** Σ (value × probability) — expected contribution of this stage. */
  weightedValue: number;
  /** Effective stage win-probability as a whole percent (0–100), for display. */
  probabilityPct: number;
}

/** The DISTINCT won/booked reconciled line — kept separate from the open pipeline. */
export interface WonBookedView {
  count: number;
  total: number;
  recurring: number;
  oneTime: number;
  unknown: number;
  unknownCount: number;
  /** Σ normalized monthly MRR basis over recurring rows (PSG-468). */
  recurringMonthlyTotal: number;
  /** Recurring rows whose monthly basis could not be derived (manual reconcile). */
  recurringMonthlyNullCount: number;
  /** The recently-closed reconcile window this line is bounded to. */
  window: {
    start: string;
    end: string;
    days: number;
    endExclusive: boolean;
    timeZone: string;
  };
}

/** The full, display-ready sales-pipeline view model. */
export interface SalesPipelineView {
  /** The `asOf` the export was built for (ISO). */
  generatedAt: string;
  currency: string;
  // ── Open pipeline (never includes won/booked) ──
  openDealCount: number;
  /** Total open-pipeline $ — the un-weighted best case (`forecast.bestCaseValue`). */
  totalOpenPipeline: number;
  /** Probability-weighted / expected midpoint of the open pipeline. */
  weightedValue: number;
  /** Committed floor (≥ S6 / Contract), face $. */
  committedValue: number;
  committedDealCount: number;
  /** S0–S8 breakdown, ordered by stageId ascending (as the forecast emits it). */
  perStage: StageView[];
  // ── Won/booked (DISTINCT reconciled line) ──
  wonBooked: WonBookedView;
  // ── Freshness ──
  freshness: {
    /** Best available "last synced" instant: finished, else started, else null. */
    lastSyncedAt: string | null;
    ok: boolean | null;
    openDeals: number | null;
    totalDeals: number | null;
  };
}

/**
 * Build the page view model from an already-computed `DealsExport` + the latest sync-run
 * freshness. Pure and total — reads values verbatim off `exp`, never recomputes them.
 */
export function buildSalesPipelineView(
  exp: DealsExport,
  syncRun: SyncRunFreshness | null,
): SalesPipelineView {
  const f = exp.forecast;
  return {
    generatedAt: exp.generatedAt,
    currency: f.currency,
    openDealCount: f.openDealCount,
    totalOpenPipeline: f.bestCaseValue,
    weightedValue: f.weightedValue,
    committedValue: f.committedValue,
    committedDealCount: f.committedDealCount,
    perStage: f.perStage.map((s) => ({
      stageId: s.stageId,
      stageName: s.stageName,
      count: s.count,
      value: s.value,
      weightedValue: s.weightedValue,
      // Display-only: the export's fractional probability [0,1] → whole percent.
      probabilityPct: Math.round(s.probability * 100),
    })),
    wonBooked: {
      count: exp.wonBooked.length,
      total: exp.wonBookedTotal,
      recurring: exp.wonBookedByType.recurring,
      oneTime: exp.wonBookedByType.oneTime,
      unknown: exp.wonBookedByType.unknown,
      unknownCount: exp.wonBookedByType.unknownCount,
      recurringMonthlyTotal: exp.wonBookedRecurringMonthlyTotal,
      recurringMonthlyNullCount: exp.wonBookedRecurringMonthlyNullCount,
      window: {
        start: exp.wonBookedWindow.start,
        end: exp.wonBookedWindow.end,
        days: exp.wonBookedWindow.days,
        endExclusive: exp.wonBookedWindow.endExclusive,
        timeZone: exp.wonBookedWindow.timeZone,
      },
    },
    freshness: {
      lastSyncedAt: syncRun?.finishedAt ?? syncRun?.startedAt ?? null,
      ok: syncRun?.ok ?? null,
      openDeals: syncRun?.openDeals ?? null,
      totalDeals: syncRun?.totalDeals ?? null,
    },
  };
}

// ── display formatters (shared by the page render) ──────────────────────────────

/** Whole-dollar money for stat cards / tables (no cents — board-facing summary). */
export function formatMoney(n: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

/** Thousands-separated integer count. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

/**
 * Human freshness label for the last-synced timestamp. Pure given `now` so it is
 * deterministically testable; the page passes `new Date()`.
 */
export function formatSyncedAgo(iso: string | null, now: Date): string {
  if (!iso) return "never synced";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const mins = Math.max(0, Math.floor((now.getTime() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
