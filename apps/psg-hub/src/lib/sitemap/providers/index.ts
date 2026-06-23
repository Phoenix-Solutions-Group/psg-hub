// Wave 1A / PSG-236 — Live provider adapters for the sitemap pipeline seams.
//
// Each adapter maps a live integration (Semrush MCP + fallback chain, firecrawl-map +
// seo-auditor, intel content-gap, intel multi-LLM router) onto the engine's pure seams.
// All live I/O is injected, so these stay node-testable; the /ops/sitemap route binds the
// injected functions to the real services (with budget/G5 gating in the route).

export {
  makeKeywordProvider,
  type KeywordSource,
  type RawKeyword,
  type KeywordProviderOptions,
} from "./keyword";
export {
  makeAuditProvider,
  type AuditProviderDeps,
  type CrawledUrl,
  type UrlAuditVerdict,
} from "./audit";
export { makeContentGapProvider, type ContentGapDeps } from "./content-gap";
export { makeClusterRefiner, type ClusterRefinerDeps } from "./cluster-refiner";
export type { StructuredCompletion } from "./llm";
