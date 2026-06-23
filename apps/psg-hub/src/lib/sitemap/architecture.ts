// Wave 1A / PSG-225 — Site architecture: the single hierarchy source + derivations.
//
// This module owns the spec's load-bearing guarantee: `page-inventory.csv` and the
// Mermaid `sitemap.mmd` are TWO SERIALIZATIONS OF ONE STRUCTURE — the PageNode tree
// rooted at home. `flattenHierarchy` produces the canonical ordered node list ONCE;
// `toPageInventoryRows` and `toMermaid` each consume exactly that list. They cannot
// drift because there is no second source to drift from (spec: "single hierarchy
// source → no drift").
//
// Pure: no I/O. `buildArchitecture` assembles the tree from validated clusters plus
// (for the collision vertical) the required-page coverage; `validateArchitecture`
// enforces the 3-click rule, unique slug paths, internal-link integrity and required
// coverage.

import {
  COLLISION_REQUIRED_PAGES,
  isCollisionVertical,
  personaById,
  type RequiredPage,
} from "./collision-vertical";
import type {
  ArchitectureValidation,
  CoverageGap,
  PageNode,
  SerpCluster,
  ShopBrief,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Slug helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Lowercase, hyphenated, ascii slug. Deterministic (no randomness). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/* -------------------------------------------------------------------------- */
/* Flatten — the ONE canonical walk both artifacts consume                    */
/* -------------------------------------------------------------------------- */

export type FlatPage = {
  node: PageNode;
  /** Depth from home: home = 0. */
  depth: number;
  /** Full URL path, e.g. "/services/frame-straightening" ("/" for home). */
  path: string;
  /** Parent node id, or null for home. */
  parentId: string | null;
  parentPath: string | null;
};

/**
 * Depth-first pre-order flatten. The home root is depth 0 with path "/". Every other
 * node's path is parentPath + "/" + slug. THIS is the single ordered list that both
 * the CSV and the Mermaid tree are built from.
 */
export function flattenHierarchy(root: PageNode): FlatPage[] {
  const out: FlatPage[] = [];
  const walk = (node: PageNode, depth: number, parentPath: string | null, parentId: string | null) => {
    const path =
      parentPath === null
        ? "/"
        : parentPath === "/"
          ? `/${node.slug}`
          : `${parentPath}/${node.slug}`;
    out.push({ node, depth, path, parentId, parentPath });
    for (const child of node.children) walk(child, depth + 1, path, node.id);
  };
  walk(root, 0, null, null);
  return out;
}

/* -------------------------------------------------------------------------- */
/* page-inventory.csv rows (RFC-4180, derived from flatten)                   */
/* -------------------------------------------------------------------------- */

/** Stable CSV column order. Exported so tests + the Mermaid side stay in lockstep. */
export const PAGE_INVENTORY_COLUMNS = [
  "path",
  "title",
  "page_type",
  "intent",
  "disposition",
  "depth",
  "parent_path",
  "primary_keyword",
  "target_keywords",
  "personas",
  "internal_links",
  "cluster_id",
] as const;

export type PageInventoryRow = Record<(typeof PAGE_INVENTORY_COLUMNS)[number], string>;

export function toPageInventoryRows(root: PageNode): PageInventoryRow[] {
  return flattenHierarchy(root).map(({ node, depth, path, parentPath }) => ({
    path,
    title: node.title,
    page_type: node.pageType,
    intent: node.intent,
    disposition: node.disposition,
    depth: String(depth),
    parent_path: parentPath ?? "",
    primary_keyword: node.targetKeywords[0] ?? "",
    target_keywords: node.targetKeywords.join("; "),
    personas: node.personaIds.join("; "),
    internal_links: node.internalLinks.join("; "),
    cluster_id: node.clusterId ?? "",
  }));
}

/* -------------------------------------------------------------------------- */
/* Build the architecture                                                     */
/* -------------------------------------------------------------------------- */

export type BuildArchitectureOptions = {
  /** Map a service title → its top-level grouping. Default groups all services
   *  under a /services hub so depth stays ≤ 3. */
  servicesHubTitle?: string;
};

/** Make a leaf PageNode. Centralizes defaults so every node is well-formed. */
function makeNode(args: {
  title: string;
  slug: string;
  pageType: PageNode["pageType"];
  intent: PageNode["intent"];
  disposition: PageNode["disposition"];
  targetKeywords?: string[];
  clusterId?: string | null;
  personaIds?: string[];
  internalLinks?: string[];
  children?: PageNode[];
  idPrefix?: string;
}): PageNode {
  return {
    id: args.idPrefix ? `${args.idPrefix}-${args.slug}` : args.slug || "home",
    title: args.title,
    slug: args.slug,
    pageType: args.pageType,
    intent: args.intent,
    disposition: args.disposition,
    targetKeywords: args.targetKeywords ?? [],
    clusterId: args.clusterId ?? null,
    personaIds: args.personaIds ?? [],
    internalLinks: args.internalLinks ?? [],
    children: args.children ?? [],
  };
}

/**
 * Assemble the hierarchy from approved clusters + the brief.
 *
 * Structure (keeps everything ≤ 3 clicks from home):
 *   home
 *   ├─ /services            (hub)
 *   │   ├─ /services/<service-cluster>      (depth 2)
 *   ├─ /service-areas       (hub, if locations)
 *   │   ├─ /service-areas/<city-state>      (depth 2)
 *   ├─ /resources           (hub, if any resource clusters)
 *   │   ├─ /resources/<resource>            (depth 2)
 *   ├─ /<landing/gallery/reviews/about/contact/blog>   (top level, depth 1)
 *   └─ /blog/<post>                         (depth 2, blog posts)
 *
 * For the collision vertical, COLLISION_REQUIRED_PAGES are merged in first (so the
 * spine is always complete) and clusters enrich matching pages by key; extra
 * clusters become additional pages under the right hub.
 */
export function buildArchitecture(
  brief: ShopBrief,
  clusters: SerpCluster[],
  opts: BuildArchitectureOptions = {},
): PageNode {
  const collision = isCollisionVertical(brief.vertical);

  const servicesChildren: PageNode[] = [];
  const resourcesChildren: PageNode[] = [];
  const topChildren: PageNode[] = [];
  const usedClusterIds = new Set<string>();

  // 1) Collision required-page spine (vertical only). Each required page is built
  //    from its seed keywords, then any cluster whose keywords OVERLAP that page's
  //    topic is FOLDED IN (keywords merged, personas added) rather than spawning a
  //    near-duplicate page. This keeps the client deliverable tight: e.g. a generic
  //    "collision repair" cluster enriches the Collision Repair page instead of
  //    creating a second one. Only genuinely-novel clusters survive to step 2.
  if (collision) {
    // Build required nodes + a topic-token index for overlap matching.
    const reqNodes: ReqNodeEntry[] = COLLISION_REQUIRED_PAGES.map((req) => {
      const node = nodeFromRequired(req, undefined);
      // Fold-in signals include the search themes of the personas this page serves, so
      // persona-derived clusters land on the right page instead of becoming junk pages.
      const personaThemes = req.personaIds.flatMap((id) => personaById(id)?.searchThemes ?? []);
      const matchStrings = [req.title, req.key, ...req.seedKeywords, ...personaThemes];
      return {
        req,
        node,
        tokens: topicTokens(matchStrings, 3),
        phrases: [req.title, ...req.seedKeywords, ...personaThemes].map(normPhrase),
      };
    });

    for (const c of clusters) {
      const best = bestRequiredMatch(c, reqNodes);
      if (!best) continue;
      usedClusterIds.add(c.id);
      // Merge cluster keywords (dedupe, keep order) + personas into the required page.
      const merged = new Set(best.node.targetKeywords);
      for (const k of c.keywords) merged.add(k.keyword);
      best.node.targetKeywords = [...merged];
      best.node.personaIds = [...new Set([...best.node.personaIds, ...c.personaIds])];
      if (best.node.clusterId === null) best.node.clusterId = c.id;
    }

    for (const { req, node } of reqNodes) {
      if (req.group === "services") servicesChildren.push(node);
      else if (req.group === "resources") resourcesChildren.push(node);
      else topChildren.push(node);
    }
  }

  // 2) Clusters not already consumed by the spine become pages, routed by pageType.
  //    QUALITY GATE (PSG-259 CR-1): a cluster only earns a standalone CLIENT page when
  //    it has a real page identity — at least one substantive topical token. A cluster
  //    whose keywords are all head terms / stopwords (e.g. "body shop near me" stemming
  //    to a bare "Body" page) is keyword-clustering noise, not a page a shop owner would
  //    recognize; it is NOT promoted. Its keywords remain in `pkg.clusters` (the raw
  //    source artifact) and it has already had its chance to fold into the spine above.
  //    Titles are humanized for the client surface (internal "(intent)" suffix stripped,
  //    acronyms cased) so machine labels like "Pdr (service)" never reach the deliverable.
  for (const c of clusters) {
    if (usedClusterIds.has(c.id)) continue;
    if (!hasRealPageIdentity(c.keywords.map((k) => k.keyword))) continue;
    const title = humanizeClusterTitle(c.label);
    const node = makeNode({
      title,
      slug: slugify(title),
      pageType: c.pageType,
      intent: c.intent,
      disposition: "new",
      targetKeywords: c.keywords.map((k) => k.keyword),
      clusterId: c.id,
      personaIds: c.personaIds,
    });
    if (c.pageType === "service") servicesChildren.push(node);
    else if (c.pageType === "resource") resourcesChildren.push(node);
    else if (c.pageType === "blog_post") {
      /* attached under blog index below */ topChildren.push({ ...node, slug: `blog/${node.slug}` });
    } else topChildren.push(node);
  }

  // 3) Service-area (city) pages from the brief.
  const serviceAreaChildren: PageNode[] = brief.locations.map((loc) =>
    makeNode({
      title: `${loc.city}, ${loc.state}`,
      slug: slugify(`${loc.city}-${loc.state}`),
      pageType: "service_area",
      intent: "local",
      disposition: "new",
      targetKeywords: [`auto body ${loc.city.toLowerCase()}`, `collision repair ${loc.city.toLowerCase()}`],
      personaIds: collision ? ["convenience_local"] : [],
      idPrefix: "area",
    }),
  );

  // Assemble hubs (only when they have children).
  const children: PageNode[] = [];
  if (servicesChildren.length > 0) {
    children.push(
      makeNode({
        title: opts.servicesHubTitle ?? "Services",
        slug: "services",
        pageType: "service",
        intent: "service",
        disposition: "new",
        children: dedupeBySlug(servicesChildren),
      }),
    );
  }
  if (serviceAreaChildren.length > 0) {
    children.push(
      makeNode({
        title: "Service Areas",
        slug: "service-areas",
        pageType: "service_area",
        intent: "local",
        disposition: "new",
        children: dedupeBySlug(serviceAreaChildren),
      }),
    );
  }
  if (resourcesChildren.length > 0) {
    children.push(
      makeNode({
        title: "Resources",
        slug: "resources",
        pageType: "resource",
        intent: "informational",
        disposition: "new",
        children: dedupeBySlug(resourcesChildren),
      }),
    );
  }
  // Top-level pages (landing/gallery/reviews/about/contact/blog and stray clusters).
  // Blog posts (slug "blog/...") nest under the blog index if present.
  const { blogIndex, blogPosts, others } = partitionTop(dedupeBySlug(topChildren));
  for (const o of others) children.push(o);
  if (blogIndex) {
    children.push({ ...blogIndex, children: dedupeBySlug([...blogIndex.children, ...blogPosts.map(stripBlogPrefix)]) });
  } else if (blogPosts.length > 0) {
    // No explicit blog index — synthesize one so posts stay ≤ 3 clicks.
    children.push(
      makeNode({
        title: "Blog",
        slug: "blog",
        pageType: "blog_index",
        intent: "informational",
        disposition: "new",
        children: blogPosts.map(stripBlogPrefix),
      }),
    );
  }

  return makeNode({
    title: brief.businessName,
    slug: "",
    pageType: "home",
    intent: "transactional",
    disposition: brief.domain ? "improve" : "new",
    children,
  });
}

/** Stopwords stripped before topical-token comparison (generic auto-body filler). */
const TOPIC_STOPWORDS = new Set(["near", "best", "your", "auto", "body", "shop", "repair", "service", "services"]);

/** Topical tokens (deduped) at the given min length, stopwords removed. */
function topicTokens(strings: string[], minLen: number): Set<string> {
  const out = new Set<string>();
  for (const s of strings) {
    for (const t of s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
      if (t.length >= minLen && !TOPIC_STOPWORDS.has(t)) out.add(t);
    }
  }
  return out;
}

/** Normalize a phrase for whole-phrase containment matching. */
function normPhrase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A cluster has a "real page identity" (PSG-259 CR-1) when its keywords carry at least
 * one substantive topical token (≥4 chars, not a generic auto-body stopword). Clusters
 * that reduce to only head terms ("body shop near me", "our shop") produce indefensible
 * bare page titles and are NOT promoted to standalone client pages.
 */
function hasRealPageIdentity(keywords: string[]): boolean {
  return topicTokens(keywords, 4).size > 0;
}

/** Known acronyms restored to correct casing in client-facing titles. */
const TITLE_ACRONYMS = new Map<string, string>([
  ["pdr", "PDR"],
  ["ev", "EV"],
  ["oem", "OEM"],
  ["adas", "ADAS"],
  ["suv", "SUV"],
  ["icar", "I-CAR"],
]);

/**
 * Turn an internal cluster label into a client-facing page title (PSG-259 CR-2):
 * strip the internal "(intent)" annotation and restore acronym casing. Defensive twin
 * of the renderer's display cleanup — fixing it here keeps the CSV/Mermaid artifacts
 * clean at the single hierarchy source, not just the rendered HTML.
 */
export function humanizeClusterTitle(label: string): string {
  const base = label
    .replace(/\s*\((?:service|local|transactional|informational|emergency)\)\s*$/i, "")
    .trim();
  const cased = base
    .split(/\s+/)
    .map((w) => TITLE_ACRONYMS.get(w.toLowerCase()) ?? w)
    .join(" ")
    .trim();
  return cased || base || label;
}

type ReqNodeEntry = { req: RequiredPage; node: PageNode; tokens: Set<string>; phrases: string[] };

/**
 * Pick the required page a cluster should fold into, or null if it's genuinely novel.
 * Two signals (PSG-259 CR-1 — stop near-duplicate spine pages and persona-fragment
 * pages from surviving):
 *   • token overlap — cluster topical tokens (≥3 chars) vs the page's tokens, which
 *     include the page's seed keywords AND the search themes of the personas it serves
 *     (so "I-CAR gold class" folds into Certifications, "fast turnaround auto body" into
 *     Fleet Services), and
 *   • phrase containment — a cluster keyword that equals, or contains, one of the page's
 *     seed phrases/themes (so all-stopword phrases like "auto body repair" → Collision
 *     Repair and the bare "PDR" acronym → Paintless Dent Repair still fold in).
 * Highest combined score wins; a zero score means the cluster surfaces on its own.
 */
function bestRequiredMatch(cluster: SerpCluster, reqNodes: ReqNodeEntry[]): ReqNodeEntry | null {
  const clusterTokens = topicTokens(cluster.keywords.map((k) => k.keyword), 3);
  const clusterPhrases = cluster.keywords.map((k) => normPhrase(k.keyword));
  let best: ReqNodeEntry | null = null;
  let bestScore = 0;
  for (const entry of reqNodes) {
    let score = 0;
    for (const t of clusterTokens) if (entry.tokens.has(t)) score += 1;
    for (const cp of clusterPhrases) {
      for (const rp of entry.phrases) {
        if (cp === rp) score += 3;
        else if (rp.includes(" ") && rp.length >= 6 && cp.includes(rp)) score += 3;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore > 0 ? best : null;
}

function nodeFromRequired(req: RequiredPage, cluster: SerpCluster | undefined): PageNode {
  const kws = cluster ? cluster.keywords.map((k) => k.keyword) : req.seedKeywords;
  return makeNode({
    title: req.title,
    slug: req.key,
    pageType: req.pageType,
    intent: cluster?.intent ?? defaultIntentForPageType(req.pageType),
    disposition: "new",
    targetKeywords: kws,
    clusterId: cluster?.id ?? null,
    personaIds: req.personaIds,
  });
}

function defaultIntentForPageType(pt: PageNode["pageType"]): PageNode["intent"] {
  switch (pt) {
    case "service":
      return "service";
    case "service_area":
      return "local";
    case "landing":
      return "transactional";
    case "resource":
    case "blog_index":
    case "blog_post":
    case "faq":
      return "informational";
    default:
      return "local";
  }
}

function dedupeBySlug(nodes: PageNode[]): PageNode[] {
  const seen = new Set<string>();
  const out: PageNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.slug)) continue;
    seen.add(n.slug);
    out.push(n);
  }
  return out;
}

function partitionTop(nodes: PageNode[]): {
  blogIndex: PageNode | null;
  blogPosts: PageNode[];
  others: PageNode[];
} {
  let blogIndex: PageNode | null = null;
  const blogPosts: PageNode[] = [];
  const others: PageNode[] = [];
  for (const n of nodes) {
    if (n.pageType === "blog_index") blogIndex = n;
    else if (n.slug.startsWith("blog/")) blogPosts.push(n);
    else others.push(n);
  }
  return { blogIndex, blogPosts, others };
}

function stripBlogPrefix(n: PageNode): PageNode {
  return n.slug.startsWith("blog/") ? { ...n, slug: n.slug.slice("blog/".length) } : n;
}

/* -------------------------------------------------------------------------- */
/* Validation — 3-click rule, slugs, links, coverage                          */
/* -------------------------------------------------------------------------- */

/** Max depth from home. Home(0) → category(1) → subcategory(2) → page(3). */
export const MAX_CLICK_DEPTH = 3;

export function validateArchitecture(root: PageNode, brief: ShopBrief): ArchitectureValidation {
  const flat = flattenHierarchy(root);

  const threeClickViolations = flat
    .filter((f) => f.depth > MAX_CLICK_DEPTH)
    .map((f) => f.path);

  // Duplicate full slug paths.
  const pathCounts = new Map<string, number>();
  for (const f of flat) pathCounts.set(f.path, (pathCounts.get(f.path) ?? 0) + 1);
  const duplicateSlugPaths = [...pathCounts.entries()].filter(([, n]) => n > 1).map(([p]) => p);

  // Internal-link integrity: every internalLinks id must resolve to a real node id.
  const ids = new Set(flat.map((f) => f.node.id));
  const brokenInternalLinks: string[] = [];
  for (const f of flat) {
    for (const link of f.node.internalLinks) {
      if (!ids.has(link)) brokenInternalLinks.push(`${f.node.id} -> ${link}`);
    }
  }

  // Required-coverage check (collision vertical only).
  const coverageGaps: CoverageGap[] = [];
  if (isCollisionVertical(brief.vertical)) {
    const slugs = new Set(flat.map((f) => f.node.slug));
    for (const req of COLLISION_REQUIRED_PAGES) {
      if (!slugs.has(req.key)) {
        coverageGaps.push({ requiredKey: req.key, title: req.title, pageType: req.pageType });
      }
    }
  }

  const ok =
    threeClickViolations.length === 0 &&
    duplicateSlugPaths.length === 0 &&
    brokenInternalLinks.length === 0 &&
    coverageGaps.length === 0;

  return { threeClickViolations, duplicateSlugPaths, brokenInternalLinks, coverageGaps, ok };
}

/* -------------------------------------------------------------------------- */
/* Mermaid — derived from the SAME flatten as the CSV                          */
/* -------------------------------------------------------------------------- */

/** Mermaid-safe node id (alnum + underscore). Derived from the page id. */
function mermaidId(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(safe) ? safe : `n_${safe}`;
}

/** Escape a Mermaid node label (quotes wrap it; escape embedded quotes). */
function mermaidLabel(node: PageNode): string {
  const tag = node.disposition === "keep" ? " (keep)" : node.disposition === "improve" ? " (improve)" : "";
  return `${node.title}${tag}`.replace(/"/g, "&quot;").replace(/\n/g, " ");
}

/**
 * Render the hierarchy as a Mermaid `graph TD`. ONE declaration per flattened node
 * + one edge per parent→child — so the node count equals the CSV row count by
 * construction (asserted in tests). No second traversal, no second source.
 */
export function toMermaid(root: PageNode): string {
  const flat = flattenHierarchy(root);
  const lines: string[] = ["graph TD"];
  for (const f of flat) {
    lines.push(`  ${mermaidId(f.node.id)}["${mermaidLabel(f.node)}"]`);
  }
  for (const f of flat) {
    if (f.parentId !== null) {
      lines.push(`  ${mermaidId(f.parentId)} --> ${mermaidId(f.node.id)}`);
    }
  }
  return lines.join("\n");
}
