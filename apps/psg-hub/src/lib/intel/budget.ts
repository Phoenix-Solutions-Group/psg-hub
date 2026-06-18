// v1.6 / 16-04 — Intel spend cap + cost estimation (build-local, zero vendor spend).
// The G5 gate (the enabled-provider allowlist in router.ts) decides WHETHER the router
// may touch a metered provider; this module decides WHEN it must stop. It turns the
// llm_call_log token counts into USD and enforces a hard month-to-date ceiling, so
// metered (G5) spend can never silently run away — the concrete, enforced guardrail the
// board's G5 cost cap depends on. Pure + node-testable: callers read month-to-date spend
// from the log and hand it in; this module never imports the server-only DB chain.

import { DEFAULT_ENABLED_PROVIDERS } from "./catalog";
import type { ModelSpec, TaskProfile } from "./types";

/** USD per 1,000,000 tokens, split by input vs output. */
export interface CostRate {
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
}

// PROVISIONAL published list rates (USD / 1M tokens). These MUST be verified at G5
// activation alongside the gateway model slugs (catalog.ts) — until G5 the non-Anthropic
// models are never dispatched, so a stale rate here cannot affect live spend. Anthropic
// rates are included so the in-budget path is costed too (the cap covers ALL router
// spend, not only the G5 providers).
export const MODEL_COST_RATES: Record<string, CostRate> = {
  "anthropic/claude-opus-4.8": { inputPerMTok: 15, outputPerMTok: 75 },
  "anthropic/claude-sonnet-4.6": { inputPerMTok: 3, outputPerMTok: 15 },
  "anthropic/claude-haiku-4.5": { inputPerMTok: 1, outputPerMTok: 5 },
  "openai/gpt-5.1": { inputPerMTok: 10, outputPerMTok: 30 },
  "google/gemini-3-pro": { inputPerMTok: 7, outputPerMTok: 21 },
  "google/gemini-3-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  "perplexity/sonar-pro": { inputPerMTok: 3, outputPerMTok: 15 },
};

// Conservative fallback for an unrecognised model id (e.g. a slug renamed at activation):
// price it at the most expensive known rate so an unknown model can never UNDER-count
// spend against the cap. Better to degrade early than to overspend.
const FALLBACK_RATE: CostRate = { inputPerMTok: 15, outputPerMTok: 75 };

/** Resolve the cost rate for a model id, falling back conservatively when unknown. */
export function rateFor(modelId: string | null | undefined): CostRate {
  if (!modelId) return FALLBACK_RATE;
  return MODEL_COST_RATES[modelId] ?? FALLBACK_RATE;
}

/** Estimated USD cost of a single call. Null token counts are treated as zero. */
export function estimateCallCostUsd(
  modelId: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  const rate = rateFor(modelId);
  const inT = inputTokens ?? 0;
  const outT = outputTokens ?? 0;
  return (inT / 1_000_000) * rate.inputPerMTok + (outT / 1_000_000) * rate.outputPerMTok;
}

/** One llm_call_log row, reduced to the fields needed for cost aggregation. */
export interface SpendLogRow {
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Sum estimated USD spend across a set of logged calls (e.g. month-to-date rows). */
export function totalSpendUsd(rows: readonly SpendLogRow[]): number {
  return rows.reduce(
    (sum, r) => sum + estimateCallCostUsd(r.modelId, r.inputTokens, r.outputTokens),
    0,
  );
}

/** Raised when the cap is hit and the profile has no in-budget fallback to degrade to. */
export class SpendCapExceededError extends Error {
  constructor(
    readonly capUsd: number,
    readonly spentUsd: number,
    readonly profile: TaskProfile,
  ) {
    super(
      `Intel spend cap reached for "${profile}": $${spentUsd.toFixed(2)} of ` +
        `$${capUsd.toFixed(2)} month-to-date, and no in-budget fallback candidate is ` +
        `available — refusing to start a new metered call.`,
    );
    this.name = "SpendCapExceededError";
  }
}

/**
 * Enforce the month-to-date hard cap against a resolved candidate list.
 *
 * Under the cap the full list is returned unchanged. At/over the cap the router must not
 * START a new metered (G5) call, so the list is narrowed to the in-budget default
 * providers (the Anthropic gateway, which is the existing in-budget binding). Every task
 * profile carries an Anthropic fallback, so this normally degrades cleanly to build-local
 * behaviour; if a profile somehow has no in-budget candidate, it throws
 * SpendCapExceededError rather than overspending.
 *
 * Pure + synchronous: the caller reads month-to-date spend (from llm_call_log via
 * totalSpendUsd) and passes it in.
 */
export function applySpendCap(
  candidates: ModelSpec[],
  spentUsd: number,
  capUsd: number,
  profile: TaskProfile,
): ModelSpec[] {
  if (spentUsd < capUsd) return candidates;
  const inBudget = candidates.filter((c) => DEFAULT_ENABLED_PROVIDERS.includes(c.provider));
  if (inBudget.length === 0) {
    throw new SpendCapExceededError(capUsd, spentUsd, profile);
  }
  return inBudget;
}
