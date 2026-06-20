// BSM Phase 0 / PSG-153 — SEO Auditor → content keyword handoff.
//
// Owner: the SEO half (PSG-161, Ravi). This is the "SEO Auditor → content path": the
// auditor "produces keyword targets that feed the Content Writer"
// (ORIGINAL-README §Agents; ORIGINAL-PLANNING §290–293).
//
// Implement `selectKeywordTargets` to rank/filter an AuditReport's raw
// keywordTargets into the set the Content Writer should pursue (highest
// opportunity first). This is also the function the Content Writer calls when it
// "asks the SEO auditor for keyword targets mid-draft" (ORIGINAL-PLANNING §293).
//
// Contract requirements:
//   • Return targets sorted by priority desc; never mutate the input.
//   • Respect `limit` and optional `intents` filter.
//   • Degrade gracefully when targets lack volume/difficulty (optional fields).
// Pairs with content-writer-handoff.ts (the consumption side). Add __tests__.

import type { AuditReport, KeywordIntent, KeywordTarget } from "./types";

export type SelectKeywordTargetsOptions = {
  /** Max targets to return. */
  limit?: number;
  /** When set, only include targets whose intent is in this list. */
  intents?: KeywordIntent[];
};

/**
 * Select & rank the keyword targets the Content Writer should pursue.
 *
 * Returns a NEW array of `auditReport.keywordTargets` sorted by `priority`
 * descending (highest opportunity first); the input report and its target
 * objects are never mutated. When `opts.intents` is supplied, only targets whose
 * `intent` is in that list are kept; when `opts.limit` is supplied, at most that
 * many of the top-ranked targets are returned (a non-positive limit yields `[]`).
 *
 * This is also the function the Content Writer calls when it "asks the SEO
 * auditor for keyword targets mid-draft" (ORIGINAL-PLANNING §293).
 */
export function selectKeywordTargets(
  auditReport: AuditReport,
  opts: SelectKeywordTargetsOptions = {},
): KeywordTarget[] {
  const { limit, intents } = opts;

  // Copy before sorting so we never mutate the caller's array (or report).
  let targets = [...auditReport.keywordTargets];

  if (intents && intents.length > 0) {
    const allowed = new Set<KeywordIntent>(intents);
    targets = targets.filter((t) => allowed.has(t.intent));
  }

  // Highest priority first. Array#sort is stable in modern engines, so equal
  // priorities preserve their original auditor order.
  targets.sort((a, b) => b.priority - a.priority);

  if (limit != null) {
    targets = limit > 0 ? targets.slice(0, limit) : [];
  }

  return targets;
}
