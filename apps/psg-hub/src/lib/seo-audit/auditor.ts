// Wave 1C / PSG-227 — Deterministic SEO auditor (pure rules engine).
//
// Turns crawled pages into (a) a Keep/Improve URL inventory and (b) technical/
// content findings, and derives keyword opportunities from the brief. All pure +
// node-testable: zero IO, zero clock. The live crawl (firecrawl-map) is injected
// upstream (./crawl.ts); this file only reasons over already-fetched signals.
//
// Auditing posture mirrors the verified-facts mandate: a page is flagged `improve`
// only on a CONCRETE defect we can name. Unknown signals (a sitemap-only map with
// no body metrics) never manufacture a defect — the page is `keep` with no finding.

import { THIN_CONTENT_WORDS } from "./constants";
import type {
  AuditFinding,
  CrawledPage,
  FindingSeverity,
  InventoryUrl,
  KeywordTarget,
  ShopBrief,
} from "./types";
import { inferIntent } from "../sitemap/keyword-provider";
import { isCollisionVertical } from "../sitemap/collision-vertical";

/* -------------------------------------------------------------------------- */
/* Page-level rules                                                            */
/* -------------------------------------------------------------------------- */

type PageIssue = { note: string; severity: FindingSeverity };

/**
 * Evaluate one crawled page against the deterministic SEO rule set. Returns the
 * concrete issues found (empty ⇒ the page is clean / Keep). Each rule only fires
 * when its signal is PRESENT — a missing metric is "unknown", never a defect.
 */
export function evaluatePage(page: CrawledPage): PageIssue[] {
  const issues: PageIssue[] = [];

  if (page.statusCode != null && page.statusCode >= 400) {
    issues.push({ note: `Returns HTTP ${page.statusCode} (broken page)`, severity: "critical" });
  }
  if (page.indexable === false) {
    issues.push({ note: "Not indexable (noindex / canonical points away)", severity: "high" });
  }
  if (page.title != null && page.title.trim() === "") {
    issues.push({ note: "Missing <title> tag", severity: "high" });
  } else if (page.title != null && page.title.trim().length < 15) {
    issues.push({ note: "Title tag is too short to rank well", severity: "medium" });
  }
  if (page.metaDescription != null && page.metaDescription.trim() === "") {
    issues.push({ note: "Missing meta description", severity: "medium" });
  }
  if (page.h1Count != null) {
    if (page.h1Count === 0) issues.push({ note: "No <h1> heading", severity: "medium" });
    else if (page.h1Count > 1) issues.push({ note: `Multiple <h1> headings (${page.h1Count})`, severity: "low" });
  }
  if (page.wordCount != null && page.wordCount < THIN_CONTENT_WORDS) {
    issues.push({ note: `Thin content (${page.wordCount} words)`, severity: "medium" });
  }
  if (page.hasImageAltGaps === true) {
    issues.push({ note: "Images missing alt text", severity: "low" });
  }

  return issues;
}

/** The highest severity in a set (ranked critical > high > medium > low). */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/* -------------------------------------------------------------------------- */
/* Crawl → inventory + findings                                                */
/* -------------------------------------------------------------------------- */

export type AuditedSite = {
  inventory: InventoryUrl[];
  findings: AuditFinding[];
};

/**
 * Audit a crawled site: one Keep/Improve row per page + one finding per concrete
 * page defect. Pages with no issues are `keep` (no note); pages with at least one
 * issue are `improve` with the worst issue as the row note. Findings are sorted
 * by severity (critical first) so the report leads with what matters. Pure: never
 * mutates inputs, stable ordering for a given crawl.
 */
export function auditCrawledSite(pages: CrawledPage[]): AuditedSite {
  const inventory: InventoryUrl[] = [];
  const findings: AuditFinding[] = [];

  for (const page of pages) {
    const issues = evaluatePage(page);
    const title = page.title?.trim() || "";
    if (issues.length === 0) {
      inventory.push({ url: page.url, title, disposition: "keep" });
      continue;
    }
    // Lead the row with the worst issue's note.
    const worst = issues
      .slice()
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];
    inventory.push({ url: page.url, title, disposition: "improve", note: worst.note });
    for (const issue of issues) {
      findings.push({ severity: issue.severity, area: page.url, detail: issue.note });
    }
  }

  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return { inventory, findings };
}

/* -------------------------------------------------------------------------- */
/* Keyword opportunities (brief → ranked KeywordTargets)                       */
/* -------------------------------------------------------------------------- */

/** Deterministic opportunity score 0–100: transactional/local/emergency intents
 *  (closest to a booked job) rank highest, then service, then informational. */
const INTENT_WEIGHT: Record<KeywordTarget["intent"], number> = {
  transactional: 95,
  emergency: 90,
  local: 85,
  service: 70,
  informational: 50,
};

/**
 * Derive ranked keyword opportunities from the brief alone (zero vendor spend),
 * so the audit ships a content hand-off even with no Semrush seat. Combines each
 * service with bare / "near me" / per-city permutations, plus a couple of
 * collision-vertical evergreens. Deterministic + sorted by priority desc; the
 * live route may replace this with Semrush-backed targets later.
 */
export function deriveKeywordTargets(brief: ShopBrief, limit = 12): KeywordTarget[] {
  const cities = brief.locations.map((l) => l.city).filter(Boolean);
  const phrases: string[] = [];
  const push = (p: string) => phrases.push(p);

  for (const service of brief.services) {
    push(service);
    push(`${service} near me`);
    for (const city of cities) push(`${service} ${city}`);
  }
  if (isCollisionVertical(brief.vertical)) {
    for (const city of cities) {
      push(`collision repair ${city}`);
      push(`free collision estimate ${city}`);
      push(`auto body shop ${city}`);
    }
    push("how long does collision repair take");
  }

  // Dedupe (case-insensitive), rank by intent weight, slug-stable tiebreak.
  const seen = new Set<string>();
  const targets: KeywordTarget[] = [];
  for (const keyword of phrases) {
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const intent = inferIntent(keyword);
    targets.push({
      keyword,
      intent,
      priority: INTENT_WEIGHT[intent],
      currentRank: null,
      rationale: `${intent} intent — derived from the shop brief (no live keyword data)`,
    });
  }

  targets.sort((a, b) => b.priority - a.priority || a.keyword.localeCompare(b.keyword));
  return limit > 0 ? targets.slice(0, limit) : [];
}
