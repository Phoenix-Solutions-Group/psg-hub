// v1.6 / 17-A — Live month-to-date intel-spend reader (server-only).
// The budget.ts module is pure: it turns logged token counts into USD and decides WHEN the
// router must stop. This is the one place that actually reads those counts off the DB. It
// sums the current calendar month's `intel:` calls from llm_call_log into a USD figure that
// makeGroundedResearcher / makeNarrativeGenerator hand the router as `monthToDateSpendUsd`,
// so the G5 cost cap is enforced against real spend rather than a hard-coded guess. Kept out
// of budget.ts so that module stays node-testable and free of the server-only DB chain.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { totalSpendUsd, type SpendLogRow } from "./budget";

/** The llm_call_log columns we need to cost a call. */
type SpendLogDbRow = {
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
};

/**
 * First instant of the calendar month containing `now`, in UTC. The cap is a monthly
 * ceiling, so the window resets at the UTC month boundary (matching the timestamptz the DB
 * stores). Injected `now` keeps callers + tests deterministic.
 */
function startOfCalendarMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/**
 * Sum month-to-date intel spend in USD from llm_call_log.
 *
 * Reads every `intel:`-purpose call logged since the start of the current calendar month and
 * costs it via budget.ts `totalSpendUsd` (no new rates are introduced here). The `purposePrefix`
 * default of "intel:" matches makeRouterLogger, which prefixes every router call's purpose with
 * "intel:". Throws on a read error rather than returning 0: the caller's degrade path treats a
 * thrown error as "do not start a metered call", which is the fail-closed choice (better to skip
 * grounding than to spend blind when we cannot read the ledger).
 */
export async function monthToDateSpendUsd(
  service: SupabaseClient,
  opts?: { now?: Date; purposePrefix?: string },
): Promise<number> {
  const now = opts?.now ?? new Date();
  const prefix = opts?.purposePrefix ?? "intel:";
  const since = startOfCalendarMonthUtc(now).toISOString();

  const { data, error } = await service
    .from("llm_call_log")
    .select("model_id, input_tokens, output_tokens")
    .gte("created_at", since)
    .ilike("purpose", `${prefix}%`);

  if (error) {
    throw new Error(`monthToDateSpendUsd: failed to read llm_call_log: ${error.message}`);
  }

  const rows: SpendLogRow[] = ((data ?? []) as SpendLogDbRow[]).map((r) => ({
    modelId: r.model_id ?? null,
    inputTokens: r.input_tokens ?? null,
    outputTokens: r.output_tokens ?? null,
  }));
  return totalSpendUsd(rows);
}
