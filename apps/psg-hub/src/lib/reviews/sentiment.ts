// Phase 14 / 14-03 — Review sentiment classifier.
// MIRRORS the Phase-12 structured-output seam (report/narrative.ts: AI SDK v6
// generateText + Output.object, wrapped in the shared CircuitBreaker + withRetry, model
// call + logger injected via deps so the module is node-testable and never imports the
// server-only logging chain). Runs on Haiku. This is INBOUND classification — distinct
// from the OUTBOUND reply draft (responder.ts) + its safety gate (safety.ts).
//
// ponytail: NO prompt-cache control on this gateway/Output.object idiom — caching the
// taxonomy system prompt is a fleet-scale (842-shop) cost optimization, not needed
// build-local with zero rows. Upgrade path: AI SDK provider cacheControl (verify the exact
// providerOptions via Context7) OR switch to the responder.ts raw-SDK idiom which caches.

import { generateText, Output } from "ai";
import { withRetry, CircuitBreaker } from "../resilience";
import {
  sentimentSchema,
  type ReviewSentiment,
  buildSentimentSystemPrompt,
  buildSentimentUserMessage,
} from "./sentiment-prompt";

/** Gateway dot-slug (14-RESEARCH model-id decision: claude-haiku-4-5, gateway form). */
export const SENTIMENT_MODEL = "anthropic/claude-haiku-4.5";

export type ClassifyResult = {
  output: ReviewSentiment;
  usage: { inputTokens: number | null; outputTokens: number | null };
};

export type ClassifyFn = (req: {
  model: string;
  system: string;
  prompt: string;
}) => Promise<ClassifyResult>;

export type LogCallFn = (entry: {
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  result: "success" | "error";
}) => Promise<void> | void;

export type ClassifyDeps = {
  generate: ClassifyFn;
  model?: string;
  logCall?: LogCallFn;
};

// Exported so tests can reset() it between cases (the breaker is a module singleton; a
// failing case otherwise leaks accumulated failures into the next).
export const sentimentBreaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

/** Production ClassifyFn: AI SDK v6 generateText + Output.object via the AI Gateway. */
export const gatewayClassify: ClassifyFn = async ({ model, system, prompt }) => {
  const { output, usage } = await generateText({
    model,
    system,
    prompt,
    output: Output.object({ schema: sentimentSchema }),
  });
  return {
    output,
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
    },
  };
};

/**
 * Classify one review's sentiment. Wrapped in the shared CircuitBreaker + withRetry; logs
 * via the injected logCall on success and (result='error') before rethrowing on failure —
 * the orchestrator contains the throw. The zod schema (Output.object) is the eval gate: an
 * off-taxonomy value fails validation rather than being stored.
 */
export async function classifyReviewSentiment(
  input: { text: string; rating: number | null },
  deps: ClassifyDeps
): Promise<ReviewSentiment> {
  const model = deps.model ?? SENTIMENT_MODEL;
  const system = buildSentimentSystemPrompt();
  const prompt = buildSentimentUserMessage(input);

  try {
    const result = await sentimentBreaker.execute(() =>
      withRetry(() => deps.generate({ model, system, prompt }), { retries: 2 })
    );
    await deps.logCall?.({
      modelId: model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      result: "success",
    });
    return result.output;
  } catch (err) {
    await deps.logCall?.({ modelId: model, inputTokens: null, outputTokens: null, result: "error" });
    throw err;
  }
}
