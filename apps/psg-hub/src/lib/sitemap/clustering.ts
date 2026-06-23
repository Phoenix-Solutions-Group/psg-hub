// Wave 1A / PSG-225 — SERP clustering + page-type validation (spec: seo-cluster, seo-sxo).
//
// Groups the keyword universe into SERP-intent clusters (keywords that one page
// should satisfy) and validates each cluster to exactly one page type. The core is
// DETERMINISTIC (no vendor spend, node-testable): keywords are grouped by an
// intent + topic-stem key. An optional injected `refine` seam lets a route route
// the rough clusters through the intel LLM router for relabeling/merging when a
// metered provider is enabled — absent, the deterministic clusters stand.
//
// Pure module. The live refine wiring (if any) is injected by ./pipeline.ts.

import type {
  KeywordIntent,
  PageType,
  SerpCluster,
  SitemapKeyword,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Intent → page type (SXO validation)                                        */
/* -------------------------------------------------------------------------- */

/** Default page archetype for a search intent (the seo-sxo mapping). */
export function pageTypeForIntent(intent: KeywordIntent): PageType {
  switch (intent) {
    case "service":
      return "service";
    case "local":
      return "service_area";
    case "transactional":
      return "landing";
    case "emergency":
      return "landing";
    case "informational":
    default:
      return "resource";
  }
}

/**
 * Validate/normalize a cluster's page type. A cluster whose pageType is unset or
 * inconsistent with its dominant intent is repaired to the SXO default. Returns the
 * (possibly corrected) pageType plus whether a correction was applied.
 */
export function validatePageType(intent: KeywordIntent, proposed?: PageType): {
  pageType: PageType;
  corrected: boolean;
} {
  const expected = pageTypeForIntent(intent);
  if (!proposed) return { pageType: expected, corrected: false };
  // Allow informational clusters to be a blog_index/blog_post/faq/resource family.
  const informationalFamily: PageType[] = ["resource", "blog_index", "blog_post", "faq"];
  if (intent === "informational" && informationalFamily.includes(proposed)) {
    return { pageType: proposed, corrected: false };
  }
  if (proposed === expected) return { pageType: proposed, corrected: false };
  return { pageType: expected, corrected: true };
}

/* -------------------------------------------------------------------------- */
/* Topic stemming + grouping                                                   */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "the", "a", "an", "near", "me", "in", "for", "to", "of", "and", "or", "my",
  "best", "top", "cheap", "affordable", "local", "your", "how", "what", "is",
  "does", "do", "after", "with", "service", "services", "shop", "company",
]);

/** Reduce a keyword to a topic stem: drop stopwords + city tokens, sort the rest. */
export function topicStem(keyword: string, cityTokens: Set<string>): string {
  const tokens = keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t) && !cityTokens.has(t));
  // Keep the two most "topical" tokens (longest), sorted for stability.
  const sorted = [...new Set(tokens)].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return sorted.slice(0, 2).sort().join(" ") || "general";
}

/** Aggregate cluster opportunity 0–100: volume-weighted, difficulty-discounted. */
export function clusterPriority(keywords: SitemapKeyword[]): number {
  if (keywords.length === 0) return 0;
  let score = 0;
  for (const k of keywords) {
    const vol = k.searchVolume ?? 50; // unknown volume → modest default
    const diff = k.difficulty ?? 40;
    // Opportunity rises with volume, falls with difficulty.
    const opp = Math.log10(vol + 10) * (1 - diff / 150);
    score += opp;
  }
  // Normalize to 0–100 with a soft cap.
  return Math.max(0, Math.min(100, Math.round((score / keywords.length) * 25)));
}

/* -------------------------------------------------------------------------- */
/* clusterKeywords                                                            */
/* -------------------------------------------------------------------------- */

/** Optional LLM refinement seam: takes deterministic clusters, returns refined
 *  ones (merged/relabeled). Returns null/throws ⇒ deterministic clusters stand. */
export type ClusterRefiner = (clusters: SerpCluster[]) => Promise<SerpCluster[] | null>;

export type ClusterKeywordsOptions = {
  /** City names in the brief — their tokens are stripped from topic stems so
   *  "collision repair lincoln" and "collision repair omaha" group together. */
  cityTokens?: Set<string>;
  /** Personas to attach by keyword-theme match (collision vertical). */
  personaMatch?: (keyword: string) => string[];
  refine?: ClusterRefiner;
};

/**
 * Group keywords into SERP clusters. Keys are `${intent}::${topicStem}` so a page's
 * worth of keywords land together. Each cluster gets a validated single page type
 * and an opportunity priority. Deterministic; `refine` (when supplied + successful)
 * may post-process. Cluster ids are content-derived (stable, no randomness).
 */
export async function clusterKeywords(
  keywords: SitemapKeyword[],
  opts: ClusterKeywordsOptions = {},
): Promise<SerpCluster[]> {
  const cityTokens = opts.cityTokens ?? new Set<string>();
  const groups = new Map<string, SitemapKeyword[]>();

  for (const k of keywords) {
    const key = `${k.intent}::${topicStem(k.keyword, cityTokens)}`;
    const list = groups.get(key) ?? [];
    list.push(k);
    groups.set(key, list);
  }

  const clusters: SerpCluster[] = [...groups.entries()]
    .map(([key, kws]) => {
      const [intentRaw, stem] = key.split("::");
      const intent = intentRaw as KeywordIntent;
      const { pageType } = validatePageType(intent);
      const personaIds = opts.personaMatch
        ? [...new Set(kws.flatMap((k) => opts.personaMatch!(k.keyword)))]
        : [];
      // Label: title-case the stem + intent hint.
      const label = `${titleCase(stem)} (${intent})`;
      return {
        id: `cl-${slugKey(key)}`,
        label,
        intent,
        pageType,
        keywords: kws,
        personaIds,
        priority: clusterPriority(kws),
      } satisfies SerpCluster;
    })
    // Highest opportunity first (stable secondary by id).
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  if (opts.refine) {
    try {
      const refined = await opts.refine(clusters);
      if (refined && refined.length > 0) return refined;
    } catch {
      // Refiner failure never sinks the run — deterministic clusters stand.
    }
  }
  return clusters;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
