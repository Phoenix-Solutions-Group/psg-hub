// Wave 1A / PSG-236 — Client-facing rendered deliverable.
//
// PURE: renderSitemapDeliverable(pkg) -> ONE self-contained branded HTML string. No IO,
// no clock, no React. Mirrors lib/intel/report/render.ts (the competitor report): the
// /ops/sitemap route returns this verbatim for browser preview, and the controlled-host
// Chromium worker can page.setContent() + page.pdf() over it for the PDF deliverable.
//
// GROUNDING: every visible value comes from the already-built SitemapPackage (whose `root`
// PageNode tree is the single hierarchy source — see artifacts.ts). The renderer invents
// nothing. The sitemap diagram is the SAME Mermaid that artifacts.ts emits, rendered in
// the browser via the mermaid CDN script; the CSV/Markdown source artifacts stay the raw
// hand-off, this is the branded surface on top of them.
//
// This is the surface the Creative Director (Lee) reviews for visual quality (PSG-225's
// designer requirement). Brand tokens mirror the house report renderer for consistency.

import { toMermaid, toPageInventoryRows } from "./architecture";
import { personaById } from "./collision-vertical";
import type { ContentCalendar, PageDisposition, SitemapPackage } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DISPOSITION_LABEL: Record<PageDisposition, string> = {
  new: "New",
  keep: "Keep",
  improve: "Improve",
};

function dispositionClass(d: PageDisposition): string {
  return `pill pill-${d}`;
}

function dateLabel(iso: string): string {
  // Locale-independent YYYY-MM-DD (purity over Intl), matching the house renderer.
  return iso.slice(0, 10);
}

/** Cap the personas shown on the client surface (PSG-259 CR-3): a wall of all 8 buyer
 *  names on every row carries no signal. Show the 1–2 primary personas + "+N more"; the
 *  full mapping stays in the source artifact (page-inventory.csv / calendar). */
function personaNames(ids: string[], max = 2): string {
  if (ids.length === 0) return "—";
  const names = ids.map((id) => personaById(id)?.name ?? id);
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max} more`;
}

/** Shop-owner-facing "goal" for a page's search intent (PSG-259 CR-4): the raw intent
 *  vocabulary (service/local/transactional) is internal and reads as a near-duplicate of
 *  the Type column. The raw intent stays in the CSV export. */
function intentGoal(intent: string): string {
  switch (intent) {
    case "transactional":
    case "emergency":
      return "Convert";
    case "informational":
      return "Inform";
    case "service":
    case "local":
    default:
      return "Book";
  }
}

/** Strip any internal "(intent)" annotation that reached a title (PSG-259 CR-2). The
 *  engine humanizes cluster titles at the source now; this is a defensive twin so the
 *  rendered surface is clean even for the general flow or a future engine regression. */
function displayTitle(title: string): string {
  return title.replace(/\s*\((?:service|local|transactional|informational|emergency)\)\s*$/i, "").trim() || title;
}

/** Cap a "; "-joined keyword list to the primary terms for the client table
 *  (PSG-259 CR-5/CR-6): the full set stays in the CSV; an empty set renders "—". */
function keywordCell(joined: string, max = 6): string {
  const terms = joined.split(";").map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return "—";
  const shown = terms.slice(0, max).join("; ");
  return terms.length > max ? `${shown}; +${terms.length - max} more` : shown;
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

function renderKpis(pkg: SitemapPackage): string {
  const rows = toPageInventoryRows(pkg.root);
  const newCount = rows.filter((r) => r.disposition === "new").length;
  const improveCount = rows.filter((r) => r.disposition === "improve").length;
  const keepCount = rows.filter((r) => r.disposition === "keep").length;
  const maxDepth = rows.reduce((m, r) => Math.max(m, Number(r.depth)), 0);
  const cards = [
    { n: String(rows.length), l: "Pages planned" },
    { n: String(pkg.clusters.length), l: "SERP clusters" },
    { n: `${newCount}/${improveCount}/${keepCount}`, l: "New / Improve / Keep" },
    { n: `${maxDepth}`, l: "Max click depth" },
  ];
  return (
    `<div class="kpis">` +
    cards.map((c) => `<div class="kpi"><div class="n">${escapeHtml(c.n)}</div><div class="l">${escapeHtml(c.l)}</div></div>`).join("") +
    `</div>`
  );
}

function renderScope(pkg: SitemapPackage): string {
  const b = pkg.brief;
  const items: [string, string][] = [
    ["Site", b.domain ? b.domain : "Greenfield (new build)"],
    ["Vertical", pkg.vertical === "collision_repair" ? "Collision repair / auto body" : "General"],
    ["Services covered", String(b.services.length || "—")],
    ["Service-area locations", String(b.locations.length)],
  ];
  return (
    `<dl class="scope">` +
    items.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("") +
    `</dl>`
  );
}

function renderSitemapDiagram(pkg: SitemapPackage): string {
  // The exact Mermaid artifacts.ts emits; the browser/Chromium renders it via the CDN script.
  const mmd = toMermaid(pkg.root);
  return (
    `<section class="block"><h2>Proposed sitemap</h2>` +
    `<div class="diagram"><pre class="mermaid">${escapeHtml(mmd)}</pre></div>` +
    `<p class="caption">Single hierarchy source — the page inventory below and this diagram derive from one tree and cannot drift.</p>` +
    `</section>`
  );
}

function renderInventory(pkg: SitemapPackage): string {
  const rows = toPageInventoryRows(pkg.root);
  const body = rows
    .map((r) => {
      const indent = "&nbsp;".repeat(Math.max(0, (Number(r.depth) - 0) * 2));
      const disp = r.disposition as PageDisposition;
      return (
        `<tr>` +
        `<td>${indent}${escapeHtml(displayTitle(r.title))}</td>` +
        `<td class="path">${escapeHtml(r.path)}</td>` +
        `<td>${escapeHtml(r.page_type)}</td>` +
        `<td>${escapeHtml(intentGoal(r.intent))}</td>` +
        `<td><span class="${dispositionClass(disp)}">${DISPOSITION_LABEL[disp]}</span></td>` +
        `<td class="kw">${escapeHtml(keywordCell(r.target_keywords))}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<section class="block"><h2>Page inventory</h2>` +
    `<table class="psg"><thead><tr>` +
    `<th>Page</th><th>Path</th><th>Type</th><th>Goal</th><th>Status</th><th>Target keywords</th>` +
    `</tr></thead><tbody>${body}</tbody></table></section>`
  );
}

function renderCalendar(calendar: ContentCalendar): string {
  const byMonth = new Map<number, ContentCalendar["entries"]>();
  for (const e of calendar.entries) {
    const list = byMonth.get(e.month) ?? [];
    list.push(e);
    byMonth.set(e.month, list);
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b);
  const sections = months
    .map((month) => {
      const rows = byMonth
        .get(month)!
        .map(
          (e) =>
            `<tr><td>${escapeHtml(displayTitle(e.title))} <span class="path">${escapeHtml(e.pagePath)}</span></td>` +
            `<td>${escapeHtml(e.pageType)}</td>` +
            `<td><span class="${dispositionClass(e.disposition)}">${DISPOSITION_LABEL[e.disposition]}</span></td>` +
            `<td>${escapeHtml(e.primaryKeyword || "—")}</td>` +
            `<td>${escapeHtml(personaNames(e.personaIds))}</td></tr>`,
        )
        .join("");
      return (
        `<h3>Month ${month}</h3>` +
        `<table class="psg"><thead><tr><th>Page</th><th>Type</th><th>Status</th><th>Primary keyword</th><th>Personas</th></tr></thead>` +
        `<tbody>${rows}</tbody></table>`
      );
    })
    .join("");
  return (
    `<section class="block"><h2>Content calendar</h2>` +
    `<p class="caption">Cadence: <strong>${calendar.pagesPerMonth} pages / month</strong>.</p>` +
    (sections || `<p class="caption">No calendar entries.</p>`) +
    `</section>`
  );
}

function renderQuality(pkg: SitemapPackage): string {
  const v = pkg.validation;
  const check = (ok: boolean, okText: string, badText: string) =>
    ok ? `<li class="ok">✅ ${escapeHtml(okText)}</li>` : `<li class="bad">❌ ${escapeHtml(badText)}</li>`;
  const items = [
    check(v.threeClickViolations.length === 0, "3-click rule: every page ≤ 3 clicks from home", `${v.threeClickViolations.length} page(s) too deep`),
    check(v.duplicateSlugPaths.length === 0, "Unique URLs: no duplicate paths", `${v.duplicateSlugPaths.length} duplicate path(s)`),
    check(v.brokenInternalLinks.length === 0, "Internal links: all resolve", `${v.brokenInternalLinks.length} broken link(s)`),
  ];
  if (pkg.vertical === "collision_repair") {
    items.push(
      check(
        v.coverageGaps.length === 0,
        "Collision required-page coverage: complete (8-persona)",
        `${v.coverageGaps.length} gap(s): ${v.coverageGaps.map((g) => g.title).join(", ")}`,
      ),
    );
  }
  return `<section class="block"><h2>Quality checks</h2><ul class="checks">${items.join("")}</ul></section>`;
}

function renderApprovals(pkg: SitemapPackage): string {
  if (pkg.checkpoints.length === 0) {
    return `<section class="block"><h2>Approvals</h2><p class="caption">No checkpoint approvals recorded.</p></section>`;
  }
  const rows = pkg.checkpoints
    .map((c) => {
      const phase = c.phase === "clusters_page_types" ? "Clusters &amp; page types" : "Package hand-off";
      return `<li><strong>${phase}:</strong> ${escapeHtml(c.decision)} by ${escapeHtml(c.approvedBy)} <span class="path">(${dateLabel(c.approvedAt)})</span>${c.notes ? ` — ${escapeHtml(c.notes)}` : ""}</li>`;
    })
    .join("");
  return `<section class="block"><h2>Approvals</h2><ul class="approvals">${rows}</ul></section>`;
}

/* -------------------------------------------------------------------------- */
/* CSS — inlined house tokens (mirrors lib/intel/report/render.ts)            */
/* -------------------------------------------------------------------------- */

const STYLE = `
:root{
  --psg-midnight:#1E3A52;--psg-midnight-70:#8FA1B2;--psg-midnight-90:#DCE3EA;--psg-ember-65:#D88378;
  --psg-paper:#FAFAFA;--psg-bone:#F0F0F0;--psg-stone:#E0E0E0;
  --psg-graphite:#2A2A2A;--psg-dark-ash:#4B5058;--psg-mist:#949494;
  --color-surface:#FFFFFF;--color-ok:#2F7D5B;--color-bad:#B8483E;--color-warn:#C9772B;
  --font-display:"Gotham","Helvetica Neue",system-ui,sans-serif;
  --font-body:"Didact Gothic","Gotham",system-ui,sans-serif;
  --radius-sm:4px;--radius-md:6px;--radius-pill:999px;--container:1120px;
  --shadow-sm:0 1px 2px rgba(22,21,20,0.04),0 1px 1px rgba(22,21,20,0.03);
}
*{box-sizing:border-box;}
html{font-family:var(--font-body);font-size:16px;color:var(--psg-graphite);background:var(--psg-paper);-webkit-font-smoothing:antialiased;}
body{margin:0;}
.wrap{max-width:var(--container);margin:0 auto;padding:48px 32px 80px;}
h1,h2,h3{font-family:var(--font-display);margin:0;line-height:1.2;color:var(--psg-midnight);}
h1{font-size:34px;font-weight:700;}
h2{font-size:22px;font-weight:700;margin-bottom:16px;}
h3{font-size:16px;font-weight:500;margin:24px 0 8px;color:var(--psg-dark-ash);}
.eyebrow{font-family:var(--font-display);font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.18em;color:var(--psg-ember-65);margin-bottom:8px;}
header.cover{border-bottom:3px solid var(--psg-midnight);padding-bottom:24px;margin-bottom:32px;}
header.cover .gen{color:var(--psg-mist);font-size:13px;margin-top:8px;}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0 8px;}
.kpi{background:var(--color-surface);border:1px solid var(--psg-stone);border-radius:var(--radius-md);padding:18px;box-shadow:var(--shadow-sm);}
.kpi .n{font-family:var(--font-display);font-weight:700;font-size:30px;color:var(--psg-midnight);line-height:1;font-variant-numeric:tabular-nums;}
.kpi .l{font-size:12px;color:var(--psg-dark-ash);margin-top:8px;text-transform:uppercase;letter-spacing:.06em;}
dl.scope{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 32px;margin:24px 0;}
dl.scope dt{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--psg-mist);}
dl.scope dd{margin:2px 0 8px;font-size:16px;color:var(--psg-graphite);}
.block{margin:40px 0;}
.diagram{background:var(--color-surface);border:1px solid var(--psg-stone);border-radius:var(--radius-md);padding:20px;overflow:auto;}
.diagram pre.mermaid{margin:0;background:transparent;border:0;}
.caption{color:var(--psg-mist);font-size:13px;margin-top:10px;}
table.psg{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;}
table.psg th{text-align:left;background:var(--psg-midnight);color:var(--psg-paper);font-family:var(--font-display);font-weight:500;font-size:12px;padding:8px 10px;}
table.psg td{padding:8px 10px;border-bottom:1px solid var(--psg-bone);vertical-align:top;}
table.psg tr:nth-child(even) td{background:var(--color-surface);}
td.path,.path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--psg-mist);}
td.kw{color:var(--psg-dark-ash);max-width:320px;word-break:break-word;}
.pill{display:inline-block;font-family:var(--font-display);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--psg-paper);border-radius:var(--radius-pill);padding:2px 9px;}
.pill-new{background:var(--psg-midnight);}
.pill-keep{background:var(--color-ok);}
.pill-improve{background:var(--color-warn);}
ul.checks,ul.approvals{list-style:none;padding:0;margin:0;}
ul.checks li,ul.approvals li{padding:6px 0;border-bottom:1px solid var(--psg-bone);font-size:14px;}
ul.checks li.ok{color:var(--color-ok);}
ul.checks li.bad{color:var(--color-bad);}
footer.foot{margin-top:56px;padding-top:20px;border-top:1px solid var(--psg-stone);color:var(--psg-mist);font-size:12px;}
@media print{
  @page{margin:14mm;}
  .wrap{padding:0;max-width:none;}
  .kpi,.diagram{box-shadow:none;}
  table.psg{font-size:11px;}
  table.psg thead{display:table-header-group;}   /* repeat column headers on every printed page */
  table.psg tr{break-inside:avoid;}              /* never split a row across a page break */
  h2,h3{break-after:avoid;}                       /* keep a section heading with its first rows */
  .block{break-inside:auto;}
  .diagram{overflow:visible;}
  .diagram pre.mermaid{white-space:pre-wrap;}
}
`;

/* -------------------------------------------------------------------------- */
/* Document                                                                   */
/* -------------------------------------------------------------------------- */

export type RenderDeliverableOptions = {
  /** Mermaid CDN script src. Default the pinned jsDelivr ESM build. Set "" to omit
   *  (e.g. when the PDF worker injects its own bundled mermaid). */
  mermaidScriptSrc?: string;
};

const DEFAULT_MERMAID_SRC =
  "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

/**
 * Render the full client-facing deliverable for one finished package. Self-contained
 * HTML: inlined house tokens + the same Mermaid the source artifact emits.
 */
export function renderSitemapDeliverable(
  pkg: SitemapPackage,
  opts: RenderDeliverableOptions = {},
): string {
  const mermaidSrc = opts.mermaidScriptSrc ?? DEFAULT_MERMAID_SRC;
  const title = `Sitemap & Content Plan — ${pkg.brief.businessName}`;
  const mermaidBoot = mermaidSrc
    ? `<script type="module">import mermaid from "${escapeHtml(mermaidSrc)}";mermaid.initialize({startOnLoad:true,theme:"neutral"});</script>`
    : "";

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>` +
    `<body><div class="wrap">` +
    `<header class="cover">` +
    `<div class="eyebrow">Body Shop Marketer — Sitemap &amp; Content Architecture</div>` +
    `<h1>${escapeHtml(pkg.brief.businessName)}</h1>` +
    `<div class="gen">Prepared ${escapeHtml(dateLabel(pkg.generatedAt))}</div>` +
    `</header>` +
    renderKpis(pkg) +
    renderScope(pkg) +
    renderSitemapDiagram(pkg) +
    renderInventory(pkg) +
    renderCalendar(pkg.calendar) +
    renderQuality(pkg) +
    renderApprovals(pkg) +
    `<footer class="foot">Generated by Phoenix Solutions Group — Body Shop Marketer. Page inventory, sitemap diagram, and content calendar all derive from one hierarchy source.</footer>` +
    `</div>${mermaidBoot}</body></html>`
  );
}
