// BSM Phase 0 / PSG-153 — Market Researcher synthesis (PSG-156).
//
// Owner: Ravi (child of PSG-153). This is the "Market Researcher → ContentBrief"
// path. `synthesizeContentBrief` consumes the SEO Auditor's AuditReport (incl.
// its keywordTargets) plus zero-or-more scraper SentimentReport(s) and produces a
// validated ContentBrief (ORIGINAL-README §Agents: "synthesizes scraper and
// auditor data into content opportunity briefs").
//
// Contract requirements (enforced with contentBriefSchema.parse before returning):
//   • brief.sources references the input auditReport.id and EXACTLY the sentiment
//     ids actually used (so QA can prove upstream data was consumed).
//   • brief.targetKeywords are drawn from auditReport.keywordTargets — the SEO
//     Auditor signal survives the handoff (no invented keywords).
//   • brief.priorityScore is derived from keyword priority + sentiment signal
//     (formula documented at `computePriorityScore` below).
//   • Degrades gracefully with zero SentimentReports (ORIGINAL-PLANNING §269).
//   • Deterministic: `now`/`briefId` come from opts; no Date.now() inside.

import type {
  AuditReport,
  ContentBrief,
  KeywordIntent,
  KeywordTarget,
  SentimentReport,
} from "./types";
import { contentBriefSchema } from "./types";

export type SynthesizeBriefOptions = {
  /** Stable id for the produced brief (Phase 0: caller supplies; no DB sequence). */
  briefId: string;
  /** ISO timestamp for createdAt (kept injectable for deterministic tests). */
  now: string;
  /** Max keyword targets to carry into the brief. Default {@link DEFAULT_MAX_KEYWORDS}. */
  maxKeywords?: number;
};

/** How many of the auditor's keyword targets carry into a brief by default. */
const DEFAULT_MAX_KEYWORDS = 8;

/**
 * Weighting between the SEO opportunity signal (keyword priority) and the market
 * signal (scraper sentiment) when computing a brief's priorityScore. They sum to
 * 1; with zero usable sentiment the sentiment term is dropped and the keyword
 * signal stands alone (graceful degradation — sentiment never drags the score down
 * just because the scraper had no data, ORIGINAL-PLANNING §269).
 */
const KEYWORD_WEIGHT = 0.7;
const SENTIMENT_WEIGHT = 0.3;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Audience persona seed by keyword intent — keeps the brief in the shop's voice. */
const PERSONA_BY_INTENT: Record<KeywordIntent, string> = {
  local: "Local driver searching for a nearby, trustworthy collision shop",
  service: "Vehicle owner researching a specific repair before committing",
  informational: "Anxious driver trying to understand the collision-repair process",
  transactional: "Ready-to-book driver comparing estimates near them",
  emergency: "Driver who just had an accident and needs help right now",
};

/**
 * Sort keyword targets by opportunity priority (desc), tie-broken by keyword (asc)
 * for determinism. Never mutates the input array.
 */
function rankKeywords(targets: readonly KeywordTarget[]): KeywordTarget[] {
  return [...targets].sort(
    (a, b) => b.priority - a.priority || a.keyword.localeCompare(b.keyword),
  );
}

/**
 * priorityScore formula (0–100), documented per the acceptance criteria:
 *
 *   keywordSignal   = mean(priority of selected keyword targets)            // 0–100
 *   sentimentSignal = ((avg sentimentScore + 1) / 2) * 100  +  trendingBump // 0–100
 *                       where trendingBump = min(10, # distinct trending topics)
 *
 *   • With usable sentiment: round(KEYWORD_WEIGHT*keywordSignal + SENTIMENT_WEIGHT*sentimentSignal)
 *   • With NO usable sentiment: round(keywordSignal)  — sentiment term dropped (graceful degrade)
 *   • With no keywords at all: falls back to the sentiment signal (or 0 if neither exists)
 *
 * sentimentScore is normalized -1…1; positive/active conversation nudges the
 * score up, a quiet or negative market nudges it down, but the SEO opportunity
 * always dominates (0.7 weight).
 */
function computePriorityScore(
  selectedKeywords: readonly KeywordTarget[],
  usedSentiment: readonly SentimentReport[],
): number {
  const keywordSignal = mean(selectedKeywords.map((k) => k.priority));
  const hasKeywords = selectedKeywords.length > 0;
  const hasSentiment = usedSentiment.length > 0;

  if (!hasSentiment) {
    return Math.round(clamp(keywordSignal, 0, 100));
  }

  const avgSentiment = mean(usedSentiment.map((r) => r.sentimentScore)); // -1…1
  const distinctTrending = new Set(usedSentiment.flatMap((r) => r.trendingTopics));
  const trendingBump = Math.min(10, distinctTrending.size);
  const sentimentSignal = clamp(((avgSentiment + 1) / 2) * 100 + trendingBump, 0, 100);

  // No keywords → the sentiment signal carries the score on its own.
  const blended = hasKeywords
    ? KEYWORD_WEIGHT * keywordSignal + SENTIMENT_WEIGHT * sentimentSignal
    : sentimentSignal;

  return Math.round(clamp(blended, 0, 100));
}

/** Derive the competitor content gap this brief exploits from the audit + market. */
function deriveCompetitorGap(
  auditReport: AuditReport,
  usedSentiment: readonly SentimentReport[],
  topKeyword: KeywordTarget | undefined,
): string {
  const firstRec = auditReport.recommendations.find((r) => r.trim().length > 0);
  if (firstRec) return firstRec;

  const ranked = [...auditReport.findings].sort(
    (a, b) =>
      ["critical", "high", "medium", "low"].indexOf(a.severity) -
      ["critical", "high", "medium", "low"].indexOf(b.severity),
  );
  if (ranked.length > 0) return `${ranked[0].area}: ${ranked[0].detail}`;

  const trending = usedSentiment.flatMap((r) => r.trendingTopics)[0];
  if (trending) return `No local shop covers the trending topic "${trending}"`;

  if (topKeyword) return `No differentiated local content yet for "${topKeyword.keyword}"`;
  return "Untapped local content opportunity";
}

/** Topic line for the brief, seeded from the strongest signal available. */
function deriveTopic(
  topKeyword: KeywordTarget | undefined,
  usedSentiment: readonly SentimentReport[],
  auditReport: AuditReport,
): string {
  if (topKeyword) return `Content targeting "${topKeyword.keyword}"`;
  const topic = usedSentiment.find((r) => r.topic.trim().length > 0)?.topic;
  if (topic) return `Content addressing customer conversation: ${topic}`;
  return `Content opportunity (${auditReport.type.replace(/_/g, " ")})`;
}

/**
 * Synthesize a ContentBrief from one AuditReport and zero+ SentimentReports.
 *
 * Provenance: only sentiment reports for the SAME shop as the audit are consumed
 * (a mismatched-shop report is not "the shop's market"), and `sources
 * .sentimentReportIds` lists exactly those used — so QA can prove the upstream
 * data that fed the brief.
 */
export function synthesizeContentBrief(
  auditReport: AuditReport,
  sentimentReports: SentimentReport[],
  opts: SynthesizeBriefOptions,
): ContentBrief {
  const maxKeywords = opts.maxKeywords ?? DEFAULT_MAX_KEYWORDS;

  // Keywords come ONLY from the auditor — sorted, capped, never invented.
  const selectedKeywords = rankKeywords(auditReport.keywordTargets).slice(
    0,
    Math.max(0, maxKeywords),
  );
  const topKeyword = selectedKeywords[0];

  // Use only sentiment for this shop; record exactly what we used for provenance.
  const usedSentiment = sentimentReports.filter((r) => r.shopId === auditReport.shopId);

  const priorityScore = computePriorityScore(selectedKeywords, usedSentiment);
  const audiencePersona = topKeyword
    ? PERSONA_BY_INTENT[topKeyword.intent]
    : "Local driver evaluating collision-repair options";

  const brief: ContentBrief = {
    id: opts.briefId,
    shopId: auditReport.shopId,
    topic: deriveTopic(topKeyword, usedSentiment, auditReport),
    targetKeywords: selectedKeywords,
    competitorGap: deriveCompetitorGap(auditReport, usedSentiment, topKeyword),
    audiencePersona,
    priorityScore,
    status: "draft",
    sources: {
      auditReportId: auditReport.id,
      sentimentReportIds: usedSentiment.map((r) => r.id),
    },
    createdAt: opts.now,
  };

  // Validate the contract before handing the brief to the Content Writer.
  return contentBriefSchema.parse(brief);
}
