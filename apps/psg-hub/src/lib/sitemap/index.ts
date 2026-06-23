// Wave 1A / PSG-225 — Sitemap & content-architecture engine: public surface.
//
// BSM-native build against the `sitemap-maker` spec (PSG-215 review §4). A shop
// brief in, a client-ready sitemap + content plan out, gated by two human
// checkpoints. The four artifacts (page-inventory.csv, sitemap.mmd,
// content-calendar.md, summary.md) all derive from the single PageNode hierarchy
// (no drift by construction). The collision-repair vertical (8 personas +
// required-page coverage) activates for auto-body briefs; the general flow runs
// otherwise.
//
// Pure + node-testable throughout; live data sources (Semrush MCP, the seo-*
// fallbacks, the agent-engine seo-auditor, the intel content-gap path) plug in as
// the pipeline's injected seams.

export * from "./types";
export {
  COLLISION_PERSONAS,
  COLLISION_REQUIRED_PAGES,
  isCollisionVertical,
  personaById,
  type CollisionPersona,
  type RequiredPage,
} from "./collision-vertical";
export {
  slugify,
  flattenHierarchy,
  buildArchitecture,
  validateArchitecture,
  toMermaid,
  toPageInventoryRows,
  PAGE_INVENTORY_COLUMNS,
  MAX_CLICK_DEPTH,
  type FlatPage,
  type PageInventoryRow,
} from "./architecture";
export {
  clusterKeywords,
  pageTypeForIntent,
  validatePageType,
  clusterPriority,
  topicStem,
  type ClusterRefiner,
  type ClusterKeywordsOptions,
} from "./clustering";
export {
  deterministicKeywordProvider,
  inferIntent,
  type KeywordProvider,
} from "./keyword-provider";
export { buildContentCalendar, type BuildCalendarOptions } from "./calendar";
export {
  buildArtifacts,
  toPageInventoryCsv,
  toSitemapMermaid,
  toContentCalendarMarkdown,
  toSummaryMarkdown,
  type SitemapArtifacts,
} from "./artifacts";
export {
  runSitemapPipeline,
  applyInventoryDispositions,
  type SitemapPipelineDeps,
  type SitemapRunResult,
  type AuditProvider,
  type ContentGapProvider,
  type CheckpointHandler,
  type CheckpointPayload,
  type ClusterCheckpointPayload,
  type PackageCheckpointPayload,
} from "./pipeline";
export {
  makeKeywordProvider,
  makeAuditProvider,
  makeContentGapProvider,
  makeClusterRefiner,
  type KeywordSource,
  type RawKeyword,
  type KeywordProviderOptions,
  type AuditProviderDeps,
  type CrawledUrl,
  type UrlAuditVerdict,
  type ContentGapDeps,
  type ClusterRefinerDeps,
  type StructuredCompletion,
} from "./providers";
export { renderSitemapDeliverable, type RenderDeliverableOptions } from "./render";
export {
  persistSitemapPackage,
  loadSitemapPackages,
  SITEMAP_ARTIFACT_TYPE,
  SITEMAP_SOURCE_SKILL,
  type SitemapArtifactData,
  type SitemapArtifactRow,
  type PersistSitemapOptions,
  type PersistedSitemap,
} from "./persistence";
