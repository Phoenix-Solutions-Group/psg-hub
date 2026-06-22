// v1.6 / 17-A — Grounded web-research step for the competitor report (G5-gated, metered).
// A second, optional metered seam alongside makeNarrativeGenerator: it routes the
// "web_grounded" profile to pull a few recent, sourced market signals about the shop's top
// competitors, which the report writer then folds into its grounded narrative. Like the
// narrative generator it runs through the 16-01 router, so the G5 provider gate AND the
// month-to-date spend cap both apply: with only Anthropic enabled it degrades to the
// (ungrounded) Sonnet tail, and over the cap it narrows to the in-budget path or returns null.
// Any thrown error degrades to null (mirrors makeNarrativeGenerator) so a research outage can
// never sink the deterministic report.

import "server-only";
import { z } from "zod";
import { route } from "../router";
import { gatewayGenerate } from "../gateway";
import { resolveEnabledProviders, makeRouterLogger } from "../server";
import type { NarrativeInput } from "./report-data";
import type { Provider } from "../types";

/** Result of one grounded research pass: a handful of sourced signals + which model produced them. */
export type GroundedResearch = {
  signals: string[];
  sources: string[];
  provider: Provider;
  model: string;
};

/** Structured contract the research model must return. */
const researchSchema = z.object({
  signals: z
    .array(z.string())
    .max(5)
    .describe("Up to 5 recent, concrete market signals about the listed competitors."),
  sources: z.array(z.string()).describe("Source URLs backing the signals, most relevant first."),
});

const SYSTEM =
  "You are a competitive-intelligence researcher for an auto-body-shop marketing platform. " +
  "Find recent, verifiable, public market signals about the listed competitor shops and cite a " +
  "source for each. Only report signals you can ground in a real source; if nothing recent and " +
  "credible is found, return empty arrays. Do not invent shops, events, or URLs. " +
  "Do not use em dashes.";

/**
 * Ground the prompt on competitor NAMES only — no distances, ratings, or other internal
 * fields. The names are the public identifiers a web search can act on; keeping the prompt to
 * names keeps the metered query tight and free of any derived/internal data.
 */
function buildResearchPrompt(input: NarrativeInput): string {
  const names = input.topCompetitors.map((c, i) => `${i + 1}. ${c.name}`);
  return [
    "Research recent public market signals about these auto-body / collision-repair shops " +
      "competing in one local market:",
    ...names,
    "",
    "Return up to 5 concise, sourced signals (e.g. new locations, ownership or consolidator " +
      "moves, promotions, rating shifts, closures, OEM certifications), each with a source URL.",
  ].join("\n");
}

/**
 * Build the grounded-research step for a shop's report. The router enforces both the G5
 * provider gate and the month-to-date spend cap (passed through here): when a metered provider
 * is enabled and under cap, a grounded model (Perplexity) runs; otherwise it degrades to the
 * in-budget Anthropic tail, and any router failure (no enabled provider / all candidates failed
 * / cap exceeded with no in-budget fallback) returns null so the report still assembles.
 */
export function makeGroundedResearcher(opts: {
  shopId: string;
  userId?: string | null;
  spendCapUsd?: number;
  monthToDateSpendUsd?: () => Promise<number>;
}): (input: NarrativeInput) => Promise<GroundedResearch | null> {
  return async (input: NarrativeInput): Promise<GroundedResearch | null> => {
    try {
      const result = await route<z.infer<typeof researchSchema>>(
        "web_grounded",
        { system: SYSTEM, prompt: buildResearchPrompt(input), schema: researchSchema },
        {
          generate: gatewayGenerate,
          enabledProviders: resolveEnabledProviders(),
          logCall: makeRouterLogger({ shopId: opts.shopId, userId: opts.userId ?? null }),
          spendCapUsd: opts.spendCapUsd,
          monthToDateSpendUsd: opts.monthToDateSpendUsd,
        },
      );
      const parsed = researchSchema.safeParse(result.output);
      if (!parsed.success) return null;
      return {
        signals: parsed.data.signals,
        sources: parsed.data.sources,
        provider: result.provider,
        model: result.model,
      };
    } catch {
      // NoEnabledProviderError / AllCandidatesFailedError / SpendCapExceededError → degrade.
      return null;
    }
  };
}
