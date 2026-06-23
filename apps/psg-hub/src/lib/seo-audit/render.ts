// Wave 1C / PSG-227 — Customer-facing SEO audit report renderer.
// PURE: renderShopAuditReportHtml(report) -> ONE self-contained branded HTML string.
// No IO, no clock, no React. Mirrors the design-token system + @font-face of the
// intel report renderer (src/lib/intel/report/render.ts) so the audit deliverable
// is visually consistent with the rest of PSG's report surfaces — but the copy is
// CUSTOMER-facing (this is sent to the shop owner, not an internal-only doc).
//
// GROUNDING: every visible value comes from the already-assembled ShopAuditReport
// (report.ts) — the renderer invents nothing. Greenfield mode renders the same
// shell with a "build plan" framing instead of a score.

import type {
  AuditFinding,
  FindingSeverity,
  InventoryUrl,
  KeywordTarget,
  ShopAuditReport,
} from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateLabel(iso: string): string {
  return iso.slice(0, 10);
}

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Display ordering for findings: critical first, low last (PSG-264 item 5). */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

/**
 * Trim a finding's `area` to a readable path for the report's "Page" column
 * (PSG-264 item 4). Audited findings carry a full page URL — strip the protocol
 * and domain so the customer sees `/services/dent-repair`, not the whole URL.
 * Greenfield findings carry a plain label ("service pages") that isn't a URL —
 * leave those untouched.
 */
function pageLabel(area: string): string {
  try {
    const u = new URL(area);
    const path = `${u.pathname}${u.search}`;
    return path === "" ? "/" : path;
  } catch {
    return area;
  }
}

const INTENT_LABEL: Record<KeywordTarget["intent"], string> = {
  local: "Local",
  service: "Service",
  informational: "Informational",
  transactional: "Transactional",
  emergency: "Emergency",
};

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function renderHero(report: ShopAuditReport): string {
  if (report.mode === "greenfield") {
    return (
      `<section class="panel hero greenfield"><div class="score-wrap">` +
      `<div class="score new">NEW</div>` +
      `<div class="score-copy"><h2>Your website build plan</h2>` +
      `<p class="lead">We couldn't find a live website to audit, so this report is a ` +
      `prioritized plan for the site we'll build with you — not a score. Once your ` +
      `site is live, re-run this audit for a graded baseline.</p></div></div></section>`
    );
  }
  const score = report.healthScore ?? 0;
  return (
    `<section class="panel hero"><div class="score-wrap">` +
    `<div class="score grade-${report.grade}"><div class="g">${escapeHtml(report.grade)}</div>` +
    `<div class="s">${score}<span>/100</span></div></div>` +
    `<div class="score-copy"><h2>Your SEO health score</h2>` +
    `<p class="lead">A snapshot of how well your current site is set up to win local ` +
    `search. We graded ${report.summary.pagesCrawled} page${report.summary.pagesCrawled === 1 ? "" : "s"} ` +
    `and flagged exactly what to keep and what to improve.</p></div></div></section>`
  );
}

function renderKpis(report: ShopAuditReport): string {
  const s = report.summary;
  // Greenfield reports have nothing crawled — show build-plan metrics instead of
  // the 0/0/0 crawl counts (PSG-264 item 3). Plan numbers are grounded in summary.plan.
  const cards: { n: string; l: string }[] =
    report.mode === "greenfield" && s.plan
      ? [
          { n: String(s.plan.pagesToBuild), l: "Pages to build" },
          { n: String(s.plan.servicePages), l: "Service pages" },
          { n: String(s.plan.citiesToCover), l: "Cities to cover" },
          { n: String(s.keywordOpportunities), l: "Keyword targets" },
        ]
      : [
          { n: String(s.pagesCrawled), l: "Pages reviewed" },
          { n: String(s.keepCount), l: "Pages to keep" },
          { n: String(s.improveCount), l: "Pages to improve" },
          { n: String(s.keywordOpportunities), l: "Keyword opportunities" },
        ];
  return (
    `<div class="kpis">` +
    cards
      .map(
        (c) =>
          `<div class="kpi"><div class="n">${escapeHtml(c.n)}</div>` +
          `<div class="l">${escapeHtml(c.l)}</div></div>`,
      )
      .join("") +
    `</div>`
  );
}

function renderFindings(findings: AuditFinding[], mode: ShopAuditReport["mode"]): string {
  const heading = mode === "greenfield" ? "What your new site needs" : "What's holding you back";
  if (findings.length === 0) {
    return (
      `<section class="panel"><h2>${heading}</h2>` +
      `<p class="empty">No issues found — your pages clear our baseline checks.</p></section>`
    );
  }
  // Lead with what matters: sort globally critical→low so a Critical never renders
  // below a Low regardless of crawl/page order (PSG-264 item 5). Stable within a
  // severity tier (preserves upstream ordering).
  const ordered = findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_RANK[b.f.severity] - SEVERITY_RANK[a.f.severity] || a.i - b.i)
    .map(({ f }) => f);
  const rows = ordered
    .map(
      (f) =>
        `<tr><td><span class="sev ${f.severity}">${SEVERITY_LABEL[f.severity]}</span></td>` +
        `<td class="page">${escapeHtml(pageLabel(f.area))}</td>` +
        `<td>${escapeHtml(f.detail)}</td></tr>`,
    )
    .join("");
  return (
    `<section class="panel"><h2>${heading}</h2>` +
    `<div class="table-scroll"><table class="psg"><thead><tr><th>Priority</th><th>Page</th><th>Finding</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div></section>`
  );
}

function renderInventory(inventory: InventoryUrl[]): string {
  if (inventory.length === 0) {
    return (
      `<section class="panel"><h2>Page inventory</h2>` +
      `<p class="empty">No existing pages were found to inventory.</p></section>`
    );
  }
  const rows = inventory
    .map(
      (u) =>
        `<tr><td class="url">${escapeHtml(u.url)}</td>` +
        `<td>${escapeHtml(u.title || "—")}</td>` +
        `<td><span class="disp ${u.disposition}">${u.disposition === "keep" ? "Keep" : "Improve"}</span></td>` +
        `<td class="note">${escapeHtml(u.note ?? "")}</td></tr>`,
    )
    .join("");
  return (
    `<section class="panel"><h2>Page inventory</h2>` +
    `<p class="lead">Every page we found on your site, with a clear call: carry it ` +
    `forward as-is (Keep) or rework it (Improve).</p>` +
    `<div class="table-scroll"><table class="psg"><thead><tr><th>URL</th><th>Title</th><th>Verdict</th><th>Why</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div></section>`
  );
}

function renderKeywords(targets: KeywordTarget[]): string {
  if (targets.length === 0) return "";
  const rows = targets
    .map(
      (t) =>
        `<tr><td class="kw">${escapeHtml(t.keyword)}</td>` +
        `<td><span class="intent">${INTENT_LABEL[t.intent]}</span></td>` +
        `<td><b>${t.priority}</b></td></tr>`,
    )
    .join("");
  return (
    `<section class="panel"><h2>Keyword opportunities</h2>` +
    `<p class="lead">The searches your future customers are typing — ranked by how ` +
    `close they are to booking a job. These seed your content plan.</p>` +
    `<div class="table-scroll"><table class="psg"><thead><tr><th>Keyword</th><th>Intent</th><th>Priority</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div></section>`
  );
}

function renderRecommendations(recs: string[]): string {
  if (recs.length === 0) return "";
  const items = recs.map((r) => `<li>${escapeHtml(r)}</li>`).join("");
  return (
    `<section class="panel"><h2>Recommended next steps</h2>` +
    `<ul class="moves">${items}</ul></section>`
  );
}

/* -------------------------------------------------------------------------- */
/* Styles (mirror intel render tokens; customer-facing additions)             */
/* -------------------------------------------------------------------------- */

function styleBlock(): string {
  return `<style>
@font-face { font-family: "Gotham"; src: url("/fonts/Gotham-Book.otf") format("opentype"); font-weight: 400; font-display: swap; }
@font-face { font-family: "Gotham"; src: url("/fonts/Gotham-Medium.otf") format("opentype"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Gotham"; src: url("/fonts/Gotham-Bold.otf") format("opentype"); font-weight: 700; font-display: swap; }
@font-face { font-family: "Didact Gothic"; src: url("/fonts/DidactGothic-Regular.ttf") format("truetype"); font-weight: 400; font-display: swap; }
:root {
  --psg-midnight: #1E3A52; --psg-midnight-70: #8FA1B2; --psg-midnight-90: #DCE3EA; --psg-ember-65: #D88378;
  --psg-paper: #FAFAFA; --psg-bone: #F0F0F0; --psg-stone: #E0E0E0;
  --psg-graphite: #2A2A2A; --psg-dark-ash: #4B5058; --psg-mist: #949494;
  --color-surface: #FFFFFF; --color-danger: #B8483E; --color-warn: #C9772B; --color-mod: #527B8E; --color-low: #6B7280;
  --color-keep: #3E8E5A; --color-improve: #C9772B;
  --font-display: "Gotham", "Helvetica Neue", system-ui, sans-serif;
  --font-body: "Didact Gothic", "Gotham", system-ui, sans-serif;
  --fs-12: 0.75rem; --fs-13: 0.8125rem; --fs-14: 0.875rem; --fs-18: 1.125rem; --fs-24: 1.5rem; --fs-36: 2.25rem; --fs-48: 3rem;
  --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem; --space-5: 1.5rem; --space-6: 2rem; --space-7: 2.5rem; --space-10: 5rem;
  --radius-sm: 4px; --radius-md: 6px; --radius-pill: 999px;
  --shadow-sm: 0 1px 2px rgba(22,21,20,0.04), 0 1px 1px rgba(22,21,20,0.03);
  --container: 1120px;
}
html { font-family: var(--font-body); font-size: 16px; color: var(--psg-graphite); background: var(--psg-paper); -webkit-font-smoothing: antialiased; }
body { margin: 0; line-height: 1.5; }
h1, h2, h3 { font-family: var(--font-display); margin: 0; line-height: 1.2; }
p { margin: 0; }
.wrap { max-width: var(--container); margin: 0 auto; padding: 0 var(--space-6) var(--space-10); }
header.masthead { background: var(--psg-midnight); color: var(--psg-paper); padding: var(--space-7) 0; }
header.masthead .wrap { padding-bottom: 0; }
.eyebrow { font-family: var(--font-display); font-size: var(--fs-12); font-weight: 500; text-transform: uppercase; letter-spacing: 0.18em; color: var(--psg-ember-65); margin-bottom: var(--space-4); }
header.masthead h1 { color: var(--psg-paper); font-size: var(--fs-36); margin-bottom: var(--space-4); }
.sub { color: var(--psg-midnight-90); font-size: var(--fs-18); max-width: 64ch; }
.meta { margin-top: var(--space-6); font-size: var(--fs-13); color: var(--psg-midnight-70); display: flex; flex-wrap: wrap; gap: var(--space-5); }
.meta b { color: var(--psg-paper); font-weight: 500; }
section.panel { background: var(--color-surface); border: 1px solid var(--psg-stone); border-radius: var(--radius-md); padding: var(--space-6) var(--space-7); margin-top: var(--space-6); box-shadow: var(--shadow-sm); }
section.panel h2 { font-size: var(--fs-24); color: var(--psg-midnight); margin-bottom: var(--space-2); }
.lead { font-size: var(--fs-18); color: var(--psg-dark-ash); line-height: 1.65; margin-bottom: var(--space-5); }
.empty { color: var(--psg-mist); font-style: italic; }
.hero { display: block; }
.score-wrap { display: flex; align-items: center; gap: var(--space-6); }
.score { flex: 0 0 auto; width: 132px; height: 132px; border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--psg-paper); background: var(--psg-midnight); }
.score .g { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-48); line-height: 1; }
.score .s { font-size: var(--fs-13); margin-top: var(--space-2); font-variant-numeric: tabular-nums; }
.score .s span { opacity: 0.7; }
.score.grade-A { background: var(--color-keep); }
.score.grade-B { background: #5E8E3E; }
.score.grade-C { background: var(--color-mod); }
.score.grade-D { background: var(--color-warn); }
.score.grade-F { background: var(--color-danger); }
.score.new { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-24); letter-spacing: 0.08em; background: var(--psg-dark-ash); }
.score-copy h2 { margin-bottom: var(--space-3); }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin: var(--space-2) 0 0; }
.kpi { background: var(--psg-bone); border: 1px solid var(--psg-stone); border-radius: var(--radius-md); padding: var(--space-5); }
.kpi .n { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-36); color: var(--psg-midnight); line-height: 1; font-variant-numeric: tabular-nums; }
.kpi .l { font-size: var(--fs-13); color: var(--psg-dark-ash); margin-top: var(--space-2); }
table.psg { width: 100%; border-collapse: collapse; margin-top: var(--space-3); }
table.psg th { text-align: left; background: var(--psg-midnight); color: var(--psg-paper); font-family: var(--font-display); font-weight: 500; font-size: var(--fs-13); padding: var(--space-3) var(--space-4); }
table.psg td { font-size: var(--fs-14); color: var(--psg-graphite); border-bottom: 1px solid var(--psg-stone); padding: var(--space-3) var(--space-4); vertical-align: top; }
.page, .url { font-size: var(--fs-13); color: var(--psg-dark-ash); word-break: break-all; max-width: 32ch; }
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.note { color: var(--psg-dark-ash); font-size: var(--fs-13); }
.kw { font-weight: 500; }
.sev, .disp, .intent { display: inline-block; font-family: var(--font-display); font-size: var(--fs-12); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--psg-paper); border-radius: var(--radius-pill); padding: 2px 9px; }
.sev.critical { background: var(--color-danger); }
.sev.high { background: var(--color-warn); }
.sev.medium { background: var(--color-mod); }
.sev.low { background: var(--color-low); }
.disp.keep { background: var(--color-keep); }
.disp.improve { background: var(--color-improve); }
.intent { background: var(--psg-dark-ash); font-weight: 500; }
ul.moves { margin: 0; padding-left: var(--space-5); color: var(--psg-graphite); }
ul.moves li { margin-bottom: var(--space-2); line-height: 1.5; }
footer.psg { background: var(--psg-midnight); color: var(--psg-midnight-70); font-size: var(--fs-13); padding: var(--space-6) 0; margin-top: var(--space-7); }
@media (max-width: 640px) {
  .wrap { padding-left: var(--space-4); padding-right: var(--space-4); }
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .score-wrap { flex-direction: column; align-items: flex-start; gap: var(--space-4); }
  table.psg { min-width: 32rem; }
}
</style>`;
}

/* -------------------------------------------------------------------------- */
/* renderShopAuditReportHtml                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Render the full shop SEO audit to one self-contained, customer-facing HTML
 * document. `report` is the already-assembled payload from buildShopAuditReport()
 * — this function adds zero logic beyond presentation + escaping.
 */
export function renderShopAuditReportHtml(report: ShopAuditReport): string {
  const domainLabel = report.domain ?? "No live site";
  const masthead =
    `<header class="masthead"><div class="wrap">` +
    `<p class="eyebrow">Baseline SEO Audit</p>` +
    `<h1>${escapeHtml(report.businessName)}</h1>` +
    `<p class="sub">A plain-language read of how your website is set up to win local ` +
    `search — what's working, what to fix, and where the opportunity is.</p>` +
    `<div class="meta">` +
    `<span>Site <b>${escapeHtml(domainLabel)}</b></span>` +
    `<span>Prepared <b>${escapeHtml(dateLabel(report.generatedAt))}</b></span>` +
    `</div></div></header>`;

  const footer =
    `<footer class="psg"><div class="wrap"><p>` +
    `Prepared by Phoenix Solutions Group · ${escapeHtml(dateLabel(report.generatedAt))} · ` +
    `Re-run this audit any time from your dashboard.` +
    `</p></div></footer>`;

  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>SEO Audit · ${escapeHtml(report.businessName)}</title>` +
    styleBlock() +
    `</head><body>` +
    masthead +
    `<div class="wrap">` +
    renderHero(report) +
    `<section class="panel"><h2>At a glance</h2>` +
    `<p class="lead">The headline numbers from your audit.</p>` +
    renderKpis(report) +
    `</section>` +
    renderFindings(report.findings, report.mode) +
    renderInventory(report.inventory) +
    renderKeywords(report.keywordTargets) +
    renderRecommendations(report.recommendations) +
    `</div>` +
    footer +
    `</body></html>`
  );
}
