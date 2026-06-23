// Wave 1A / PSG-236 — Live KeywordProvider: Semrush MCP + no-seat fallback chain.
//
// Wires the engine's Stage-1 `KeywordProvider` seam to live sources. The route binds
// `fetch` on each source to the real integration:
//
//   semrush     → Semrush MCP keyword_research / organic_research (when a seat exists)
//   dataforseo  → the seo-dataforseo tool      ┐ no-seat fallback chain, tried in order
//   gsc         → seo-google (own-site GSC)     │ until one returns ≥1 usable row
//   backlinks   → seo-backlinks                 ┘
//
// The chain is "first non-empty source wins" — exactly the spec's no-seat fallback.
// On top of whatever the live source returns we ALWAYS union the deterministic
// baseline (services × {bare, near-me, <city>} + collision required pages), so the
// keyword universe is never thinner than the zero-cost provider — live data enriches,
// it never strands structural coverage. Pure + node-testable: every live call is the
// injected `fetch`; this module maps/dedupes/clamps only.

import {
  deterministicKeywordProvider,
  inferIntent,
  type KeywordProvider,
} from "../keyword-provider";
import { sitemapKeywordSchema, type ShopBrief, type SitemapKeyword } from "../types";

/** A raw keyword row from a live source. Volume/difficulty optional — the engine
 *  degrades gracefully without them (intent is always derivable from the phrase). */
export type RawKeyword = {
  keyword: string;
  searchVolume?: number | null;
  difficulty?: number | null;
};

/** A named live keyword source. Position in the chain = priority. */
export type KeywordSource = {
  /** Tag stamped on produced keywords: semrush | dataforseo | gsc | backlinks. */
  name: string;
  fetch: (brief: ShopBrief) => Promise<RawKeyword[]>;
};

export type KeywordProviderOptions = {
  /** Union the deterministic baseline for guaranteed structural coverage. Default true. */
  includeDeterministicBaseline?: boolean;
  /** Cap the universe (defends against pathological source payloads). Default 400. */
  maxKeywords?: number;
  /** Called when a source throws; the error is swallowed so the chain continues. */
  onSourceError?: (sourceName: string, err: unknown) => void;
};

/** Map+validate one raw row into a SitemapKeyword, or null if unusable. */
function toSitemapKeyword(raw: RawKeyword, source: string): SitemapKeyword | null {
  const keyword = raw.keyword?.trim();
  if (!keyword) return null;
  const candidate = {
    keyword,
    intent: inferIntent(keyword),
    searchVolume:
      typeof raw.searchVolume === "number" && Number.isFinite(raw.searchVolume) && raw.searchVolume >= 0
        ? Math.round(raw.searchVolume)
        : undefined,
    difficulty:
      typeof raw.difficulty === "number" && Number.isFinite(raw.difficulty)
        ? Math.max(0, Math.min(100, raw.difficulty))
        : undefined,
    source,
  };
  const parsed = sitemapKeywordSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Build a live KeywordProvider from an ordered source chain. Tries each source in
 * order; the FIRST source to yield ≥1 usable keyword wins (the no-seat fallback).
 * The deterministic baseline is then unioned (live wins on phrase collisions, so its
 * volume/difficulty/source survive). Returns at most `maxKeywords`.
 */
export function makeKeywordProvider(
  sources: KeywordSource[],
  opts: KeywordProviderOptions = {},
): KeywordProvider {
  const includeBaseline = opts.includeDeterministicBaseline ?? true;
  const maxKeywords = opts.maxKeywords ?? 400;

  return async (brief) => {
    let live: SitemapKeyword[] = [];
    for (const source of sources) {
      try {
        const rows = await source.fetch(brief);
        const mapped = rows
          .map((r) => toSitemapKeyword(r, source.name))
          .filter((k): k is SitemapKeyword => k !== null);
        if (mapped.length > 0) {
          live = mapped;
          break;
        }
      } catch (err) {
        opts.onSourceError?.(source.name, err);
      }
    }

    // Baseline is always included for coverage; forced on when no live source fired.
    const baseline =
      includeBaseline || live.length === 0 ? await deterministicKeywordProvider(brief) : [];

    const seen = new Set<string>();
    const out: SitemapKeyword[] = [];
    for (const k of [...live, ...baseline]) {
      const key = k.keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(k);
      if (out.length >= maxKeywords) break;
    }
    return out;
  };
}
