// v1.6 / 16-03 — Grounded-narrative activation seam (G5-gated, DORMANT until approval).
// This is the one place the competitor report touches metered spend. It builds the
// NarrativeGenerator that assembleCompetitorReport() injects: a router call on the "writer"
// profile that grounds an executive summary + recommended moves in the deterministic threat
// numbers. It is NOT invoked build-local — the report assembles with a pending-activation
// notice until the board clears G5 and INTEL_ENABLED_PROVIDERS is set. Kept out of the pure
// assembler so report-data.ts stays node-testable and free of the `ai`/server-only imports.

import "server-only";
import { z } from "zod";
import { route } from "../router";
import { gatewayGenerate } from "../gateway";
import { resolveEnabledProviders, makeRouterLogger } from "../server";
import type { NarrativeGenerator, NarrativeInput } from "./report-data";
import type { GroundedNarrative } from "./types";

/** Structured contract the writer model must return. */
const narrativeSchema = z.object({
  summary: z
    .string()
    .describe("2–4 sentence executive read of the shop's competitive picture."),
  keyMoves: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Recommended marketing/operational moves, most important first."),
});

const SYSTEM =
  "You are a competitive-intelligence analyst for an auto-body-shop marketing platform. " +
  "Ground every statement in the supplied threat numbers — never invent competitors, " +
  "ratings, or distances. Consolidator-owned locations (national MSOs) are structurally " +
  "bigger threats than independents at the same distance/rating. Be concise and specific. " +
  "Do not use em dashes.";

/** Render the deterministic report numbers into a tight, groundable prompt. */
function buildPrompt(input: NarrativeInput): string {
  const { summary, topCompetitors } = input;
  const lines = topCompetitors.map(
    (c) =>
      `#${c.rank} ${c.name} (${c.type}${c.consolidatorGroup ? `: ${c.consolidatorGroup}` : ""}) ` +
      `threat=${c.threatScore}/100 tier=${c.tier} ` +
      `dist=${c.distanceMiles ?? "?"}mi rating=${c.rating ?? "?"} reviews=${c.reviewCount ?? "?"} ` +
      `— ${c.rationale}`,
  );
  return [
    `Competitive set: ${summary.totalCompetitors} rival shops ` +
      `(${summary.consolidatorCount} consolidator-owned, ${summary.independentCount} independent; ` +
      `consolidator share ${(summary.consolidatorShare * 100).toFixed(0)}%).`,
    `Top threat score ${summary.topThreatScore}/100; mean of top set ${summary.averageTopThreat}/100; ` +
      `median distance ${summary.medianDistanceMiles ?? "?"} mi.`,
    `Tier counts: critical ${summary.tierCounts.critical}, elevated ${summary.tierCounts.elevated}, ` +
      `moderate ${summary.tierCounts.moderate}, low ${summary.tierCounts.low}.`,
    "",
    "Top competitors:",
    ...lines,
    "",
    "Write the executive summary and recommended moves grounded strictly in the above.",
  ].join("\n");
}

/**
 * Build the grounded-narrative generator for a shop's report. The router enforces the G5 gate:
 * with only the in-budget provider enabled it still produces a (same-family) narrative, and
 * once G5 widens INTEL_ENABLED_PROVIDERS the grounded tier is used. Any router failure (all
 * candidates exhausted / no enabled provider) returns null so the report degrades to the
 * pending-activation notice instead of throwing.
 */
export function makeNarrativeGenerator(opts: {
  shopId: string;
  userId?: string | null;
}): NarrativeGenerator {
  return async (input: NarrativeInput): Promise<GroundedNarrative | null> => {
    try {
      const result = await route<z.infer<typeof narrativeSchema>>(
        "writer",
        { system: SYSTEM, prompt: buildPrompt(input), schema: narrativeSchema },
        {
          generate: gatewayGenerate,
          enabledProviders: resolveEnabledProviders(),
          logCall: makeRouterLogger({ shopId: opts.shopId, userId: opts.userId ?? null }),
        },
      );
      const parsed = narrativeSchema.safeParse(result.output);
      if (!parsed.success) return null;
      return {
        summary: parsed.data.summary,
        keyMoves: parsed.data.keyMoves,
        provider: result.provider,
        model: result.model,
      };
    } catch {
      // NoEnabledProviderError / AllCandidatesFailedError → degrade to pending notice.
      return null;
    }
  };
}
