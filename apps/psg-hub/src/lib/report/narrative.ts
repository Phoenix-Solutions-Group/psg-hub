// Phase 12 / 12-02 — Multi-LLM writer.
// Default binding routes through the Vercel AI Gateway with a bare provider/model
// string (AI SDK v6 generateText + Output.object — generateObject is deprecated in
// v6). No tools are used, so no stopWhen step config is needed (stopWhen is only
// required to budget the extra structured-output step when tools are in the call).
// The model call is injected via deps.generate so unit tests mock it; the logger is
// injected via deps.logCall so this module never imports the server-only llm-call
// module and stays node-testable. Live Gateway smoke is the 12-04 activation.

import { generateText, Output } from "ai";
import { withRetry, CircuitBreaker } from "../resilience";
import { reportNarrativeSchema, type ReportNarrative } from "./schema";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";
import type { ReportData } from "./types";

/** Gateway slugs use dot notation; raw Anthropic IDs use hyphens (claude-opus-4-8). */
export const WRITER_MODEL = "anthropic/claude-sonnet-4.6";
export const PREMIUM_MODEL = "anthropic/claude-opus-4.8"; // headline + recommendations (v1: single pass)
const FALLBACK_MODEL = "anthropic/claude-sonnet-4.6"; // same-family fallback keeps voice + no-em-dash stable

export type GenerateResult = {
  output: ReportNarrative;
  usage: { inputTokens: number | null; outputTokens: number | null };
};

export type GenerateFn = (req: {
  model: string;
  system: string;
  prompt: string;
}) => Promise<GenerateResult>;

export type LogCallFn = (entry: {
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  result: "success" | "error";
}) => Promise<void>;

export type WriteDeps = {
  generate: GenerateFn;
  model?: string;
  logCall?: LogCallFn;
};

const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 30_000 });

/**
 * Production GenerateFn: AI SDK v6 generateText + Output.object via the AI Gateway,
 * with a same-family Claude fallback. The cron/route layer wires this as deps.generate.
 */
export const gatewayGenerate: GenerateFn = async ({ model, system, prompt }) => {
  const { output, usage } = await generateText({
    model,
    system,
    prompt,
    output: Output.object({ schema: reportNarrativeSchema }),
    providerOptions: { gateway: { models: [FALLBACK_MODEL] } },
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
 * Generate the raw narrative object (placeholders intact — substitution happens in
 * the orchestrator). `violations` re-feeds a rejected draft for a regenerate pass.
 * Wrapped in the shared CircuitBreaker + withRetry; logged via the injected logCall.
 */
export async function writeNarrative(
  reportData: ReportData,
  deps: WriteDeps,
  violations?: string[]
): Promise<ReportNarrative> {
  const model = deps.model ?? WRITER_MODEL;
  const system = buildSystemPrompt();
  const prompt = buildUserPrompt(reportData, violations);

  try {
    const result = await breaker.execute(() =>
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
