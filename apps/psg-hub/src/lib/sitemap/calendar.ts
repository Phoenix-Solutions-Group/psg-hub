// Wave 1A / PSG-225 — Content calendar derivation (spec: seo-plan).
//
// Turns the finished hierarchy into a month-by-month production plan. Derived from
// the SAME PageNode tree as the CSV/Mermaid (via flattenHierarchy), so the calendar
// can never reference a page that isn't in the sitemap. Ordering: highest-priority
// money pages first; existing "improve" pages are sequenced ahead of brand-new ones
// at equal priority (faster wins on pages already indexed). Structural hub pages
// (home, /services, /service-areas, /resources, blog index) are excluded — the plan
// is about content production, not the nav skeleton.
//
// Pure: no I/O, no clock. Cadence (`pagesPerMonth`) is injected.

import { flattenHierarchy } from "./architecture";
import type {
  ContentCalendar,
  ContentCalendarEntry,
  PageDisposition,
  PageNode,
  PageType,
} from "./types";

/** Hub / structural page types that are NOT content-production line items. */
const STRUCTURAL_PAGE_TYPES: ReadonlySet<PageType> = new Set<PageType>(["home", "blog_index"]);

/** Slugs of synthesized hub pages (no keywords, pure structure) to skip. */
const STRUCTURAL_SLUGS: ReadonlySet<string> = new Set(["services", "service-areas", "resources"]);

/** Disposition ordering weight: improve existing pages first (quick wins). */
const DISPOSITION_WEIGHT: Record<PageDisposition, number> = { improve: 2, keep: 1, new: 0 };

export type BuildCalendarOptions = {
  /** Pages produced per month. Default 4 (weekly cadence). */
  pagesPerMonth?: number;
};

/**
 * Build the content calendar from the hierarchy. Pages are scored, sorted
 * (priority desc, then improve-before-new, then path for stability) and packed into
 * months at the given cadence. A page's priority comes from its first cluster
 * keyword set length as a proxy when no explicit score exists — but most pages carry
 * the cluster priority via targetKeywords; we rank by (#keywords, disposition).
 */
export function buildContentCalendar(root: PageNode, opts: BuildCalendarOptions = {}): ContentCalendar {
  const pagesPerMonth = opts.pagesPerMonth ?? 4;

  const candidates = flattenHierarchy(root).filter(
    ({ node }) => !STRUCTURAL_PAGE_TYPES.has(node.pageType) && !STRUCTURAL_SLUGS.has(node.slug),
  );

  const ranked = candidates
    .map(({ node, path }) => {
      // Priority proxy 0–100: more target keywords ⇒ more demand to satisfy.
      const kwScore = Math.min(100, node.targetKeywords.length * 20);
      return { node, path, priority: kwScore };
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        DISPOSITION_WEIGHT[b.node.disposition] - DISPOSITION_WEIGHT[a.node.disposition] ||
        a.path.localeCompare(b.path),
    );

  const entries: ContentCalendarEntry[] = ranked.map((r, idx) => ({
    month: Math.floor(idx / pagesPerMonth) + 1,
    pagePath: r.path,
    title: r.node.title,
    pageType: r.node.pageType,
    disposition: r.node.disposition,
    primaryKeyword: r.node.targetKeywords[0] ?? "",
    personaIds: r.node.personaIds,
    priority: r.priority,
  }));

  return { pagesPerMonth, entries };
}
