// Wave 1A / PSG-225 — Sitemap & content-architecture engine: data contracts.
//
// BSM has no site-architecture capability today (PSG-215 review §2). This is a
// BSM-native BUILD against the `sitemap-maker` spec (a Claude Code workflow spec,
// "to build" — NOT a port). The engine turns a shop brief into a client-ready
// sitemap + content plan by chaining: keyword universe → baseline audit + URL
// inventory → competitor content-gap → SERP clustering → page-type validation →
// site architecture → content calendar.
//
// Like the agent-engine cross-module contract (PSG-153) and the intel report
// assembler (16-03), this module is INTENTIONALLY pure (no I/O, no `server-only`,
// no Supabase) so it is node-testable and importable from both the app routes and
// the Claude Code agent skills. Live data sources (Semrush MCP, the seo-* fallback
// tools, the agent-engine seo-auditor) are injected as seams (see ./pipeline.ts);
// the deterministic transforms (clustering, hierarchy, CSV/Mermaid derivation,
// calendar) carry zero vendor spend and run under vitest's node env.
//
// THE load-bearing invariant of this module: `page-inventory.csv` and the Mermaid
// `sitemap.mmd` both DERIVE FROM ONE structure — the `PageNode` tree rooted at the
// home page. They cannot drift because they are two serializations of the same
// flattened node list (see ./architecture.ts). That is the spec's "single hierarchy
// source → no drift" requirement, satisfied by construction.

import { z } from "zod";
import { KEYWORD_INTENTS } from "../agent-engine/types";

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

/** ISO-8601 timestamp string (stored as text, never as Date, for purity). */
const isoTimestamp = z.string().min(1);

/** A 0–100 priority/score (mirrors agent-engine's score0to100). */
const score0to100 = z.number().min(0).max(100);

/** Reuse the agent-engine search-intent vocabulary — no duplicate enum. */
export { KEYWORD_INTENTS } from "../agent-engine/types";
export type { KeywordIntent } from "../agent-engine/types";

/* -------------------------------------------------------------------------- */
/* ShopBrief — the engine's single input                                      */
/* -------------------------------------------------------------------------- */

/** Which vertical content module applies. `collision_repair` wires the 8-persona
 *  required-page coverage; `general` runs the generic flow (spec §collision module). */
export const SITEMAP_VERTICALS = ["collision_repair", "general"] as const;
export type SitemapVertical = (typeof SITEMAP_VERTICALS)[number];

/** A geographic location the shop serves (drives location / service-area pages). */
export const briefLocationSchema = z.object({
  city: z.string().min(1),
  state: z.string().min(1),
  /** Optional: this is the shop's primary/HQ location (gets the canonical page). */
  primary: z.boolean().optional(),
});
export type BriefLocation = z.infer<typeof briefLocationSchema>;

/**
 * The shop brief that drives the whole run. `domain` absent ⇒ greenfield (no URL
 * inventory to audit; every page is `new`). Services + locations + competitors are
 * the levers the keyword universe, content-gap and architecture stages consume.
 */
export const shopBriefSchema = z.object({
  shopId: z.string().min(1),
  businessName: z.string().min(1),
  /** Live site to audit, or null/omitted for a greenfield build. */
  domain: z.string().min(1).nullable().optional(),
  vertical: z.enum(SITEMAP_VERTICALS).default("general"),
  /** Services the shop offers, in the shop's words (e.g. "frame straightening"). */
  services: z.array(z.string().min(1)).default([]),
  locations: z.array(briefLocationSchema).default([]),
  /** Competitor domains/names for the content-gap stage. */
  competitors: z.array(z.string().min(1)).default([]),
});
export type ShopBrief = z.infer<typeof shopBriefSchema>;

/* -------------------------------------------------------------------------- */
/* Keyword universe (stage 1)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One keyword in the universe. Volume/difficulty optional because the engine
 * degrades gracefully when no Semrush seat is available and falls back to the
 * deterministic provider (intent is always derivable from the phrase shape).
 */
export const sitemapKeywordSchema = z.object({
  keyword: z.string().min(1),
  intent: z.enum(KEYWORD_INTENTS),
  searchVolume: z.number().int().nonnegative().optional(),
  difficulty: score0to100.optional(),
  /** Where it came from: "semrush" | "dataforseo" | "gsc" | "derived" | "competitor_gap". */
  source: z.string().min(1).default("derived"),
});
export type SitemapKeyword = z.infer<typeof sitemapKeywordSchema>;

/* -------------------------------------------------------------------------- */
/* URL inventory (stage 2 — baseline audit, Keep/Improve)                     */
/* -------------------------------------------------------------------------- */

/** Disposition of a page in the produced architecture. Greenfield pages are
 *  `new`; existing pages are flagged Keep (carry forward as-is) or Improve. */
export const PAGE_DISPOSITIONS = ["new", "keep", "improve"] as const;
export type PageDisposition = (typeof PAGE_DISPOSITIONS)[number];

/** An existing URL discovered on the live site (firecrawl-map / GSC), with a
 *  Keep/Improve flag from the baseline audit. */
export const inventoryUrlSchema = z.object({
  url: z.string().min(1),
  title: z.string().default(""),
  disposition: z.enum(["keep", "improve"]),
  /** Why it was flagged improve (thin content, no H1, slow, etc.). */
  note: z.string().optional(),
});
export type InventoryUrl = z.infer<typeof inventoryUrlSchema>;

/* -------------------------------------------------------------------------- */
/* Page types (stage 5 — SXO page-type validation)                            */
/* -------------------------------------------------------------------------- */

/** The valid page archetypes the architecture may use. Each cluster is validated
 *  to exactly one of these so the hierarchy is well-typed (spec: seo-sxo). */
export const PAGE_TYPES = [
  "home",
  "service",
  "service_area", // city / location landing pages
  "landing", // conversion pages (free estimate, financing)
  "resource", // guides (insurance claims, what-to-expect)
  "blog_index",
  "blog_post",
  "gallery",
  "reviews",
  "about",
  "contact",
  "faq",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/* -------------------------------------------------------------------------- */
/* SERP clusters (stage 4)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A SERP-intent cluster: keywords that should be satisfied by ONE page. Produced
 * by ./clustering.ts (deterministic grouping with an optional injected LLM refine
 * seam) and validated to a single `pageType` by ./clustering.ts validatePageTypes.
 */
export const serpClusterSchema = z.object({
  id: z.string().min(1),
  /** Human label, e.g. "Collision repair (core service)". */
  label: z.string().min(1),
  intent: z.enum(KEYWORD_INTENTS),
  pageType: z.enum(PAGE_TYPES),
  keywords: z.array(sitemapKeywordSchema).min(1),
  /** Collision personas this cluster serves (empty for the general flow). */
  personaIds: z.array(z.string().min(1)).default([]),
  /** Aggregate opportunity 0–100 (volume × inverse difficulty), drives ordering. */
  priority: score0to100,
});
export type SerpCluster = z.infer<typeof serpClusterSchema>;

/* -------------------------------------------------------------------------- */
/* PageNode — THE single hierarchy source                                     */
/* -------------------------------------------------------------------------- */

/**
 * One node in the site hierarchy. The tree rooted at the home page is the ONE
 * structure from which both `page-inventory.csv` and `sitemap.mmd` are derived
 * (./architecture.ts) — they cannot drift because they are two walks of the same
 * flattened node list.
 *
 * Zod cannot infer recursive types without the explicit annotation, so `children`
 * uses `z.lazy`. `internalLinks` are slugs of sibling/related pages (the spec's
 * internal-link planning); the 3-click rule is validated on depth in architecture.ts.
 */
export type PageNode = {
  /** Stable id (slug-derived). Used for Mermaid node ids + internal-link refs. */
  id: string;
  title: string;
  /** URL path segment relative to parent, e.g. "frame-straightening". */
  slug: string;
  pageType: PageType;
  intent: z.infer<typeof sitemapKeywordSchema>["intent"];
  disposition: PageDisposition;
  /** Keywords this page targets (from its cluster). */
  targetKeywords: string[];
  /** Source cluster id, when this page came from a cluster (null for structural pages). */
  clusterId: string | null;
  /** Collision personas this page serves. */
  personaIds: string[];
  /** Slugs/ids of related pages to internally link to. */
  internalLinks: string[];
  children: PageNode[];
};

export const pageNodeSchema: z.ZodType<PageNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    slug: z.string(), // home is "" (root); all others non-empty (checked in architecture)
    pageType: z.enum(PAGE_TYPES),
    intent: z.enum(KEYWORD_INTENTS),
    disposition: z.enum(PAGE_DISPOSITIONS),
    targetKeywords: z.array(z.string().min(1)).default([]),
    clusterId: z.string().min(1).nullable(),
    personaIds: z.array(z.string().min(1)).default([]),
    internalLinks: z.array(z.string().min(1)).default([]),
    children: z.array(pageNodeSchema).default([]),
  }),
);

/* -------------------------------------------------------------------------- */
/* Content calendar (stage 7)                                                  */
/* -------------------------------------------------------------------------- */

export const contentCalendarEntrySchema = z.object({
  /** 1-based month index in the plan (month 1 = first month after hand-off). */
  month: z.number().int().positive(),
  /** The page this entry produces/refreshes (slug path, e.g. "/services/frame-straightening"). */
  pagePath: z.string().min(1),
  title: z.string().min(1),
  pageType: z.enum(PAGE_TYPES),
  disposition: z.enum(PAGE_DISPOSITIONS),
  primaryKeyword: z.string().default(""),
  personaIds: z.array(z.string().min(1)).default([]),
  priority: score0to100,
});
export type ContentCalendarEntry = z.infer<typeof contentCalendarEntrySchema>;

export const contentCalendarSchema = z.object({
  /** Pages produced per month (cadence). */
  pagesPerMonth: z.number().int().positive(),
  entries: z.array(contentCalendarEntrySchema).default([]),
});
export type ContentCalendar = z.infer<typeof contentCalendarSchema>;

/* -------------------------------------------------------------------------- */
/* Checkpoints (the two human gates)                                          */
/* -------------------------------------------------------------------------- */

export const CHECKPOINT_PHASES = ["clusters_page_types", "package_handoff"] as const;
export type CheckpointPhase = (typeof CHECKPOINT_PHASES)[number];

export const CHECKPOINT_DECISIONS = ["approved", "changes_requested"] as const;
export type CheckpointDecision = (typeof CHECKPOINT_DECISIONS)[number];

/** A human decision at a checkpoint. The route wires this to the approval queue /
 *  an issue-thread interaction; the engine only needs the typed verdict. */
export const checkpointApprovalSchema = z.object({
  phase: z.enum(CHECKPOINT_PHASES),
  decision: z.enum(CHECKPOINT_DECISIONS),
  /** Who approved (user/agent id or name). */
  approvedBy: z.string().min(1),
  approvedAt: isoTimestamp,
  notes: z.string().optional(),
});
export type CheckpointApproval = z.infer<typeof checkpointApprovalSchema>;

/* -------------------------------------------------------------------------- */
/* SitemapPackage — the finished, client-ready deliverable                    */
/* -------------------------------------------------------------------------- */

export const coverageGapSchema = z.object({
  requiredKey: z.string().min(1),
  title: z.string().min(1),
  pageType: z.enum(PAGE_TYPES),
});
export type CoverageGap = z.infer<typeof coverageGapSchema>;

/** Validation result for the produced architecture (3-click rule, slugs, links). */
export const architectureValidationSchema = z.object({
  /** Pages deeper than 3 clicks from home (spec: 3-click rule). */
  threeClickViolations: z.array(z.string().min(1)).default([]),
  /** Duplicate full slug paths. */
  duplicateSlugPaths: z.array(z.string().min(1)).default([]),
  /** internalLinks pointing at ids that don't exist. */
  brokenInternalLinks: z.array(z.string().min(1)).default([]),
  /** Required collision pages not present (collision vertical only). */
  coverageGaps: z.array(coverageGapSchema).default([]),
  /** True when no blocking violation exists. */
  ok: z.boolean(),
});
export type ArchitectureValidation = z.infer<typeof architectureValidationSchema>;

/**
 * The whole package. `root` is the single source of truth; the four artifacts are
 * derived from it (see ./artifacts.ts) so they never drift. `checkpoints` records
 * the two approvals that gated the run (audit trail).
 */
export type SitemapPackage = {
  brief: ShopBrief;
  generatedAt: string;
  vertical: SitemapVertical;
  root: PageNode;
  clusters: SerpCluster[];
  calendar: ContentCalendar;
  validation: ArchitectureValidation;
  inventory: InventoryUrl[];
  checkpoints: CheckpointApproval[];
};
