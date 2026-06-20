// BSM Phase 0 / PSG-161 — SEO Auditor → Content Writer keyword-target DTO.
//
// This is the loader/merge-input shape for the cross-module SEO Auditor → content
// path (PSG-153 / QA defect PSG-145 item 6). `fetchKeywordTargets` (see
// src/lib/bsm/keyword-targets.ts) reads the shop's SEO-auditor artifacts from
// `research_artifacts` and normalizes them into KeywordTarget[]. The Content
// Writer input builder consumes these alongside Nora's ContentBrief; Ada owns
// that merge/integration on PSG-153 — this module only exposes the SEO half.
//
// NOTE (reconciliation, owned by Ada on PSG-153): a SECOND, differently-shaped
// `KeywordTarget` exists in the pure agent-engine contract
// (src/lib/agent-engine/types.ts — camelCase, numeric 0–100 `priority`, `intent`,
// no `source`/`gap_opportunity`). The two are intentionally distinct modules so
// there is no TS collision; reconciling them into the canonical content-writer
// input is the merge step Ada owns. Do not merge here.

/** Bucketed opportunity priority for a keyword target. */
export type KeywordPriority = "HIGH" | "MEDIUM" | "LOW";

/** Which BSM agent surfaced this keyword target. */
export type KeywordSource = "seo-auditor" | "market-researcher";

/**
 * A single keyword the SEO Auditor recommends the Content Writer pursue,
 * normalized from a `research_artifacts` SEMrush/auditor artifact.
 */
export interface KeywordTarget {
  /** The keyword/phrase, e.g. "collision repair lincoln ne". */
  keyword: string;
  /** Monthly search volume; 0 when the artifact carried no volume. */
  search_volume: number;
  /** How many tracked competitors rank for this keyword; 0 when unknown. */
  competitor_presence: number;
  /** True when this is a content gap the shop does not yet cover. */
  gap_opportunity: boolean;
  /** Bucketed pursue-first priority. */
  priority: KeywordPriority;
  /** Producing agent. This loader only ever emits "seo-auditor". */
  source: KeywordSource;
}
