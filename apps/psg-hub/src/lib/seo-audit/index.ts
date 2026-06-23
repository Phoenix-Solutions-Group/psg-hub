// Wave 1C / PSG-227 — Shop SEO audit deliverable: public surface.
//
// Formalizes BSM's skill-based seo-auditor into a customer-facing, re-runnable
// shop-audit deliverable (PSG-215 review §5 gap #3). A shop brief in, a baseline
// SEO audit + Keep/Improve URL inventory + keyword opportunities out, rendered to
// a branded customer report and persisted as an immutable history row. Reuses
// Wave 1A's ShopBrief + InventoryUrl + firecrawl-map plumbing (no fork).
//
// Pure throughout except ./run.ts (server-only: DB + live crawl). The pure engine
// (types/auditor/report/render) is node-testable and importable from the agent
// skills; the live crawl + persistence are injected seams.

export * from "./types";
export {
  evaluatePage,
  auditCrawledSite,
  deriveKeywordTargets,
  type AuditedSite,
} from "./auditor";
export {
  buildShopAuditReport,
  computeHealthScore,
  gradeForScore,
  makeAuditProvider,
  type BuildAuditOptions,
} from "./report";
export { renderShopAuditReportHtml } from "./render";
export {
  noopCrawlProvider,
  createFirecrawlProvider,
  selectCrawlProvider,
  normalizeDomain,
  scrapeResultToPage,
  type SiteCrawlProvider,
  type FirecrawlDeps,
  type FetchLike,
} from "./crawl";
export {
  THIN_CONTENT_WORDS,
  SEVERITY_PENALTY,
  GRADE_THRESHOLDS,
} from "./constants";
// ./run.ts is server-only (DB + crawl); import it directly where needed, not via
// this barrel, so the pure engine stays importable from node/agent contexts.
