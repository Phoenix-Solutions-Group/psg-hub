// Wave 1C / PSG-227 — Shop SEO audit report builder (pure assembler).
//
// Composes the deterministic auditor (auditor.ts) into the finished, client-ready
// `ShopAuditReport`: baseline audit + Keep/Improve URL inventory + keyword
// opportunities + an overall SEO health score/grade. Pure + sync: the async crawl
// happens in ./run.ts, which hands the already-fetched pages here. The renderer
// (./render.ts) and persistence (./run.ts) are both downstream of this object.
//
// GREENFIELD: a brief with no domain (or a crawl that returned nothing) yields a
// forward-looking BUILD PLAN, not a score — healthScore is null, grade "—", the
// inventory is empty, and the findings become "what your new site needs". This is
// the "greenfield degrades cleanly" acceptance path.

import { auditCrawledSite, deriveKeywordTargets } from "./auditor";
import { GRADE_THRESHOLDS, SEVERITY_PENALTY } from "./constants";
import type {
  AuditFinding,
  AuditGrade,
  AuditSummary,
  CrawledPage,
  FindingSeverity,
  InventoryUrl,
  ShopAuditReport,
  ShopBrief,
} from "./types";

export type BuildAuditOptions = {
  /** ISO timestamp stamped on the report (injected for purity). */
  generatedAt: string;
  /** Already-crawled pages from the firecrawl-map seam (empty ⇒ greenfield). */
  pages?: CrawledPage[];
  /** Max keyword opportunities to surface (default 12). */
  keywordLimit?: number;
};

function countBySeverity(findings: AuditFinding[]): AuditSummary["findingsBySeverity"] {
  const acc = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) acc[f.severity] += 1;
  return acc;
}

/** Health score = 100 minus weighted penalties, floored at 0. */
export function computeHealthScore(findings: AuditFinding[]): number {
  const penalty = findings.reduce((sum, f) => sum + SEVERITY_PENALTY[f.severity], 0);
  return Math.max(0, 100 - penalty);
}

export function gradeForScore(score: number): AuditGrade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "F";
}

/* -------------------------------------------------------------------------- */
/* Greenfield build plan                                                       */
/* -------------------------------------------------------------------------- */

/** Forward-looking findings for a shop with no live site — framed as build needs,
 *  not defects, so the customer report reads as a plan rather than a scolding. */
function greenfieldFindings(brief: ShopBrief): AuditFinding[] {
  const findings: AuditFinding[] = [
    { severity: "high", area: "website", detail: "No live website found — a fast, mobile-first site is the foundation for every other channel." },
    { severity: "high", area: "local SEO", detail: "Stand up a Google Business Profile and consistent name/address/phone before chasing rankings." },
  ];
  if (brief.services.length > 0) {
    findings.push({
      severity: "medium",
      area: "service pages",
      detail: `Each core service (${brief.services.slice(0, 3).join(", ")}${brief.services.length > 3 ? ", …" : ""}) needs its own optimized landing page.`,
    });
  }
  if (brief.locations.length > 0) {
    findings.push({
      severity: "medium",
      area: "service-area pages",
      detail: `Build a location page per city served (${brief.locations.map((l) => l.city).slice(0, 3).join(", ")}).`,
    });
  }
  return findings;
}

function recommendationsFor(mode: "audited" | "greenfield", findings: AuditFinding[], brief: ShopBrief): string[] {
  if (mode === "greenfield") {
    return [
      "Launch a baseline website with a homepage, services, locations, and contact pages.",
      "Claim and complete your Google Business Profile with photos and accurate hours.",
      "Publish one optimized service page for each repair specialty you offer.",
      "Re-run this audit once the site is live to get a scored baseline.",
    ];
  }
  const recs: string[] = [];
  const sev = countBySeverity(findings);
  if (sev.critical > 0) recs.push("Fix broken pages (4xx/5xx) first — they waste crawl budget and lose customers.");
  if (sev.high > 0) recs.push("Restore missing titles and indexability so your key pages can rank at all.");
  if (sev.medium > 0) recs.push("Add meta descriptions, single H1s, and richer content to thin or unoptimized pages.");
  recs.push("Prioritize the keyword opportunities below into your content calendar.");
  if (brief.locations.length > 1) recs.push("Ensure every city you serve has a dedicated, distinct service-area page.");
  return recs;
}

/* -------------------------------------------------------------------------- */
/* buildShopAuditReport                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Assemble the full audit report for a brief + its crawled pages. Returns a
 * client-ready `ShopAuditReport` the renderer projects 1:1. Greenfield (no domain
 * or empty crawl) yields a build plan with `mode: "greenfield"`, null score.
 */
export function buildShopAuditReport(brief: ShopBrief, opts: BuildAuditOptions): ShopAuditReport {
  const pages = opts.pages ?? [];
  const domain = brief.domain ?? null;
  const keywordTargets = deriveKeywordTargets(brief, opts.keywordLimit);

  // Greenfield: no live site to audit (no domain, or the crawl surfaced nothing).
  const greenfield = !domain || pages.length === 0;
  if (greenfield) {
    const findings = greenfieldFindings(brief);
    return {
      shopId: brief.shopId,
      businessName: brief.businessName,
      domain,
      generatedAt: opts.generatedAt,
      mode: "greenfield",
      healthScore: null,
      grade: "—",
      summary: {
        pagesCrawled: 0,
        keepCount: 0,
        improveCount: 0,
        findingsBySeverity: countBySeverity(findings),
        keywordOpportunities: keywordTargets.length,
      },
      findings,
      recommendations: recommendationsFor("greenfield", findings, brief),
      inventory: [],
      keywordTargets,
    };
  }

  const { inventory, findings } = auditCrawledSite(pages);
  const healthScore = computeHealthScore(findings);
  const keepCount = inventory.filter((u: InventoryUrl) => u.disposition === "keep").length;
  const improveCount = inventory.length - keepCount;

  return {
    shopId: brief.shopId,
    businessName: brief.businessName,
    domain,
    generatedAt: opts.generatedAt,
    mode: "audited",
    healthScore,
    grade: gradeForScore(healthScore),
    summary: {
      pagesCrawled: pages.length,
      keepCount,
      improveCount,
      findingsBySeverity: countBySeverity(findings),
      keywordOpportunities: keywordTargets.length,
    },
    findings,
    recommendations: recommendationsFor("audited", findings, brief),
    inventory,
    keywordTargets,
  };
}

/* -------------------------------------------------------------------------- */
/* 1A reuse: AuditProvider adapter                                             */
/* -------------------------------------------------------------------------- */

/**
 * Adapt this deliverable's crawl→inventory into Wave 1A's `AuditProvider` seam
 * (sitemap pipeline stage 2), so the sitemap engine and the audit deliverable
 * share ONE inventory implementation. Given a crawl function, returns the
 * Keep/Improve rows for the brief's domain (greenfield ⇒ []).
 */
export function makeAuditProvider(
  crawl: (domain: string) => Promise<CrawledPage[]>,
): (brief: ShopBrief) => Promise<InventoryUrl[]> {
  return async (brief: ShopBrief) => {
    const domain = brief.domain ?? null;
    if (!domain) return [];
    const pages = await crawl(domain);
    return auditCrawledSite(pages).inventory;
  };
}

// Re-export for the renderer + route ergonomics.
export type { FindingSeverity };
