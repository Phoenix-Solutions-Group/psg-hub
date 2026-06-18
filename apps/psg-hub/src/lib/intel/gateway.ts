// v1.6 / 16-01 — Production GenerateFn for the router (AI Gateway adapter).
// Generalizes report/narrative.ts:gatewayGenerate to the router's profile-driven calls:
// AI SDK v6 generateText, with Output.object when the caller passed a structured-output
// schema and plain text otherwise. This is the LIVE seam — it only ever runs for
// providers the router has enabled, so build-local (Anthropic-only) never touches a
// G5-gated vendor. Kept out of router.ts so the router stays free of the `ai` import.

import { generateText, Output } from "ai";
import type { GenerateFn, GenerateResult } from "./types";

type SchemaLike = Parameters<typeof Output.object>[0]["schema"];

/**
 * Live model call through the Vercel AI Gateway. The `model` is a gateway slug
 * (provider/model) so the same call shape works across Anthropic/OpenAI/Gemini/etc.
 * No fallback model is wired here — cross-provider fallback is the ROUTER's job, so each
 * gateway call targets exactly one model and the router decides what to try next.
 */
export const gatewayGenerate: GenerateFn = async ({ model, system, prompt, schema }) => {
  if (schema) {
    const { output, usage } = await generateText({
      model,
      system,
      prompt,
      output: Output.object({ schema: schema as SchemaLike }),
    });
    return normalize(output, usage);
  }
  const { text, usage } = await generateText({ model, system, prompt });
  return normalize(text, usage);
};

function normalize(
  output: unknown,
  usage: { inputTokens?: number | null; outputTokens?: number | null },
): GenerateResult {
  return {
    output,
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
    },
  };
}
