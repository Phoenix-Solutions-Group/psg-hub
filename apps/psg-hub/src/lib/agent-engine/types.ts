// BSM Phase 0 / PSG-153 — Agent-engine cross-module data contracts.
//
// The four BSM agents are collaborative PEERS, not a pipeline: "the content
// writer can ask the SEO auditor for keyword targets mid-draft; the market
// researcher can ask the scraper for recent sentiment on demand"
// (ORIGINAL-README §Architecture; ORIGINAL-PLANNING §293/§431). That peer
// invocation only has meaning if the things agents hand each other are typed,
// validated artifacts. This module is that contract.
//
// Like the claim-integrity spine (PSG-143), it is INTENTIONALLY pure (no I/O, no
// `server-only`, no Supabase) so it is node-testable and importable from BOTH
// the Claude Code agent skills and the app. Phase 0 persists these as structured
// JSON files in the filesystem (ORIGINAL-README §Data model); Phase 1+ moves the
// same shapes to PostgreSQL — so the field lists here track the ORIGINAL-PLANNING
// data-model rows (lines 60–66) deliberately.
//
// Cross-module flows this contract enables:
//   SEO Auditor  --AuditReport.keywordTargets-->  Market Researcher / Content Writer
//   Scraper      --SentimentReport-------------->  Market Researcher
//   Market Res.  --ContentBrief----------------->  Content Writer  (consumed mid-draft)
//
// The synthesis/selection functions that ACT on these contracts live in sibling
// modules (market-researcher.ts, seo-auditor.ts, content-writer-handoff.ts).

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

/** ISO-8601 timestamp string (Phase 0 stores these in JSON, not as Date). */
const isoTimestamp = z.string().min(1);

/** A 0–100 priority/score. Used for keyword priority and brief priority_score. */
const score0to100 = z.number().min(0).max(100);

/* -------------------------------------------------------------------------- */
/* KeywordTarget — produced by the SEO Auditor, consumed by the Content Writer */
/* -------------------------------------------------------------------------- */

/**
 * Search intent for a keyword. Grounds the SEO Auditor → Content Writer handoff:
 * the writer treats `local`/`emergency` keywords differently from
 * `informational` ones when shaping a draft.
 */
export const KEYWORD_INTENTS = [
  "local", // "collision repair lincoln ne"
  "service", // "bumper repair", "frame straightening"
  "informational", // "how long does collision repair take"
  "transactional", // "free collision estimate near me"
  "emergency", // "towing after accident"
] as const;
export type KeywordIntent = (typeof KEYWORD_INTENTS)[number];

/**
 * A single keyword target the SEO Auditor recommends the Content Writer pursue.
 * Volume / difficulty / rank are optional because the auditor degrades
 * gracefully without SEMrush data (ORIGINAL-PLANNING §269).
 */
export const keywordTargetSchema = z.object({
  /** The keyword/phrase itself, e.g. "collision repair lincoln ne". */
  keyword: z.string().min(1),
  intent: z.enum(KEYWORD_INTENTS),
  /** Monthly search volume (SEMrush), when available. */
  searchVolume: z.number().int().nonnegative().optional(),
  /** Keyword difficulty 0–100 (SEMrush KD), when available. */
  difficulty: score0to100.optional(),
  /** Current SERP rank for the shop, or null when not ranking / unknown. */
  currentRank: z.number().int().positive().nullable().optional(),
  /**
   * Auditor-computed opportunity priority 0–100. Higher = pursue first.
   * (e.g. high volume + low difficulty + not currently ranking.)
   */
  priority: score0to100,
  /** Short operator-facing reason this target was selected. */
  rationale: z.string().min(1).optional(),
});
export type KeywordTarget = z.infer<typeof keywordTargetSchema>;

/* -------------------------------------------------------------------------- */
/* AuditReport — SEO Auditor output (ORIGINAL-PLANNING line 61)               */
/* -------------------------------------------------------------------------- */

export const AUDIT_REPORT_TYPES = ["technical_seo", "content_gap", "competitor"] as const;
export type AuditReportType = (typeof AUDIT_REPORT_TYPES)[number];

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** One technical/content/competitor finding from an audit. */
export const auditFindingSchema = z.object({
  severity: z.enum(FINDING_SEVERITIES),
  /** Area of the site/strategy the finding concerns, e.g. "page speed". */
  area: z.string().min(1),
  detail: z.string().min(1),
});
export type AuditFinding = z.infer<typeof auditFindingSchema>;

/**
 * The SEO Auditor's output for a shop. Carries `keywordTargets` so the
 * SEO Auditor → content path is a typed handoff, not a label
 * (the defect PSG-153 is fixing).
 */
export const auditReportSchema = z.object({
  id: z.string().min(1),
  shopId: z.string().min(1),
  type: z.enum(AUDIT_REPORT_TYPES),
  findings: z.array(auditFindingSchema).default([]),
  recommendations: z.array(z.string().min(1)).default([]),
  /** Keyword targets the auditor recommends — the content hand-off payload. */
  keywordTargets: z.array(keywordTargetSchema).default([]),
  createdAt: isoTimestamp,
});
export type AuditReport = z.infer<typeof auditReportSchema>;

/* -------------------------------------------------------------------------- */
/* SentimentReport — Web Scraper output (ORIGINAL-PLANNING line 65)           */
/* -------------------------------------------------------------------------- */

/**
 * Forum/review sentiment by topic, produced by the scraper and consumed by the
 * Market Researcher when synthesizing a brief.
 */
export const sentimentReportSchema = z.object({
  id: z.string().min(1),
  shopId: z.string().min(1),
  /** Where it was scraped, e.g. "google_reviews", "reddit", "facebook". */
  source: z.string().min(1),
  topic: z.string().min(1),
  /** Normalized sentiment, -1 (negative) … 1 (positive). */
  sentimentScore: z.number().min(-1).max(1),
  trendingTopics: z.array(z.string().min(1)).default([]),
  createdAt: isoTimestamp,
});
export type SentimentReport = z.infer<typeof sentimentReportSchema>;

/* -------------------------------------------------------------------------- */
/* ContentBrief — Market Researcher output, Content Writer input             */
/* (ORIGINAL-PLANNING line 66: "produced by market researcher, consumed by    */
/*  content writer")                                                          */
/* -------------------------------------------------------------------------- */

export const CONTENT_BRIEF_STATUSES = ["draft", "approved", "published"] as const;
export type ContentBriefStatus = (typeof CONTENT_BRIEF_STATUSES)[number];

/**
 * Provenance: which auditor/scraper artifacts a brief was synthesized from.
 * Makes the cross-module flow auditable (Paperclip audit-trail ethos) and lets
 * QA assert the brief actually consumed upstream data.
 */
export const briefSourcesSchema = z.object({
  auditReportId: z.string().min(1),
  sentimentReportIds: z.array(z.string().min(1)).default([]),
});
export type BriefSources = z.infer<typeof briefSourcesSchema>;

/**
 * A content opportunity brief. `targetKeywords` carries the full KeywordTarget
 * objects (not bare strings) so the SEO Auditor's signal survives the handoff
 * all the way into the Content Writer.
 */
export const contentBriefSchema = z.object({
  id: z.string().min(1),
  shopId: z.string().min(1),
  topic: z.string().min(1),
  targetKeywords: z.array(keywordTargetSchema).default([]),
  /** The competitor content gap this brief exploits. */
  competitorGap: z.string().min(1),
  /** Who the piece is for, in the shop's voice context. */
  audiencePersona: z.string().min(1),
  /** 0–100; drives the content queue ordering. */
  priorityScore: score0to100,
  status: z.enum(CONTENT_BRIEF_STATUSES).default("draft"),
  sources: briefSourcesSchema,
  createdAt: isoTimestamp,
});
export type ContentBrief = z.infer<typeof contentBriefSchema>;

/* -------------------------------------------------------------------------- */
/* ContentDraftRequest — the Content Writer's consumption point              */
/* -------------------------------------------------------------------------- */

export const CONTENT_TYPES = ["blog_post", "service_page", "meta_description"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * What the Content Writer receives to start a draft. It binds a ContentBrief to
 * an explicit set of keyword targets (which may include extra targets the writer
 * "asks the SEO auditor for mid-draft", ORIGINAL-PLANNING §293) and the shopId
 * whose verified-facts record the output will be gated against via
 * `checkClaimIntegrity` (PSG-143). Construction lives in content-writer-handoff.ts.
 */
export const contentDraftRequestSchema = z.object({
  shopId: z.string().min(1),
  brief: contentBriefSchema,
  /** Effective keyword targets for this draft (brief targets ∪ mid-draft asks). */
  keywordTargets: z.array(keywordTargetSchema).min(1),
  contentType: z.enum(CONTENT_TYPES),
});
export type ContentDraftRequest = z.infer<typeof contentDraftRequestSchema>;
