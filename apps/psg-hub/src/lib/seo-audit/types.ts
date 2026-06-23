// Wave 1C / PSG-227 — Shop SEO audit deliverable: data contracts.
//
// BSM has a skill-based `seo-auditor` (agent-engine) but no customer-facing shop
// audit DELIVERABLE (PSG-215 review §5, gap #3). This module formalizes the audit
// into a typed artifact: a baseline SEO audit (findings + recommendations +
// keyword targets) PLUS a full URL inventory with Keep/Improve flags for the
// shop's existing site, surfaced as a customer-visible report and re-runnable on
// demand.
//
// It deliberately REUSES Wave 1A's plumbing rather than forking it:
//   • `ShopBrief` is the same single input the sitemap engine consumes — a 1C
//     audit and a 1A sitemap run off the identical brief.
//   • `InventoryUrl` (the Keep/Improve URL row) is 1A's `AuditProvider` output
//     type, so `auditedInventory()` here is a drop-in `AuditProvider` for the
//     sitemap pipeline (stage 2). No second inventory shape.
//   • `AuditFinding` / `FindingSeverity` / `KeywordTarget` are the agent-engine
//     contracts the existing `seo-auditor` skill already speaks.
//
// Like 1A and the agent-engine, this is INTENTIONALLY pure (no I/O, no
// `server-only`, no Supabase) so it is node-testable and importable from both the
// app routes and the Claude Code agent skills. The live crawl (firecrawl-map) and
// persistence are injected seams in ./crawl.ts and ./run.ts.

import { z } from "zod";
import {
  auditFindingSchema,
  keywordTargetSchema,
} from "../agent-engine/types";
import { inventoryUrlSchema, shopBriefSchema } from "../sitemap/types";

/* -------------------------------------------------------------------------- */
/* Re-exports — the shared contracts this deliverable speaks                   */
/* -------------------------------------------------------------------------- */

export { shopBriefSchema } from "../sitemap/types";
export type { ShopBrief, InventoryUrl, PageDisposition } from "../sitemap/types";
export type {
  AuditFinding,
  FindingSeverity,
  KeywordTarget,
} from "../agent-engine/types";
export { FINDING_SEVERITIES } from "../agent-engine/types";

const isoTimestamp = z.string().min(1);
const score0to100 = z.number().min(0).max(100);

/* -------------------------------------------------------------------------- */
/* CrawledPage — the firecrawl-map seam output (stage input)                   */
/* -------------------------------------------------------------------------- */

/**
 * One page discovered + fetched by the crawl seam (live: firecrawl-map / GSC).
 * Every signal is OPTIONAL because crawlers degrade: a sitemap-only map yields
 * URLs with no body metrics, and the heuristic auditor treats "unknown" as
 * "can't fault it" (no false Improve). The deterministic auditor in ./auditor.ts
 * turns these signals into Keep/Improve dispositions + findings.
 */
export const crawledPageSchema = z.object({
  url: z.string().min(1),
  /** <title> text, when fetched. */
  title: z.string().optional(),
  /** HTTP status, when the crawler fetched the body (not just mapped the URL). */
  statusCode: z.number().int().optional(),
  /** Visible word count of the main content, when extracted. */
  wordCount: z.number().int().nonnegative().optional(),
  /** Number of <h1> elements found (SEO wants exactly 1). */
  h1Count: z.number().int().nonnegative().optional(),
  /** <meta name="description"> text, when present. */
  metaDescription: z.string().optional(),
  /** Whether an <img> missing alt text was seen (accessibility/SEO signal). */
  hasImageAltGaps: z.boolean().optional(),
  /** True if the page is indexable (no noindex / canonical-away). */
  indexable: z.boolean().optional(),
});
export type CrawledPage = z.infer<typeof crawledPageSchema>;

/* -------------------------------------------------------------------------- */
/* Audit mode + grade                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `audited`   — a live domain was crawled; the report scores the existing site.
 * `greenfield`— no domain (or an empty crawl); the report is a forward-looking
 *               build plan, NOT a score (healthScore is null, grade "—").
 */
export const AUDIT_MODES = ["audited", "greenfield"] as const;
export type AuditMode = (typeof AUDIT_MODES)[number];

export const AUDIT_GRADES = ["A", "B", "C", "D", "F", "—"] as const;
export type AuditGrade = (typeof AUDIT_GRADES)[number];

/* -------------------------------------------------------------------------- */
/* Summary KPIs                                                                */
/* -------------------------------------------------------------------------- */

export const auditSummarySchema = z.object({
  /** URLs the crawl surfaced (0 for greenfield). */
  pagesCrawled: z.number().int().nonnegative(),
  /** Inventory rows flagged keep. */
  keepCount: z.number().int().nonnegative(),
  /** Inventory rows flagged improve. */
  improveCount: z.number().int().nonnegative(),
  /** Findings bucketed by severity. */
  findingsBySeverity: z.object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
  /** Keyword opportunities surfaced for the content plan. */
  keywordOpportunities: z.number().int().nonnegative(),
});
export type AuditSummary = z.infer<typeof auditSummarySchema>;

/* -------------------------------------------------------------------------- */
/* ShopAuditReport — the finished, client-ready deliverable                    */
/* -------------------------------------------------------------------------- */

/**
 * The whole audit. `inventory` carries the Keep/Improve rows; `findings` the
 * technical/content issues; `keywordTargets` the content-plan hand-off (the same
 * payload the agent-engine SEO Auditor → Content Writer path consumes). The
 * customer-facing renderer (./render.ts) is a pure projection of this object — it
 * invents nothing.
 */
export const shopAuditReportSchema = z.object({
  shopId: z.string().min(1),
  businessName: z.string().min(1),
  /** Audited domain, or null for a greenfield build (no live site). */
  domain: z.string().min(1).nullable(),
  generatedAt: isoTimestamp,
  mode: z.enum(AUDIT_MODES),
  /** 0–100 SEO health, or null for greenfield (nothing live to score). */
  healthScore: score0to100.nullable(),
  grade: z.enum(AUDIT_GRADES),
  summary: auditSummarySchema,
  findings: z.array(auditFindingSchema).default([]),
  recommendations: z.array(z.string().min(1)).default([]),
  inventory: z.array(inventoryUrlSchema).default([]),
  keywordTargets: z.array(keywordTargetSchema).default([]),
});
export type ShopAuditReport = z.infer<typeof shopAuditReportSchema>;

/** Re-validate the brief at the public boundary (route/orchestrator). */
export type { ShopBrief as _ShopBrief } from "../sitemap/types";
export const parseShopBrief = (input: unknown) => shopBriefSchema.parse(input);
