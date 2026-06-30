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
}

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
   * REQUIRED column (PSG-435 / John's §2.1). Always carried (value or explicit null):
   * `recurring` → netted out vs Invoiced MRR; `one_time` → additive net-new; `null`
   * (unknown) → source not yet mapped, NEVER netted by default — surfaced as a distinct
   * subtotal so the gap is resolved before the tie-out.
   */
  revenueType: RevenueType | null;
}

/** Σ face-$ of the won/booked set split by revenue_type, for John's reconciliation. */
export interface WonBookedByType {
  recurring: number;
  oneTime: number;
  /** Σ value of won deals whose revenue_type is still unknown (null) — must be resolved. */
  unknown: number;
  /** Count of won deals whose revenue_type is still unknown (null). */
  unknownCount: number;
}

export interface DealsExport {
  generatedAt: string; // ISO (the `asOf` the caller passed)
  forecast: PipelineForecast; // open-only rollups (committed/weighted/best-case + perStage)
  openDeals: OpenDealRow[];
  /** Disjoint from `openDeals` — realized revenue, reconciled vs Invoiced MRR. */
  wonBooked: WonBookedRow[];
  wonBookedTotal: number;
  /** wonBookedTotal split by revenue_type — recurring nets vs MRR, one_time is additive. */
  wonBookedByType: WonBookedByType;
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

  const wonBooked: WonBookedRow[] = deals
    .filter((d) => d.status === "won")
    .map((d) => ({
      dealId: d.dealId,
      orgName: d.orgName,
      title: d.title,
      value: Number.isFinite(d.value) ? d.value : 0,
      currency: d.currency,
      closeDate: d.closeDate,
      // Honest-null rule: an unmapped source carries null, never a silent bucket.
      revenueType: d.revenueType ?? null,
    }));

  const wonBookedTotal = round2(
    wonBooked.reduce((sum, d) => sum + d.value, 0),
  );

  const sumWhere = (pred: (r: WonBookedRow) => boolean) =>
    round2(wonBooked.filter(pred).reduce((s, d) => s + d.value, 0));
  const wonBookedByType: WonBookedByType = {
    recurring: sumWhere((d) => d.revenueType === "recurring"),
    oneTime: sumWhere((d) => d.revenueType === "one_time"),
    unknown: sumWhere((d) => d.revenueType === null),
    unknownCount: wonBooked.filter((d) => d.revenueType === null).length,
  };

  return {
    generatedAt: opts.asOf.toISOString(),
    forecast,
    openDeals,
    wonBooked,
    wonBookedTotal,
    wonBookedByType,
    diagnostics,
  };
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
      wonBookedRecurringTotal: exp.wonBookedByType.recurring,
      wonBookedOneTimeTotal: exp.wonBookedByType.oneTime,
      wonBookedUnknownTotal: exp.wonBookedByType.unknown,
      wonBookedUnknownCount: exp.wonBookedByType.unknownCount,
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
  lines.push(row(["won_booked_recurring_total", exp.wonBookedByType.recurring]));
  lines.push(row(["won_booked_one_time_total", exp.wonBookedByType.oneTime]));
  lines.push(row(["won_booked_unknown_total", exp.wonBookedByType.unknown]));
  lines.push(row(["won_booked_unknown_count", exp.wonBookedByType.unknownCount]));
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

  lines.push(row(["SECTION", "WON-BOOKED (DISTINCT — reconcile vs Invoiced MRR, do NOT sum into pipeline)"]));
  lines.push(row(["deal_id", "org_name", "title", "value", "currency", "close_date", "revenue_type"]));
  for (const d of exp.wonBooked) {
    lines.push(row([d.dealId, d.orgName, d.title, d.value, d.currency, d.closeDate, d.revenueType ?? "unknown"]));
  }
  lines.push(row(["TOTAL", "", "", exp.wonBookedTotal, f.currency, "", ""]));
  lines.push(row(["RECURRING (net vs MRR)", "", "", exp.wonBookedByType.recurring, f.currency, "", "recurring"]));
  lines.push(row(["ONE-TIME (additive)", "", "", exp.wonBookedByType.oneTime, f.currency, "", "one_time"]));
  lines.push(row(["UNKNOWN (resolve before tie-out)", "", "", exp.wonBookedByType.unknown, f.currency, "", "unknown"]));
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
