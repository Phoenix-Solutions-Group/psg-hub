// v1.6 / 16-01 — Server wiring for the router (the G5 gate lives here).
// Resolves which providers are allowed from env and builds the production logger onto the
// existing llm_call_log sink. This is the one place the activation flag is read: until
// the board clears G5 and INTEL_ENABLED_PROVIDERS is set in Vercel, only Anthropic runs.

import "server-only";
import { logLLMCall, type LLMCallResult } from "@/lib/logging/llm-call";
import { DEFAULT_ENABLED_PROVIDERS } from "./catalog";
import type { Provider, RouterLogFn } from "./types";

const KNOWN_PROVIDERS: readonly Provider[] = ["anthropic", "openai", "google", "perplexity"];

/**
 * Enabled providers from env. `INTEL_ENABLED_PROVIDERS` is a comma list of provider ids;
 * unset/empty falls back to Anthropic-only (build-local posture). Unknown tokens are
 * ignored. Anthropic is always implicitly allowed since it runs on the in-budget binding.
 */
export function resolveEnabledProviders(
  raw = process.env.INTEL_ENABLED_PROVIDERS,
): readonly Provider[] {
  if (!raw || !raw.trim()) return DEFAULT_ENABLED_PROVIDERS;
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Provider => (KNOWN_PROVIDERS as string[]).includes(s));
  const set = new Set<Provider>(["anthropic", ...parsed]);
  return Array.from(set);
}

/**
 * Build a RouterLogFn that writes to llm_call_log. Internal agentic calls have no review
 * row and usually no per-user attribution, so those default to null; pass a shopId when
 * the call is scoped to one shop (e.g. its competitor report).
 */
export function makeRouterLogger(ctx: {
  shopId?: string | null;
  userId?: string | null;
}): RouterLogFn {
  return (entry) =>
    logLLMCall({
      userId: ctx.userId ?? null,
      shopId: ctx.shopId ?? null,
      reviewId: null,
      purpose: `intel:${entry.purpose}`,
      modelId: entry.modelId,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      latencyMs: entry.latencyMs,
      result: entry.result as LLMCallResult,
      errorCode: entry.errorCode ?? null,
    });
}
