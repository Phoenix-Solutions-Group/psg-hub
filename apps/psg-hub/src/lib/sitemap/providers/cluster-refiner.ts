// Wave 1A / PSG-236 — Optional ClusterRefiner: intel multi-LLM router.
//
// Wires the engine's Stage-4 optional `ClusterRefiner` seam. The deterministic
// clusterer already groups keywords by SERP intent + topic stem and validates each
// cluster to one page type; this OPTIONAL refiner lets the LLM improve the human-facing
// label and (where appropriate) the page-type choice — WITHOUT ever touching the
// keyword membership or priority. That preserves the load-bearing invariant: keywords
// only ever move between clusters via the deterministic clusterer, never the LLM, so
// the universe can't drift or hallucinate. The refiner only annotates.
//
// Returns the refined clusters, or null to fall back to the deterministic clusters
// (engine treats null/empty as "keep deterministic"). Degrades to null when `complete`
// is unavailable. Pure + node-testable.

import { z } from "zod";
import type { ClusterRefiner } from "../clustering";
import { PAGE_TYPES, type SerpCluster } from "../types";
import type { StructuredCompletion } from "./llm";

const refineSchema = z.object({
  clusters: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1).optional(),
      pageType: z.enum(PAGE_TYPES).optional(),
    }),
  ),
});

export type ClusterRefinerDeps = {
  complete: StructuredCompletion;
};

function buildRefinePrompt(clusters: SerpCluster[]): string {
  const lines = [
    "Below are SERP-intent keyword clusters. For each, suggest a clearer client-facing",
    "label and confirm or correct its page type. Do NOT add, remove, or move keywords —",
    "only refine the label and pageType. Return one entry per cluster id you change.",
    `Valid page types: ${PAGE_TYPES.join(", ")}.`,
    "",
  ];
  for (const c of clusters) {
    const kw = c.keywords.slice(0, 8).map((k) => k.keyword).join(", ");
    lines.push(`- id=${c.id} | label="${c.label}" | pageType=${c.pageType} | intent=${c.intent} | keywords: ${kw}`);
  }
  return lines.join("\n");
}

/** Build an optional ClusterRefiner from a structured LLM completion seam. */
export function makeClusterRefiner(deps: ClusterRefinerDeps): ClusterRefiner {
  return async (clusters) => {
    if (clusters.length === 0) return null;

    const result = await deps.complete({
      system:
        "You are an information architect refining SEO page clusters for a local " +
        "service business. You only relabel and confirm page types — never change which " +
        "keywords belong to a cluster.",
      prompt: buildRefinePrompt(clusters),
      schema: refineSchema,
    });
    if (!result) return null;

    const overrides = new Map(result.clusters.map((c) => [c.id, c]));
    const refined = clusters.map((c) => {
      const o = overrides.get(c.id);
      if (!o) return c;
      return {
        ...c,
        label: o.label?.trim() || c.label,
        pageType: o.pageType ?? c.pageType,
      };
    });
    return refined;
  };
}
