// v1.6 / 16-01 — Multi-LLM router core types.
// The internal agentic-intelligence stack (competitor engine, agentic reports) routes
// every model call through one router so provider selection, fallback, cost tiering, and
// the G5 vendor-spend gate live in ONE place. Mirrors the Phase-12/14 deps seam
// (report/narrative.ts, reviews/sentiment.ts): the model call + logger are INJECTED, so
// this module is node-testable and never imports the server-only logging chain.

import type { LLMCallResult } from "@/lib/logging/llm-call";

/**
 * Providers the router can dispatch to via the Vercel AI Gateway.
 * Anthropic runs on the existing in-budget gateway binding (same as the live customer
 * report). The others are part of the G5 vendor-spend gate and stay OFF until the board
 * clears G5 and the activation flag flips — see DEFAULT_ENABLED_PROVIDERS.
 */
export type Provider = "anthropic" | "openai" | "google" | "perplexity";

/** Providers gated behind board approval G5 (internal agentic vendor spend). */
export const G5_GATED_PROVIDERS: readonly Provider[] = ["openai", "google", "perplexity"];

/**
 * Task profiles describe the *capability* a caller needs, not a concrete model. The
 * router maps a profile to an ordered candidate chain (see catalog.ts) and picks the
 * first candidate whose provider is enabled.
 */
export type TaskProfile =
  | "reasoning" // deep analysis / consolidator-aware competitor scoring rationale
  | "writer" // long-form grounded narrative (agentic PDF report)
  | "fast_classify" // cheap high-volume structured classification
  | "web_grounded"; // needs live web access (competitor discovery)

/** Relative cost tier for budget-aware selection (1 = cheapest). */
export type CostTier = 1 | 2 | 3 | 4;

export type ModelSpec = {
  provider: Provider;
  /** Gateway slug in dot notation, e.g. "anthropic/claude-sonnet-4.6". */
  model: string;
  costTier: CostTier;
  /** True when this candidate can ground answers with live web access. */
  grounded?: boolean;
};

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * What a caller hands the router. `schema` is an opaque structured-output schema (a Zod
 * schema in practice) forwarded to the generate adapter; when present the adapter uses
 * AI SDK Output.object, otherwise it returns plain text. Kept `unknown` here so this
 * pure module never imports zod or the AI SDK.
 */
export type RouteInput = {
  system: string;
  prompt: string;
  schema?: unknown;
};

export type GenerateResult = {
  output: unknown;
  usage: TokenUsage;
};

/** Injected model call. Production wiring is the gateway adapter (gateway.ts). */
export type GenerateFn = (req: {
  model: string;
  system: string;
  prompt: string;
  schema?: unknown;
}) => Promise<GenerateResult>;

/** Injected structured logger. Production wiring maps onto logLLMCall (llm-call.ts). */
export type RouterLogEntry = {
  purpose: string;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  result: LLMCallResult;
  errorCode?: string | null;
};

export type RouterLogFn = (entry: RouterLogEntry) => Promise<void> | void;

export type RouteDeps = {
  generate: GenerateFn;
  logCall?: RouterLogFn;
  /** Providers allowed to execute. Defaults to DEFAULT_ENABLED_PROVIDERS (Anthropic only). */
  enabledProviders?: readonly Provider[];
  /** When true, reorder usable candidates cheapest-first instead of capability-first. */
  preferCheapest?: boolean;
  /** Retries per candidate (passed to withRetry). Default 2. */
  retries?: number;
  /** Injectable clock for latency + tests. Default Date.now. */
  now?: () => number;
};

export type RouteAttempt = {
  provider: Provider;
  model: string;
  ok: boolean;
  latencyMs: number;
  errorCode?: string;
};

export type RouteResult<T = unknown> = {
  output: T;
  provider: Provider;
  model: string;
  usage: TokenUsage;
  /** Every candidate tried, in order — the last entry is the one that succeeded. */
  attempts: RouteAttempt[];
};
