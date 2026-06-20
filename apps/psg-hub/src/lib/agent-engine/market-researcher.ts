// BSM Phase 0 / PSG-153 — Market Researcher synthesis (SEAM — to be implemented).
//
// Owner: child issue (Ravi). This is the "Market Researcher → ContentBrief" path.
// Implement `synthesizeContentBrief` so it consumes the SEO Auditor's AuditReport
// (incl. its keywordTargets) plus the scraper's SentimentReport(s) and produces a
// validated ContentBrief (ORIGINAL-README: "synthesizes scraper and auditor data
// into content opportunity briefs").
//
// Contract requirements (enforce with contentBriefSchema.parse before returning):
//   • brief.sources MUST reference the input auditReport.id and the sentiment ids
//     it actually used (so QA can prove upstream data was consumed).
//   • brief.targetKeywords MUST be drawn from auditReport.keywordTargets
//     (the SEO Auditor signal survives the handoff — do not invent keywords).
//   • brief.priorityScore SHOULD be derived from keyword priority + sentiment.
//   • Degrade gracefully with zero SentimentReports (ORIGINAL-PLANNING §269).
// Add unit tests under __tests__ covering: happy path, no-sentiment fallback,
// and that provenance + keyword survival hold.

import type { AuditReport, ContentBrief, SentimentReport } from "./types";

export type SynthesizeBriefOptions = {
  /** Stable id for the produced brief (Phase 0: caller supplies; no DB sequence). */
  briefId: string;
  /** ISO timestamp for createdAt (kept injectable for deterministic tests). */
  now: string;
  /** Max keyword targets to carry into the brief. Default left to impl. */
  maxKeywords?: number;
};

/**
 * Synthesize a ContentBrief from one AuditReport and zero+ SentimentReports.
 * @throws until implemented by the PSG-153 Market Researcher child issue.
 */
export function synthesizeContentBrief(
  _auditReport: AuditReport,
  _sentimentReports: SentimentReport[],
  _opts: SynthesizeBriefOptions,
): ContentBrief {
  throw new Error(
    "synthesizeContentBrief not implemented — see PSG-153 Market Researcher child issue",
  );
}
