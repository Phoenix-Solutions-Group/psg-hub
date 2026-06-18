// v1.6 / 16-03 — Competitor intelligence report renderer.
// PURE: renderCompetitorReportHtml(report) -> ONE self-contained branded HTML string. No IO,
// no clock, no React. Mirrors lib/report/render.ts (the customer monthly report): the print
// route returns this verbatim and the controlled-host Chromium worker does page.setContent()
// + page.pdf() over it (Chromium does not run on Vercel Fluid — see render-pdf.ts). Inlining
// the design tokens + root-relative @font-face keeps the artifact dependency-free so it embeds
// fonts identically whether shipped to the worker inline or via a print route.
//
// GROUNDING: every visible numeral comes from the already-assembled CompetitorReport
// (report-data.ts) — the renderer invents nothing. The narrative block renders the grounded
// LLM summary when present and a pending-activation notice (pre-G5) otherwise.

import type {
  CompetitorReport,
  RankedCompetitor,
  ReportNarrative,
  ThreatTier,
} from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "n/a" for a missing number — never a fake 0. */
const num = (v: number | null, suffix = ""): string =>
  v == null ? "n/a" : `${v}${suffix}`;

const TIER_LABEL: Record<ThreatTier, string> = {
  critical: "Critical",
  elevated: "Elevated",
  moderate: "Moderate",
  low: "Low",
};

function dateLabel(iso: string): string {
  // Stable, locale-independent: YYYY-MM-DD from the ISO stamp (purity over Intl).
  return iso.slice(0, 10);
}

/** Top-line KPI cards from the deterministic summary. */
function renderKpis(report: CompetitorReport): string {
  const s = report.summary;
  const cards: { n: string; l: string }[] = [
    { n: String(s.totalCompetitors), l: "Competitors tracked" },
    { n: String(s.topThreatScore), l: "Top threat score" },
    { n: `${Math.round(s.consolidatorShare * 100)}%`, l: "Consolidator share" },
    { n: num(s.medianDistanceMiles, " mi"), l: "Median distance" },
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

/** One ranked-competitor row. */
function renderRow(c: RankedCompetitor): string {
  const typeLabel =
    c.type === "consolidator"
      ? escapeHtml(c.consolidatorGroup ?? "Consolidator")
      : "Independent";
  return (
    `<tr>` +
    `<td class="rank">${c.rank}</td>` +
    `<td><div class="cname">${escapeHtml(c.name)}</div>` +
    `<div class="ctype ${c.type}">${typeLabel}</div></td>` +
    `<td><span class="tier ${c.tier}">${TIER_LABEL[c.tier]}</span> <b>${c.threatScore}</b></td>` +
    `<td>${escapeHtml(num(c.distanceMiles, " mi"))}</td>` +
    `<td>${escapeHtml(num(c.rating))}${c.rating != null ? "★" : ""} ` +
    `<span class="rev">(${escapeHtml(num(c.reviewCount))})</span></td>` +
    `<td class="rat">${escapeHtml(c.rationale)}</td>` +
    `</tr>`
  );
}

function renderTable(report: CompetitorReport): string {
  if (report.rankedCompetitors.length === 0) {
    return `<section class="panel"><h2>Threat ranking</h2><p class="empty">No competitors are currently tracked for this shop.</p></section>`;
  }
  const rows = report.rankedCompetitors.map(renderRow).join("");
  return (
    `<section class="panel"><h2>Threat ranking</h2>` +
    `<p class="lead">Consolidator-aware composite threat (0–100), ranked highest first. ` +
    `${report.summary.consolidatorCount} of ${report.summary.totalCompetitors} tracked rivals are ` +
    `consolidator-owned.</p>` +
    `<table class="psg"><thead><tr>` +
    `<th>#</th><th>Competitor</th><th>Threat</th><th>Distance</th><th>Rating</th><th>Why</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></section>`
  );
}

function renderNarrative(narrative: ReportNarrative): string {
  if (narrative.status === "pending_activation") {
    return (
      `<section class="panel notice"><h2>Executive summary</h2>` +
      `<p class="lead">${escapeHtml(narrative.notice)}</p></section>`
    );
  }
  const moves = narrative.keyMoves
    .map((m) => `<li>${escapeHtml(m)}</li>`)
    .join("");
  return (
    `<section class="panel"><h2>Executive summary</h2>` +
    `<p class="lead">${escapeHtml(narrative.summary)}</p>` +
    (moves ? `<h3>Recommended moves</h3><ul class="moves">${moves}</ul>` : "") +
    `<p class="src">Grounded by ${escapeHtml(narrative.provider)} (${escapeHtml(narrative.model)}).</p>` +
    `</section>`
  );
}

/** Inlined design tokens + component CSS + root-relative @font-face (same family as 12-03). */
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
  --font-display: "Gotham", "Helvetica Neue", system-ui, sans-serif;
  --font-body: "Didact Gothic", "Gotham", system-ui, sans-serif;
  --fs-12: 0.75rem; --fs-13: 0.8125rem; --fs-14: 0.875rem; --fs-18: 1.125rem; --fs-24: 1.5rem; --fs-36: 2.25rem;
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
section.panel.notice { border-left: 4px solid var(--psg-ember-65); }
section.panel h2 { font-size: var(--fs-24); color: var(--psg-midnight); margin-bottom: var(--space-2); }
section.panel h3 { font-size: var(--fs-14); color: var(--psg-dark-ash); text-transform: uppercase; letter-spacing: 0.08em; margin: var(--space-5) 0 var(--space-3); }
.lead { font-size: var(--fs-18); color: var(--psg-dark-ash); line-height: 1.65; margin-bottom: var(--space-5); }
.empty { color: var(--psg-mist); font-style: italic; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin: var(--space-2) 0 0; }
.kpi { background: var(--psg-bone); border: 1px solid var(--psg-stone); border-radius: var(--radius-md); padding: var(--space-5); }
.kpi .n { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-36); color: var(--psg-midnight); line-height: 1; font-variant-numeric: tabular-nums; }
.kpi .l { font-size: var(--fs-13); color: var(--psg-mist); margin-top: var(--space-2); }
table.psg { width: 100%; border-collapse: collapse; margin-top: var(--space-3); }
table.psg th { text-align: left; background: var(--psg-midnight); color: var(--psg-paper); font-family: var(--font-display); font-weight: 500; font-size: var(--fs-13); padding: var(--space-3) var(--space-4); }
table.psg td { font-size: var(--fs-14); color: var(--psg-graphite); border-bottom: 1px solid var(--psg-stone); padding: var(--space-3) var(--space-4); vertical-align: top; }
td.rank { font-family: var(--font-display); font-weight: 700; color: var(--psg-midnight); }
.cname { font-weight: 500; color: var(--psg-graphite); }
.ctype { font-size: var(--fs-12); color: var(--psg-mist); margin-top: 2px; }
.ctype.consolidator { color: var(--psg-ember-65); font-weight: 500; }
.rev { color: var(--psg-mist); }
.rat { color: var(--psg-dark-ash); font-size: var(--fs-13); max-width: 34ch; }
.tier { display: inline-block; font-family: var(--font-display); font-size: var(--fs-12); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--psg-paper); border-radius: var(--radius-pill); padding: 2px 9px; }
.tier.critical { background: var(--color-danger); }
.tier.elevated { background: var(--color-warn); }
.tier.moderate { background: var(--color-mod); }
.tier.low { background: var(--color-low); }
ul.moves { margin: 0; padding-left: var(--space-5); color: var(--psg-graphite); }
ul.moves li { margin-bottom: var(--space-2); line-height: 1.5; }
.src { font-size: var(--fs-13); color: var(--psg-mist); margin-top: var(--space-4); }
footer.psg { background: var(--psg-midnight); color: var(--psg-midnight-70); font-size: var(--fs-13); padding: var(--space-6) 0; margin-top: var(--space-7); }
</style>`;
}

/**
 * Render the full competitor intelligence report to one self-contained HTML document.
 * `report` is the already-assembled payload from assembleCompetitorReport() — this function
 * adds zero logic beyond presentation + escaping.
 */
export function renderCompetitorReportHtml(report: CompetitorReport): string {
  const masthead =
    `<header class="masthead"><div class="wrap">` +
    `<p class="eyebrow">Internal Competitive Intelligence</p>` +
    `<h1>Competitor Threat Report</h1>` +
    `<p class="sub">Consolidator-aware threat ranking for the shop's local competitive set, ` +
    `with a grounded executive read.</p>` +
    `<div class="meta">` +
    `<span>Shop <b>${escapeHtml(report.shopId || "n/a")}</b></span>` +
    `<span>Generated <b>${escapeHtml(dateLabel(report.generatedAt))}</b></span>` +
    `<span>Competitors <b>${report.summary.totalCompetitors}</b></span>` +
    `</div></div></header>`;

  const overview =
    `<section class="panel"><h2>At a glance</h2>` +
    `<p class="lead">A snapshot of the competitive pressure on this shop. Scores blend proximity ` +
    `and market presence, then weight consolidator-owned locations higher.</p>` +
    renderKpis(report) +
    `</section>`;

  const footer =
    `<footer class="psg"><div class="wrap"><p>` +
    `Phoenix Solutions Group · Internal competitor intelligence (v1.6) · ` +
    `${escapeHtml(dateLabel(report.generatedAt))} · Not for external distribution.` +
    `</p></div></footer>`;

  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>Competitor Threat Report · ${escapeHtml(report.shopId || "shop")}</title>` +
    styleBlock() +
    `</head><body>` +
    masthead +
    `<div class="wrap">` +
    overview +
    renderNarrative(report.narrative) +
    renderTable(report) +
    `</div>` +
    footer +
    `</body></html>`
  );
}
