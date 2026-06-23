// Wave 1A / PSG-225 — Sitemap pipeline orchestrator (the gated workflow).
//
// Chains the spec's stages into ONE run with TWO human checkpoints, exactly as the
// `sitemap-maker` spec requires:
//
//   1. keyword universe ............. KeywordProvider seam (live: Semrush MCP)
//   2. baseline audit + URL inventory  AuditProvider seam   (live: seo-auditor + firecrawl-map)
//   3. competitor content-gap ....... ContentGapProvider seam
//   4. SERP clustering .............. clusterKeywords (deterministic + optional refine)
//   5. page-type validation ......... inside clusterKeywords (seo-sxo)
//   ── CHECKPOINT 1: approve clusters + page types ──
//   6. site architecture ............ buildArchitecture (single hierarchy source)
//   7. content calendar ............. buildContentCalendar
//   ── CHECKPOINT 2: approve package before client hand-off ──
//   → four artifacts
//
// Every external stage is an INJECTED SEAM, so the orchestrator is pure + node-
// testable; the live route wires Semrush MCP / the agent-engine seo-auditor / the
// intel content-gap path. Checkpoints are an injected `onCheckpoint` callback the
// route binds to the approval queue / an issue-thread interaction; the engine only
// needs the typed verdict. `changes_requested` at either gate stops the run and
// hands the partial back for revision (no silent override).

import { buildArchitecture, validateArchitecture } from "./architecture";
import { buildContentCalendar } from "./calendar";
import { clusterKeywords, type ClusterRefiner } from "./clustering";
import { COLLISION_PERSONAS, isCollisionVertical } from "./collision-vertical";
import { deterministicKeywordProvider, type KeywordProvider } from "./keyword-provider";
import type {
  CheckpointApproval,
  InventoryUrl,
  SerpCluster,
  ShopBrief,
  SitemapKeyword,
  SitemapPackage,
} from "./types";
import { shopBriefSchema } from "./types";

/* -------------------------------------------------------------------------- */
/* Seams                                                                      */
/* -------------------------------------------------------------------------- */

/** Stage 2: baseline audit → existing URLs flagged Keep/Improve. Greenfield ⇒ []. */
export type AuditProvider = (brief: ShopBrief) => Promise<InventoryUrl[]>;

/** Stage 3: competitor content-gap → extra keywords the competitors rank for. */
export type ContentGapProvider = (brief: ShopBrief) => Promise<SitemapKeyword[]>;

/** Checkpoint payloads handed to the human gate. */
export type ClusterCheckpointPayload = {
  phase: "clusters_page_types";
  clusters: SerpCluster[];
  inventory: InventoryUrl[];
};
export type PackageCheckpointPayload = {
  phase: "package_handoff";
  draft: SitemapPackage;
};
export type CheckpointPayload = ClusterCheckpointPayload | PackageCheckpointPayload;

/** The human gate. Route binds this to the approval queue / issue interaction. */
export type CheckpointHandler = (payload: CheckpointPayload) => Promise<CheckpointApproval>;

export type SitemapPipelineDeps = {
  /** ISO timestamp stamped on the package (injected for purity). */
  generatedAt: string;
  /** Stage 1. Defaults to the zero-cost deterministic provider. */
  keywordProvider?: KeywordProvider;
  /** Stage 2. Defaults to "no live site" (greenfield) ⇒ []. */
  auditProvider?: AuditProvider;
  /** Stage 3. Defaults to none. */
  contentGapProvider?: ContentGapProvider;
  /** Stage 4 optional LLM cluster refinement. */
  clusterRefiner?: ClusterRefiner;
  /** The two human checkpoints. REQUIRED — the spec mandates both gates. */
  onCheckpoint: CheckpointHandler;
  /** Content cadence (pages/month). Default 4. */
  pagesPerMonth?: number;
};

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

export type SitemapRunResult =
  | { status: "complete"; package: SitemapPackage }
  | {
      status: "changes_requested";
      phase: CheckpointApproval["phase"];
      approval: CheckpointApproval;
      /** The partial state at the gate, so the route can revise + re-run. */
      partial: Partial<SitemapPackage>;
    };

/* -------------------------------------------------------------------------- */
/* Persona matching (collision vertical)                                      */
/* -------------------------------------------------------------------------- */

/** Build a keyword→personaIds matcher from the 8 personas' search themes. */
function collisionPersonaMatcher(): (keyword: string) => string[] {
  // Pre-tokenize each persona's themes into significant tokens.
  const personaTokens = COLLISION_PERSONAS.map((p) => ({
    id: p.id,
    tokens: new Set(
      p.searchThemes
        .join(" ")
        .toLowerCase()
        .replace(/\{city\}/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 3),
    ),
  }));
  return (keyword: string) => {
    const kw = keyword.toLowerCase();
    const hits: string[] = [];
    for (const p of personaTokens) {
      for (const t of p.tokens) {
        if (kw.includes(t)) {
          hits.push(p.id);
          break;
        }
      }
    }
    return hits;
  };
}

/* -------------------------------------------------------------------------- */
/* runSitemapPipeline                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Run the full gated workflow for one shop brief. Returns `complete` with the
 * finished package (all four artifacts derive from `package.root`), or
 * `changes_requested` when a human gate sends it back.
 */
export async function runSitemapPipeline(
  briefInput: ShopBrief,
  deps: SitemapPipelineDeps,
): Promise<SitemapRunResult> {
  const brief = shopBriefSchema.parse(briefInput);
  const collision = isCollisionVertical(brief.vertical);

  // Stage 1 — keyword universe.
  const keywordProvider = deps.keywordProvider ?? deterministicKeywordProvider;
  const baseKeywords = await keywordProvider(brief);

  // Stage 2 — baseline audit + URL inventory (Keep/Improve).
  const inventory = deps.auditProvider ? await deps.auditProvider(brief) : [];

  // Stage 3 — competitor content-gap → extra keywords.
  const gapKeywords = deps.contentGapProvider ? await deps.contentGapProvider(brief) : [];

  // Merge keyword sources (dedupe by phrase, keep first/highest-signal source).
  const seen = new Set<string>();
  const keywords: SitemapKeyword[] = [];
  for (const k of [...baseKeywords, ...gapKeywords]) {
    const key = k.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(k);
  }

  // Stage 4 + 5 — cluster + validate page types.
  const cityTokens = new Set(
    brief.locations.flatMap((l) => l.city.toLowerCase().split(/\s+/)),
  );
  const clusters = await clusterKeywords(keywords, {
    cityTokens,
    personaMatch: collision ? collisionPersonaMatcher() : undefined,
    refine: deps.clusterRefiner,
  });

  // ── CHECKPOINT 1 — approve clusters + page types ──
  const cp1 = await deps.onCheckpoint({ phase: "clusters_page_types", clusters, inventory });
  if (cp1.decision !== "approved") {
    return { status: "changes_requested", phase: "clusters_page_types", approval: cp1, partial: { clusters, inventory } };
  }

  // Stage 6 — site architecture (single hierarchy source) + apply inventory dispositions.
  let root = buildArchitecture(brief, clusters);
  root = applyInventoryDispositions(root, inventory);
  const validation = validateArchitecture(root, brief);

  // Stage 7 — content calendar.
  const calendar = buildContentCalendar(root, { pagesPerMonth: deps.pagesPerMonth });

  const draft: SitemapPackage = {
    brief,
    generatedAt: deps.generatedAt,
    vertical: brief.vertical,
    root,
    clusters,
    calendar,
    validation,
    inventory,
    checkpoints: [cp1],
  };

  // ── CHECKPOINT 2 — approve package before client hand-off ──
  const cp2 = await deps.onCheckpoint({ phase: "package_handoff", draft });
  if (cp2.decision !== "approved") {
    return { status: "changes_requested", phase: "package_handoff", approval: cp2, partial: draft };
  }

  return { status: "complete", package: { ...draft, checkpoints: [cp1, cp2] } };
}

/* -------------------------------------------------------------------------- */
/* Inventory disposition mapping                                              */
/* -------------------------------------------------------------------------- */

/** Map a live URL path to a comparable slug path (drop scheme/host, trim slashes). */
function urlToPath(url: string): string {
  const noScheme = url.replace(/^https?:\/\/[^/]+/i, "");
  const trimmed = noScheme.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed.toLowerCase();
}

/**
 * Apply Keep/Improve flags from the URL inventory onto matching architecture pages.
 * A new page whose full slug path matches an existing URL inherits that URL's
 * disposition (so the deliverable shows what carries forward vs. gets rebuilt).
 * Pure: returns a new tree, never mutates the input.
 */
export function applyInventoryDispositions(root: SitemapPackage["root"], inventory: InventoryUrl[]): SitemapPackage["root"] {
  if (inventory.length === 0) return root;
  const byPath = new Map(inventory.map((u) => [urlToPath(u.url), u.disposition]));

  const rewrite = (node: SitemapPackage["root"], parentPath: string | null): SitemapPackage["root"] => {
    const path =
      parentPath === null ? "/" : parentPath === "/" ? `/${node.slug}` : `${parentPath}/${node.slug}`;
    const disposition = byPath.get(path.toLowerCase()) ?? node.disposition;
    return { ...node, disposition, children: node.children.map((c) => rewrite(c, path)) };
  };
  return rewrite(root, null);
}
