import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsSource } from "./types";

/**
 * PSG-533 — analytics silent-stall health check.
 *
 * Guardrail born from the 06-30 -> 07-01 PSG-532 incident: the ingest crons kept
 * returning status='success' with rows_written=0 for 3+ days (a wrong
 * GOOGLE_OAUTH_CLIENT_SECRET after rotation downed every Google vertical) and
 * NOTHING alerted, because "the cron ran" looked healthy. This is the smallest
 * check that would have caught it within ~24h:
 *
 *   - STALL: for a source, the last N terminal runs are ALL status='success' but
 *     rows_written=0 (N=2 daily). A pipeline that "succeeds" while writing zero
 *     rows for two scheduled runs is effectively down.
 *   - ERROR_RUN: the most recent terminal run for a source is status='error'.
 *   - ACCOUNT_ERROR: any google_oauth_accounts / google_ads_accounts row sitting
 *     at status='error' (the "needs re-link" state the PSG-533 mapper fix now
 *     sets on invalid_client).
 *
 * Deliberately NOT a monitoring stack: it returns a structured report the cron
 * route logs as operator-visible lines (wire to email/Slack/`/ops`). Read-only;
 * service-role (the ledger is default-deny RLS).
 */

/** Daily ingest sources tracked in analytics_sync_runs. */
export const MONITORED_SOURCES: readonly AnalyticsSource[] = [
  "semrush",
  "google_ads",
  "ga4",
  "gsc",
  "gbp",
] as const;

export type HealthAlertKind =
  | "stall"
  | "error_run"
  | "oauth_account_error"
  | "ads_account_error";

export type HealthAlert = {
  kind: HealthAlertKind;
  /** Ingest source for pipeline alerts; null for account-level alerts. */
  source: AnalyticsSource | null;
  /** Human-readable, secret-free summary for the operator log line. */
  detail: string;
};

export type AnalyticsHealthReport = {
  ok: boolean;
  checkedAt: string;
  alerts: HealthAlert[];
};

export type CheckAnalyticsHealthOptions = {
  /** Consecutive success-but-zero-rows runs that trip a stall. Default 2. */
  zeroRunThreshold?: number;
  /** Sources to inspect. Default MONITORED_SOURCES. */
  sources?: readonly AnalyticsSource[];
  /** Injectable clock (UTC ISO) — keeps the check deterministic under test. */
  now?: () => Date;
};

type TerminalRun = { status: "success" | "error"; rows_written: number };

/**
 * A source stalls when its most-recent `threshold` TERMINAL runs (success|error,
 * newest first) exist AND are every one status='success' with rows_written=0.
 * Fewer than `threshold` terminal runs = not enough evidence yet (no alert).
 */
export function isStalled(runs: TerminalRun[], threshold: number): boolean {
  if (threshold < 1) return false;
  if (runs.length < threshold) return false;
  const window = runs.slice(0, threshold);
  return window.every((r) => r.status === "success" && r.rows_written === 0);
}

export async function checkAnalyticsHealth(
  service: SupabaseClient,
  options: CheckAnalyticsHealthOptions = {}
): Promise<AnalyticsHealthReport> {
  const threshold = options.zeroRunThreshold ?? 2;
  const sources = options.sources ?? MONITORED_SOURCES;
  const now = options.now ?? (() => new Date());
  const alerts: HealthAlert[] = [];

  for (const source of sources) {
    // Only TERMINAL runs count — an in-flight 'running' row must not mask a
    // genuine stall or be read as a fresh success. Newest first, small window.
    const { data, error } = await service
      .from("analytics_sync_runs")
      .select("status, rows_written")
      .eq("source", source)
      .in("status", ["success", "error"])
      .order("started_at", { ascending: false })
      .limit(threshold);

    if (error) {
      alerts.push({
        kind: "error_run",
        source,
        detail: `${source}: could not read sync ledger (${error.message})`,
      });
      continue;
    }

    const runs = (data ?? []) as TerminalRun[];
    if (runs.length === 0) continue; // never-run source: not this check's job

    if (runs[0].status === "error") {
      alerts.push({
        kind: "error_run",
        source,
        detail: `${source}: most recent sync run failed (status=error)`,
      });
    } else if (isStalled(runs, threshold)) {
      alerts.push({
        kind: "stall",
        source,
        detail: `${source}: last ${threshold} sync runs succeeded but wrote 0 rows — pipeline effectively down`,
      });
    }
  }

  // Account-level "needs re-link" states (the PSG-533 invalid_client fix flips
  // accounts here). Read id + shop_id only; never the token or last_error text.
  const { data: oauthErr } = await service
    .from("google_oauth_accounts")
    .select("id, shop_id, source")
    .eq("status", "error");
  for (const row of (oauthErr ?? []) as {
    id: string;
    shop_id: string | null;
    source: string;
  }[]) {
    alerts.push({
      kind: "oauth_account_error",
      source: null,
      detail: `google_oauth_accounts ${row.source} for shop ${row.shop_id ?? "?"} is in error (needs re-link)`,
    });
  }

  const { data: adsErr } = await service
    .from("google_ads_accounts")
    .select("id, shop_id")
    .eq("status", "error");
  for (const row of (adsErr ?? []) as { id: string; shop_id: string | null }[]) {
    alerts.push({
      kind: "ads_account_error",
      source: null,
      detail: `google_ads_accounts for shop ${row.shop_id ?? "?"} is in error (needs re-link)`,
    });
  }

  return {
    ok: alerts.length === 0,
    checkedAt: now().toISOString(),
    alerts,
  };
}
