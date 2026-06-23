// Wave 1A / PSG-225 — Keyword-universe provider seam + deterministic fallback.
//
// Stage 1 of the spec chain. The LIVE provider routes through the Semrush MCP
// (keyword_research / organic_research) with the seo-dataforseo / seo-google
// (own-site GSC) / seo-backlinks tools as the no-seat fallback — that wiring lives
// in the route/worker, NOT here, so this module stays pure + node-testable.
//
// This file defines the `KeywordProvider` contract and ships `deterministicKeywordProvider`:
// a zero-cost provider that synthesizes a plausible keyword universe from the brief
// (services × locations) plus, for the collision vertical, the required-page seed
// keywords. It exists so an end-to-end run produces all four artifacts even with no
// Semrush seat (graceful degradation, mirroring the intel engine's pending-narrative
// posture). Volumes/difficulties are intentionally absent from the fallback (the
// engine degrades on missing volume) — only the live provider supplies them.

import { COLLISION_REQUIRED_PAGES, COLLISION_PERSONAS, isCollisionVertical } from "./collision-vertical";
import type { KeywordIntent, ShopBrief, SitemapKeyword } from "./types";

/** Stage-1 seam. Given a brief, return the keyword universe. Async (live = MCP). */
export type KeywordProvider = (brief: ShopBrief) => Promise<SitemapKeyword[]>;

/* -------------------------------------------------------------------------- */
/* Intent inference (used by both fallback + as a helper for live providers)  */
/* -------------------------------------------------------------------------- */

/** Infer search intent from a keyword's shape. Deterministic; live providers may
 *  override with Semrush intent data when present. */
export function inferIntent(keyword: string): KeywordIntent {
  const k = keyword.toLowerCase();
  if (/\b(tow|towing|emergency|accident)\b/.test(k)) return "emergency";
  if (/\b(estimate|quote|free|cost|price|cheap|financing|near me)\b/.test(k)) return "transactional";
  if (/\b(how|what|why|guide|process|expect|tips|long does)\b/.test(k)) return "informational";
  if (/\b(repair|painting|replacement|straightening|service|pdr|glass)\b/.test(k)) return "service";
  return "local";
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback provider                                            */
/* -------------------------------------------------------------------------- */

function uniqByKeyword(keywords: SitemapKeyword[]): SitemapKeyword[] {
  const seen = new Set<string>();
  const out: SitemapKeyword[] = [];
  for (const k of keywords) {
    const key = k.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

/**
 * Build a keyword universe from the brief alone, zero vendor spend. Combines:
 *  - each service × {bare, "near me", "<city>"} permutations,
 *  - collision required-page seed keywords + persona search themes (vertical),
 *  - greenfield-safe (works with no domain).
 * Source is tagged "derived" so the summary can flag that live keyword data was not used.
 */
export const deterministicKeywordProvider: KeywordProvider = async (brief) => {
  const out: SitemapKeyword[] = [];
  const cities = brief.locations.map((l) => l.city);
  const push = (keyword: string) =>
    out.push({ keyword, intent: inferIntent(keyword), source: "derived" });

  for (const service of brief.services) {
    push(service);
    push(`${service} near me`);
    for (const city of cities) push(`${service} ${city}`);
  }

  if (isCollisionVertical(brief.vertical)) {
    for (const req of COLLISION_REQUIRED_PAGES) {
      for (const seed of req.seedKeywords) {
        push(seed);
        for (const city of cities) push(`${seed} ${city}`);
      }
    }
    for (const persona of COLLISION_PERSONAS) {
      for (const theme of persona.searchThemes) {
        // Expand the {city} placeholder used in persona themes.
        if (theme.includes("{city}")) {
          for (const city of cities) push(theme.replace("{city}", city));
        } else {
          push(theme);
        }
      }
    }
  }

  return uniqByKeyword(out);
};
