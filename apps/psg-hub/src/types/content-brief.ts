// BSM Phase 0 / PSG-160 — Market Researcher → ContentBrief persisted DTO.
//
// This is the loader/API-facing shape for the cross-module Market Researcher →
// Content Writer path (PSG-153 / QA defect PSG-145 item 6). A brief is produced
// by `synthesizeContentBrief` (the pure agent-engine spine, src/lib/agent-engine)
// and persisted as a `content_brief` row in `research_artifacts`;
// `fetchMarketResearchBrief` (src/lib/bsm/content-briefs.ts) reads the newest one
// for a shop and normalizes it into this DTO. The Content Writer input builder
// consumes these alongside Ravi's KeywordTarget; Ada owns that merge on PSG-153 —
// this module only exposes the Market Researcher half.
//
// NOTE (reconciliation, owned by Ada on PSG-153): a SECOND, richer `ContentBrief`
// exists in the pure agent-engine contract (src/lib/agent-engine/types.ts —
// camelCase, full KeywordTarget[] `targetKeywords`, status draft|approved|
// published, `sources` provenance). That is the *synthesis output*; THIS is the
// flattened *persisted/API* projection the issue specifies (snake_case,
// `target_keywords: string[]`, status draft|active). The two are intentionally
// distinct modules so there is no TS collision; `toPersistedBrief` (see
// content-briefs.ts) maps synthesis → persisted. Do not merge here.

import { z } from "zod";

/** Lifecycle of a persisted content brief: a fresh draft vs. one in the queue. */
export const CONTENT_BRIEF_STATUSES = ["draft", "active"] as const;
export type ContentBriefStatus = (typeof CONTENT_BRIEF_STATUSES)[number];

/**
 * A content opportunity brief as stored in `research_artifacts.data` and returned
 * by the API. Flattened from the agent-engine synthesis output: `target_keywords`
 * are bare phrases (the full KeywordTarget objects live on the SEO side and are
 * merged in by Ada on PSG-153), and `priority_score` drives content-queue order.
 */
export const contentBriefSchema = z.object({
  id: z.string().min(1),
  shop_id: z.string().min(1),
  topic: z.string().min(1),
  target_keywords: z.array(z.string().min(1)).default([]),
  /** The competitor content gap this brief exploits. */
  competitor_gap: z.string().min(1),
  /** Who the piece is for, in the shop's voice context. */
  audience_persona: z.string().min(1),
  /** 0–100; drives the content queue ordering. */
  priority_score: z.number().min(0).max(100),
  status: z.enum(CONTENT_BRIEF_STATUSES).default("draft"),
  /** ISO-8601 timestamp (Phase 0 stores these as strings in jsonb, not Date). */
  created_at: z.string().min(1),
});

export type ContentBrief = z.infer<typeof contentBriefSchema>;
