// Wave 1A / PSG-236 — Live ContentGapProvider: intel content-gap (multi-LLM router).
//
// Wires the engine's Stage-3 `ContentGapProvider` seam to the intel content-gap path
// via the injected `StructuredCompletion` (built from the intel router by the route, so
// it inherits the same budget/G5 gating). Given the shop's competitors, it asks for
// keywords competitors likely rank for that this shop should target; results are stamped
// `source: "competitor_gap"` and merged into the universe by the pipeline.
//
// Degrades to [] when: no competitors in the brief, or `complete` returns null
// (pre-G5 / spend-cap / no provider). It NEVER invents volumes — volume/difficulty are
// only carried through if the model supplies them. Pure + node-testable.

import { z } from "zod";
import { inferIntent } from "../keyword-provider";
import type { ContentGapProvider } from "../pipeline";
import { sitemapKeywordSchema, type ShopBrief, type SitemapKeyword } from "../types";
import type { StructuredCompletion } from "./llm";

const gapResultSchema = z.object({
  keywords: z
    .array(
      z.object({
        keyword: z.string().min(1),
        searchVolume: z.number().int().nonnegative().optional(),
        difficulty: z.number().min(0).max(100).optional(),
      }),
    )
    .max(100),
});

export type ContentGapDeps = {
  complete: StructuredCompletion;
  /** Cap gap keywords merged into the universe. Default 40. */
  maxKeywords?: number;
};

function buildGapPrompt(brief: ShopBrief): string {
  const lines = [
    `Shop: ${brief.businessName}`,
    brief.domain ? `Site: ${brief.domain}` : `Site: none (new build)`,
    `Vertical: ${brief.vertical}`,
    brief.services.length ? `Services: ${brief.services.join(", ")}` : "Services: (none listed)",
    brief.locations.length
      ? `Locations: ${brief.locations.map((l) => `${l.city}, ${l.state}`).join("; ")}`
      : "Locations: (none listed)",
    `Competitors: ${brief.competitors.join(", ")}`,
    "",
    "List keyword phrases the competitors above likely rank for that this shop should",
    "target but probably does not cover yet. Favor locally-winnable, commercial-intent",
    "phrases (service + city, 'near me', insurance/claims, financing). Do not invent",
    "search volumes — omit volume/difficulty unless you are confident.",
  ];
  return lines.join("\n");
}

/** Build a live ContentGapProvider from a structured LLM completion seam. */
export function makeContentGapProvider(deps: ContentGapDeps): ContentGapProvider {
  const max = deps.maxKeywords ?? 40;

  return async (brief) => {
    if (brief.competitors.length === 0) return [];

    const result = await deps.complete({
      system:
        "You are an SEO content-gap analyst for auto-body / collision-repair shops. " +
        "Identify keywords competitors rank for that a small local shop should target. " +
        "Return only phrases a small local business could realistically win.",
      prompt: buildGapPrompt(brief),
      schema: gapResultSchema,
    });
    if (!result) return [];

    const out: SitemapKeyword[] = [];
    const seen = new Set<string>();
    for (const k of result.keywords) {
      const keyword = k.keyword.trim();
      const key = keyword.toLowerCase();
      if (!keyword || seen.has(key)) continue;
      seen.add(key);
      const parsed = sitemapKeywordSchema.safeParse({
        keyword,
        intent: inferIntent(keyword),
        searchVolume: k.searchVolume,
        difficulty: k.difficulty,
        source: "competitor_gap",
      });
      if (parsed.success) out.push(parsed.data);
      if (out.length >= max) break;
    }
    return out;
  };
}
