// BSM Phase 0 / PSG-153 — SEO Auditor → content keyword handoff (SEAM — to impl).
//
// Owner: child issue (Nora). This is the "SEO Auditor → content path": the
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
 * @throws until implemented by the PSG-153 SEO Auditor child issue.
 */
export function selectKeywordTargets(
  _auditReport: AuditReport,
  _opts?: SelectKeywordTargetsOptions,
): KeywordTarget[] {
  throw new Error(
    "selectKeywordTargets not implemented — see PSG-153 SEO Auditor child issue",
  );
}
