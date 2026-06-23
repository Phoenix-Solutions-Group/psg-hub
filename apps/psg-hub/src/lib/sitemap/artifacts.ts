// Wave 1A / PSG-225 — The four client-ready artifacts.
//
// Every artifact derives from ONE SitemapPackage (whose `root` PageNode tree is the
// single hierarchy source). `page-inventory.csv` and `sitemap.mmd` come from the
// same flattened walk (./architecture.ts), so they are drift-free by construction.
// `content-calendar.md` renders the calendar; `summary.md` is the human cover note.
//
// Pure: string in, strings out. No I/O — the route writes the bytes / uploads them.

import { personaById } from "./collision-vertical";
import {
  PAGE_INVENTORY_COLUMNS,
  toMermaid,
  toPageInventoryRows,
} from "./architecture";
import type { ContentCalendar, SitemapPackage } from "./types";

/* -------------------------------------------------------------------------- */
/* CSV (RFC-4180, CRLF — matches lib/ops/reports/export.ts)                   */
/* -------------------------------------------------------------------------- */

function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
  return field;
}

/** `page-inventory.csv` — one row per page, derived from the hierarchy. */
export function toPageInventoryCsv(pkg: SitemapPackage): string {
  const rows = toPageInventoryRows(pkg.root);
  const lines: string[] = [];
  lines.push(PAGE_INVENTORY_COLUMNS.map((c) => csvEscape(c)).join(","));
  for (const row of rows) {
    lines.push(PAGE_INVENTORY_COLUMNS.map((c) => csvEscape(row[c])).join(","));
  }
  return lines.join("\r\n");
}

/* -------------------------------------------------------------------------- */
/* sitemap.mmd                                                                */
/* -------------------------------------------------------------------------- */

/** `sitemap.mmd` — Mermaid `graph TD`, derived from the same flatten as the CSV. */
export function toSitemapMermaid(pkg: SitemapPackage): string {
  return toMermaid(pkg.root);
}

/* -------------------------------------------------------------------------- */
/* content-calendar.md                                                        */
/* -------------------------------------------------------------------------- */

function personaNames(ids: string[]): string {
  const names = ids.map((id) => personaById(id)?.name ?? id);
  return names.length ? names.join(", ") : "—";
}

/** `content-calendar.md` — month-grouped production plan as a Markdown table. */
export function toContentCalendarMarkdown(calendar: ContentCalendar): string {
  const lines: string[] = [];
  lines.push("# Content Calendar");
  lines.push("");
  lines.push(`Cadence: **${calendar.pagesPerMonth} pages/month**.`);
  lines.push("");

  const byMonth = new Map<number, ContentCalendar["entries"]>();
  for (const e of calendar.entries) {
    const list = byMonth.get(e.month) ?? [];
    list.push(e);
    byMonth.set(e.month, list);
  }

  for (const month of [...byMonth.keys()].sort((a, b) => a - b)) {
    lines.push(`## Month ${month}`);
    lines.push("");
    lines.push("| Page | Type | Status | Primary keyword | Personas |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const e of byMonth.get(month)!) {
      lines.push(
        `| ${e.title} (\`${e.pagePath}\`) | ${e.pageType} | ${e.disposition} | ${e.primaryKeyword || "—"} | ${personaNames(e.personaIds)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/* -------------------------------------------------------------------------- */
/* summary.md                                                                 */
/* -------------------------------------------------------------------------- */

/** `summary.md` — the client-facing cover note: scope, structure, checkpoints, gaps. */
export function toSummaryMarkdown(pkg: SitemapPackage): string {
  const rows = toPageInventoryRows(pkg.root);
  const pageCount = rows.length;
  const newCount = rows.filter((r) => r.disposition === "new").length;
  const improveCount = rows.filter((r) => r.disposition === "improve").length;
  const keepCount = rows.filter((r) => r.disposition === "keep").length;
  const maxDepth = rows.reduce((m, r) => Math.max(m, Number(r.depth)), 0);

  const lines: string[] = [];
  lines.push(`# Sitemap & Content Plan — ${pkg.brief.businessName}`);
  lines.push("");
  lines.push(`_Generated ${pkg.generatedAt}._`);
  lines.push("");
  lines.push("## Scope");
  lines.push("");
  lines.push(`- **Site:** ${pkg.brief.domain ? pkg.brief.domain : "Greenfield (new build)"}`);
  lines.push(`- **Vertical:** ${pkg.vertical === "collision_repair" ? "Collision repair / auto body" : "General"}`);
  lines.push(`- **Services covered:** ${pkg.brief.services.length || "—"}`);
  lines.push(`- **Service-area locations:** ${pkg.brief.locations.length}`);
  lines.push("");
  lines.push("## Proposed structure");
  lines.push("");
  lines.push(`- **${pageCount} pages** total — ${newCount} new, ${improveCount} to improve, ${keepCount} kept.`);
  lines.push(`- **${pkg.clusters.length} SERP clusters** drove page planning.`);
  lines.push(`- **Max depth ${maxDepth} clicks** from the home page (3-click rule: ${maxDepth <= 3 ? "PASS" : "VIOLATION"}).`);
  lines.push("");

  // Quality gate readout.
  lines.push("## Quality checks");
  lines.push("");
  const v = pkg.validation;
  lines.push(`- 3-click rule: ${v.threeClickViolations.length === 0 ? "✅ pass" : `❌ ${v.threeClickViolations.length} too deep`}`);
  lines.push(`- Unique URLs: ${v.duplicateSlugPaths.length === 0 ? "✅ no duplicates" : `❌ ${v.duplicateSlugPaths.length} duplicate path(s)`}`);
  lines.push(`- Internal links: ${v.brokenInternalLinks.length === 0 ? "✅ all resolve" : `❌ ${v.brokenInternalLinks.length} broken`}`);
  if (pkg.vertical === "collision_repair") {
    lines.push(
      `- Collision required-page coverage: ${v.coverageGaps.length === 0 ? "✅ complete (8-persona)" : `❌ ${v.coverageGaps.length} gap(s): ${v.coverageGaps.map((g) => g.title).join(", ")}`}`,
    );
  }
  lines.push("");

  // Checkpoint audit trail.
  lines.push("## Approvals");
  lines.push("");
  if (pkg.checkpoints.length === 0) {
    lines.push("- _No checkpoint approvals recorded._");
  } else {
    for (const c of pkg.checkpoints) {
      const phase = c.phase === "clusters_page_types" ? "Clusters & page types" : "Package hand-off";
      lines.push(`- **${phase}:** ${c.decision} by ${c.approvedBy} (${c.approvedAt})${c.notes ? ` — ${c.notes}` : ""}`);
    }
  }
  lines.push("");
  lines.push("## Deliverables");
  lines.push("");
  lines.push("- `page-inventory.csv` — every page, type, intent, keywords, internal links.");
  lines.push("- `sitemap.mmd` — Mermaid diagram of the hierarchy.");
  lines.push("- `content-calendar.md` — month-by-month production plan.");
  lines.push("- `summary.md` — this document.");
  lines.push("");
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* All four at once                                                           */
/* -------------------------------------------------------------------------- */

export type SitemapArtifacts = {
  pageInventoryCsv: string;
  sitemapMmd: string;
  contentCalendarMd: string;
  summaryMd: string;
};

/** Render all four artifacts from one package. */
export function buildArtifacts(pkg: SitemapPackage): SitemapArtifacts {
  return {
    pageInventoryCsv: toPageInventoryCsv(pkg),
    sitemapMmd: toSitemapMermaid(pkg),
    contentCalendarMd: toContentCalendarMarkdown(pkg.calendar),
    summaryMd: toSummaryMarkdown(pkg),
  };
}
