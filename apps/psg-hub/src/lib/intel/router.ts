// v1.6 / 16-01 — Multi-LLM router.
// One dispatch path for the whole internal agentic stack. Given a TaskProfile it walks
// the catalog's candidate chain, skips providers not in the enabled allowlist (the G5
// gate), and runs the first usable candidate under that provider's CircuitBreaker +
// withRetry (same resilience primitives as every other external call in this repo). On
// failure it falls through to the next candidate (cross-provider fallback) and only
// throws once every usable candidate is exhausted. Pure + node-testable: the model call
// and logger are injected via deps, exactly like report/narrative.ts.

import { CircuitBreaker, CircuitOpenError, withRetry } from "@/lib/resilience";
import type { LLMCallResult } from "@/lib/logging/llm-call";
import { applySpendCap } from "./budget";
import { DEFAULT_ENABLED_PROVIDERS, MODEL_CATALOG } from "./catalog";
import type {
  ModelSpec,
  Provider,
  RouteAttempt,
  RouteDeps,
  RouteInput,
  RouteResult,
  TaskProfile,
} from "./types";

/** No candidate in the profile belongs to an enabled provider (e.g. G5 not yet cleared). */
export class NoEnabledProviderError extends Error {
  constructor(
    readonly profile: TaskProfile,
    readonly candidateProviders: Provider[],
    readonly enabledProviders: readonly Provider[],
  ) {
    super(
      `No enabled provider for profile "${profile}". Candidates need one of ` +
        `[${candidateProviders.join(", ")}]; enabled: [${enabledProviders.join(", ")}]. ` +
        `Non-Anthropic providers require board approval G5 (vendor spend).`,
    );
    this.name = "NoEnabledProviderError";
  }
}

/** Every usable candidate was attempted and failed. Carries the per-attempt trail. */
export class AllCandidatesFailedError extends Error {
  constructor(
    readonly profile: TaskProfile,
    readonly attempts: RouteAttempt[],
    readonly cause: unknown,
  ) {
    super(
      `All ${attempts.length} candidate(s) failed for profile "${profile}": ` +
        attempts.map((a) => `${a.model}(${a.errorCode ?? "error"})`).join(", "),
    );
    this.name = "AllCandidatesFailedError";
  }
}

// One breaker per provider — a flaky vendor trips its own circuit without taking the
// others down. Module singletons; resetBreakers() clears them between tests.
const breakers = new Map<Provider, CircuitBreaker>();
function breakerFor(provider: Provider): CircuitBreaker {
  let b = breakers.get(provider);
  if (!b) {
    b = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });
    breakers.set(provider, b);
  }
  return b;
}

/** Test helper: drop all provider breakers so accumulated failures don't leak. */
export function resetBreakers(): void {
  breakers.clear();
}

/** Map an arbitrary thrown error onto the llm_call_log result enum + a short code. */
function classifyError(err: unknown): { result: LLMCallResult; code: string } {
  if (err instanceof CircuitOpenError) return { result: "error", code: "circuit_open" };
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("rate") && lower.includes("limit"))
    return { result: "rate_limited", code: "rate_limited" };
  if (lower.includes("timeout") || lower.includes("etimedout"))
    return { result: "timeout", code: "timeout" };
  return { result: "error", code: msg.slice(0, 80) };
}

/**
 * Resolve the ordered list of candidates the router will actually try: catalog order
 * filtered to enabled providers, optionally reordered cheapest-first.
 * Exported for testing + the activation readiness check.
 */
export function usableCandidates(
  profile: TaskProfile,
  enabledProviders: readonly Provider[],
  preferCheapest = false,
): ModelSpec[] {
  const chain = MODEL_CATALOG[profile];
  const usable = chain.filter((m) => enabledProviders.includes(m.provider));
  if (usable.length === 0) {
    throw new NoEnabledProviderError(
      profile,
      chain.map((m) => m.provider),
      enabledProviders,
    );
  }
  return preferCheapest ? [...usable].sort((a, b) => a.costTier - b.costTier) : usable;
}

/**
 * Route one model call for `profile`. Returns the winning candidate's output plus the
 * full attempt trail. Throws NoEnabledProviderError if nothing is enabled, or
 * AllCandidatesFailedError if every usable candidate failed.
 */
export async function route<T = unknown>(
  profile: TaskProfile,
  input: RouteInput,
  deps: RouteDeps,
): Promise<RouteResult<T>> {
  const enabled = deps.enabledProviders ?? DEFAULT_ENABLED_PROVIDERS;
  const now = deps.now ?? Date.now;
  let candidates = usableCandidates(profile, enabled, deps.preferCheapest);

  // G5 cost cap: once month-to-date spend hits the ceiling, refuse to start a new metered
  // call — narrow to the in-budget Anthropic path (or throw if the profile has none).
  if (deps.spendCapUsd != null && deps.monthToDateSpendUsd) {
    const spent = await deps.monthToDateSpendUsd();
    candidates = applySpendCap(candidates, spent, deps.spendCapUsd, profile);
  }

  const attempts: RouteAttempt[] = [];
  let lastError: unknown;

  for (const spec of candidates) {
    const breaker = breakerFor(spec.provider);
    const startedAt = now();
    try {
      const result = await breaker.execute(() =>
        withRetry(
          () =>
            deps.generate({
              model: spec.model,
              system: input.system,
              prompt: input.prompt,
              schema: input.schema,
            }),
          { retries: deps.retries ?? 2 },
        ),
      );
      const latencyMs = now() - startedAt;
      attempts.push({ provider: spec.provider, model: spec.model, ok: true, latencyMs });
      await deps.logCall?.({
        purpose: profile,
        modelId: spec.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs,
        result: "success",
      });
      return {
        output: result.output as T,
        provider: spec.provider,
        model: spec.model,
        usage: result.usage,
        attempts,
      };
    } catch (err) {
      lastError = err;
      const latencyMs = now() - startedAt;
      const { result, code } = classifyError(err);
      attempts.push({ provider: spec.provider, model: spec.model, ok: false, latencyMs, errorCode: code });
      await deps.logCall?.({
        purpose: profile,
        modelId: spec.model,
        inputTokens: null,
        outputTokens: null,
        latencyMs,
        result,
        errorCode: code,
      });
      // fall through to the next candidate (cross-provider fallback)
    }
  }

  throw new AllCandidatesFailedError(profile, attempts, lastError);
}
