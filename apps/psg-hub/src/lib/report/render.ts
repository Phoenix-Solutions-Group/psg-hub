// Phase 12 / 12-03 — Branded report renderer.
// PURE: renderReportHtml(reportData, narrative) -> ONE self-contained HTML string.
// No IO, no clock, no React. The print route returns this verbatim; the Hetzner
// Chromium worker does page.goto(printUrl) then page.pdf() over it.
//
// FONTS (SPEC DEVIATION from 12-03-PLAN, see 12-03-SUMMARY): the plan called for
// next/font self-serving via the route. next/font only injects its @font-face CSS
// when its className appears in a React-rendered tree — a route handler returning a
// raw string never goes through that pipeline, so the rules are never served and the
// PDF silently falls back. Fix: this module inlines @font-face with ROOT-RELATIVE
// `/fonts/...` URLs (files live in public/fonts/). Root-relative resolves against the
// ORIGIN, not the document path, so the worker's page.goto(https://origin/...print)
// resolves them to https://origin/fonts/... and embeds. Path-relative `url("fonts/")`
// was the trap the plan warned about; root-relative-from-/public is the safe form.
//
// GROUNDING: every visible numeral comes from reportData (formatted) or the already
// substituted narrative. Sources not in linkedSources are OMITTED (never zero-filled).
// A source not in sourcesWithPriorMonth renders within-period (cold-start) framing
// instead of a MoM delta (no divide-by-zero).

import { formatNumber, formatShortDate } from "../analytics/aggregate";
import type { SeriesPoint } from "../analytics/aggregate";
import type { AnalyticsSource, Ga4DimensionRow } from "../analytics/types";
import type {
  ReportData,
  SourceReportBlock,
  Ga4DimensionsReport,
  PerformanceReport,
  GbpPresenceReport,
} from "./types";
import type { ReportNarrative } from "./schema";

/** Per-source display label + section title (per-source order: GSC, GA4, Ads, SEMrush). */
const SOURCE_META: Record<AnalyticsSource, { badge: string; title: string }> = {
  gbp: { badge: "Google Business Profile", title: "Local presence" },
  gsc: { badge: "Google Search Console", title: "Organic search" },
  ga4: { badge: "Google Analytics", title: "Website traffic" },
  google_ads: { badge: "Google Ads", title: "Paid marketing" },
  semrush: { badge: "SEMrush", title: "Organic SEO" },
};

/** Per-source display order used by every per-source loop. */
const SOURCE_ORDER: AnalyticsSource[] = ["gbp", "gsc", "ga4", "google_ads", "semrush"];

/** The operator-locked KPI headline set (one card per linked source). */
const KPI_SET: { source: AnalyticsSource; metric: string; label: string }[] = [
  { source: "ga4", metric: "sessions", label: "Website sessions" },
  { source: "gsc", metric: "clicks", label: "Search clicks" },
  { source: "google_ads", metric: "conversions", label: "Ads conversions" },
  { source: "semrush", metric: "organic_keywords", label: "Organic keywords" },
  { source: "gbp", metric: "call_clicks", label: "Profile calls" },
];

/** Friendly per-metric labels for the per-source + MoM tables. */
const METRIC_LABELS: Record<string, string> = {
  sessions: "Sessions",
  total_users: "Total users",
  active_users: "Active users",
  new_users: "New users",
  engaged_sessions: "Engaged sessions",
  key_events: "Key events",
  engagement_rate: "Engagement rate",
  clicks: "Clicks",
  impressions: "Impressions",
  ctr: "Click-through rate",
  position: "Average position",
  spend: "Spend",
  conversions: "Conversions",
  cpl: "Cost per lead",
  cost_micros: "Cost (micros)",
  organic_keywords: "Organic keywords",
  organic_traffic: "Organic traffic",
  organic_traffic_cost: "Organic traffic value",
  backlinks: "Backlinks",
  authority_score: "Authority score",
  impressions_desktop_maps: "Impressions (desktop Maps)",
  impressions_desktop_search: "Impressions (desktop Search)",
  impressions_mobile_maps: "Impressions (mobile Maps)",
  impressions_mobile_search: "Impressions (mobile Search)",
  impressions_total: "Profile impressions",
  website_clicks: "Website clicks",
  call_clicks: "Calls",
  direction_requests: "Direction requests",
  conversations: "Messages",
};

const RATIO_KEYS = new Set(["ctr", "engagement_rate"]);
const MONEY_KEYS = new Set(["spend", "organic_traffic_cost", "cpl"]);

/** Metrics that are noisy/internal and excluded from the per-source detail tables. */
const HIDDEN_KEYS = new Set(["cost_micros"]);

/** Escape text destined for HTML (narrative strings are user-facing prose). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format a raw metric value for display. null -> "n/a" (never a fake 0). */
function formatValue(key: string, value: number | null): string {
  if (value === null) return "n/a";
  if (RATIO_KEYS.has(key)) return `${(value * 100).toFixed(1)}%`;
  if (key === "position") return value.toFixed(1);
  if (MONEY_KEYS.has(key)) return `$${formatNumber(Math.round(value))}`;
  return formatNumber(Math.round(value));
}

/** Signed MoM percentage ("+12%", "-5%", "flat"); null -> "" (caller frames cold-start). */
function formatMom(ratio: number | null): string {
  if (ratio === null) return "";
  const pct = Math.round(ratio * 100);
  if (pct === 0) return "flat";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

const METRIC_LABEL = (key: string): string => METRIC_LABELS[key] ?? key;

/** Up/down/flat direction class for a MoM ratio (drives the success/ember tint). */
function changeClass(ratio: number | null): string {
  if (ratio === null || Math.round(ratio * 100) === 0) return "";
  return ratio > 0 ? "up" : "down";
}

/**
 * Up to `max` real points evenly sampled from a daily series. Every point is an
 * ACTUAL (date, value) from reportData — nothing is computed, so no invented number
 * can reach the trend bars. Returns [] for an empty series.
 */
function sampleSeries(series: SeriesPoint[], max = 6): SeriesPoint[] {
  if (series.length <= max) return series;
  const out: SeriesPoint[] = [];
  const stride = (series.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(series[Math.round(i * stride)]);
  }
  return out;
}

/** Render a source's headline-metric trend as canon bar-fill rows (real values only). */
function renderTrend(block: SourceReportBlock): string {
  const key = Object.keys(block.trend)[0];
  if (!key) return "";
  const points = sampleSeries(block.trend[key]);
  if (points.length === 0) return "";
  const max = Math.max(...points.map((p) => p.value), 1);
  const rows = points
    .map((p) => {
      const pct = Math.max(3, Math.round((p.value / max) * 100));
      return (
        `<div class="trend-row"><div class="trend-wk">${escapeHtml(
          formatShortDate(p.date)
        )}</div>` +
        `<div class="trend-track"><div class="trend-fill" style="width:${pct}%">${formatValue(
          key,
          p.value
        )}</div></div></div>`
      );
    })
    .join("");
  return `<div class="trend">${rows}</div>`;
}

/** Per-source detail table: Metric | Prior | This month | Change. Cold start -> within-period. */
function renderSourceTable(block: SourceReportBlock): string {
  const keys = Object.keys(block.current).filter((k) => !HIDDEN_KEYS.has(k));
  const hasPrior = block.prior !== null;
  const rows = keys
    .map((key) => {
      const cur = formatValue(key, block.current[key] ?? null);
      const prior = hasPrior ? formatValue(key, block.prior?.[key] ?? null) : "n/a";
      const mom = block.momDelta[key] ?? null;
      const cls = changeClass(mom);
      const change = hasPrior
        ? formatMom(mom) || "flat"
        : "Within period";
      return (
        `<tr><td>${escapeHtml(METRIC_LABEL(key))}</td>` +
        `<td class="now">${prior}</td>` +
        `<td class="tgt">${cur}</td>` +
        `<td class="${cls}">${escapeHtml(change)}</td></tr>`
      );
    })
    .join("");
  return (
    `<table class="psg"><thead><tr><th>Metric</th><th>Prior month</th>` +
    `<th>This month</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>`
  );
}

/** One KPI card (only called for a linked source). */
function renderKpi(
  reportData: ReportData,
  entry: (typeof KPI_SET)[number]
): string {
  const block = reportData.sources[entry.source] as SourceReportBlock;
  const value = formatValue(entry.metric, block.current[entry.metric] ?? null);
  const hasPrior = reportData.sourcesWithPriorMonth.includes(entry.source);
  const mom = block.momDelta[entry.metric] ?? null;
  const momText = formatMom(mom);
  const cls = changeClass(mom);
  const chg = hasPrior && momText
    ? `<div class="chg ${cls}">${cls === "up" ? "&uarr; " : cls === "down" ? "&darr; " : ""}${momText} vs prior month</div>`
    : `<div class="chg">New this period</div>`;
  return (
    `<div class="kpi"><div class="n">${value}</div>${chg}` +
    `<div class="l">${escapeHtml(entry.label)}</div></div>`
  );
}

/** "MM YYYY" label from a 'YYYY-MM' period (deterministic, UTC). */
function monthLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Full date label from an ISO timestamp (deterministic, UTC). */
function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The inlined design-system tokens + canon component CSS + root-relative @font-face. */
function styleBlock(): string {
  return `<style>
@font-face { font-family: "Gotham"; src: url("/fonts/Gotham-Book.otf") format("opentype"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "Gotham"; src: url("/fonts/Gotham-Medium.otf") format("opentype"); font-weight: 500; font-style: normal; font-display: swap; }
@font-face { font-family: "Gotham"; src: url("/fonts/Gotham-Bold.otf") format("opentype"); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: "Gotham"; src: url("/fonts/Gotham-Black.otf") format("opentype"); font-weight: 800; font-style: normal; font-display: swap; }
@font-face { font-family: "Didact Gothic"; src: url("/fonts/DidactGothic-Regular.ttf") format("truetype"); font-weight: 400; font-style: normal; font-display: swap; }
:root {
  --psg-midnight: #1E3A52; --psg-midnight-90: #DCE3EA; --psg-midnight-70: #8FA1B2;
  --psg-midnight-30: #2A4A63; --psg-midnight-15: #142838; --psg-ember-65: #D88378;
  --psg-paper: #FAFAFA; --psg-bone: #F0F0F0; --psg-stone: #E0E0E0;
  --psg-graphite: #2A2A2A; --psg-dark-ash: #4B5058; --psg-mist: #949494;
  --color-surface: #FFFFFF; --color-success: #526B51; --color-danger: #B8483E;
  --font-display: "Gotham", "Helvetica Neue", system-ui, sans-serif;
  --font-body: "Didact Gothic", "Gotham", system-ui, sans-serif;
  --fs-12: 0.75rem; --fs-13: 0.8125rem; --fs-14: 0.875rem; --fs-16: 1rem;
  --fs-18: 1.125rem; --fs-24: 1.5rem; --fs-30: 1.875rem; --fs-36: 2.25rem;
  --lh-snug: 1.2; --lh-relaxed: 1.65; --tr-eyebrow: 0.18em; --tr-heading: -0.01em;
  --fw-medium: 500; --fw-bold: 700;
  --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem; --space-5: 1.5rem;
  --space-6: 2rem; --space-7: 2.5rem; --space-10: 5rem;
  --radius-xs: 2px; --radius-sm: 4px; --radius-md: 6px; --radius-pill: 999px;
  --shadow-sm: 0 1px 2px rgba(22,21,20,0.04), 0 1px 1px rgba(22,21,20,0.03);
  --container-base: 1120px;
}
html { font-family: var(--font-body); font-size: 16px; color: var(--psg-graphite); background: var(--psg-paper); -webkit-font-smoothing: antialiased; }
body { margin: 0; line-height: 1.5; background: var(--psg-paper); }
h1, h2 { font-family: var(--font-display); margin: 0; letter-spacing: var(--tr-heading); line-height: var(--lh-snug); }
p { margin: 0; }
.wrap { max-width: var(--container-base); margin: 0 auto; padding: 0 var(--space-6) var(--space-10); }
header.masthead { background: var(--psg-midnight); color: var(--psg-paper); padding: var(--space-7) 0; }
header.masthead .wrap { padding-bottom: 0; }
.eyebrow { font-family: var(--font-display); font-size: var(--fs-12); font-weight: var(--fw-medium); text-transform: uppercase; letter-spacing: var(--tr-eyebrow); color: var(--psg-ember-65); margin-bottom: var(--space-4); }
header.masthead h1 { color: var(--psg-paper); font-size: var(--fs-36); margin-bottom: var(--space-4); }
.sub { color: var(--psg-midnight-90); font-size: var(--fs-18); line-height: var(--lh-relaxed); max-width: 64ch; }
.meta { margin-top: var(--space-6); font-size: var(--fs-13); color: var(--psg-midnight-70); display: flex; flex-wrap: wrap; gap: var(--space-5); }
.meta b { color: var(--psg-paper); font-weight: var(--fw-medium); }
section.panel { background: var(--color-surface); border: 1px solid var(--psg-stone); border-radius: var(--radius-md); padding: var(--space-6) var(--space-7); margin-top: var(--space-6); box-shadow: var(--shadow-sm); }
section.panel h2 { font-size: var(--fs-24); color: var(--psg-midnight); margin-bottom: var(--space-2); }
section.panel .lead { font-size: var(--fs-18); color: var(--psg-dark-ash); line-height: var(--lh-relaxed); margin-bottom: var(--space-5); }
.badge-src { display: inline-block; font-family: var(--font-display); font-size: var(--fs-12); font-weight: var(--fw-medium); letter-spacing: 0.08em; text-transform: uppercase; color: var(--psg-dark-ash); background: var(--psg-bone); border: 1px solid var(--psg-stone); border-radius: var(--radius-sm); padding: 3px 10px; margin-bottom: var(--space-4); }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-4); margin: var(--space-2) 0; }
.kpi { background: var(--psg-bone); border: 1px solid var(--psg-stone); border-radius: var(--radius-md); padding: var(--space-5); }
.kpi .n { font-family: var(--font-display); font-weight: var(--fw-bold); font-size: var(--fs-36); color: var(--psg-midnight); line-height: 1; font-variant-numeric: tabular-nums; }
.kpi .chg { font-family: var(--font-display); font-size: var(--fs-12); font-weight: var(--fw-medium); margin-top: var(--space-2); color: var(--psg-dark-ash); }
.kpi .chg.up { color: var(--color-success); }
.kpi .chg.down { color: var(--color-danger); }
.kpi .l { font-size: var(--fs-13); color: var(--psg-mist); margin-top: var(--space-2); }
table.psg { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; margin-top: var(--space-3); }
table.psg th { text-align: left; background: var(--psg-midnight); color: var(--psg-paper); font-family: var(--font-display); font-weight: var(--fw-medium); font-size: var(--fs-13); padding: var(--space-3) var(--space-4); }
table.psg td { font-size: var(--fs-14); color: var(--psg-graphite); border-bottom: 1px solid var(--psg-stone); padding: var(--space-3) var(--space-4); vertical-align: top; }
table.psg tbody tr:last-child td { border-bottom: none; }
table.psg td.lp { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.up { color: var(--color-success); font-weight: var(--fw-bold); }
.down { color: var(--color-danger); font-weight: var(--fw-bold); }
.now { color: var(--psg-dark-ash); font-weight: var(--fw-medium); }
.tgt { color: var(--psg-midnight); font-weight: var(--fw-bold); }
.trend { margin-top: var(--space-4); }
.trend-row { display: grid; grid-template-columns: 90px 1fr; gap: var(--space-4); align-items: center; margin-bottom: var(--space-2); }
.trend-wk { font-family: var(--font-display); font-size: var(--fs-13); color: var(--psg-dark-ash); font-weight: var(--fw-medium); }
.trend-track { background: var(--psg-bone); border-radius: var(--radius-xs); height: 28px; overflow: hidden; }
.trend-fill { height: 100%; background: var(--color-success); display: flex; align-items: center; justify-content: flex-end; padding: 0 var(--space-3); font-family: var(--font-display); font-size: var(--fs-12); font-weight: var(--fw-bold); color: var(--psg-paper); border-radius: var(--radius-xs); font-variant-numeric: tabular-nums; }
.callout { background: var(--psg-bone); border: 1px solid var(--psg-stone); border-left: 3px solid var(--color-success); border-radius: 0 var(--radius-md) var(--radius-md) 0; padding: var(--space-4) var(--space-5); font-size: var(--fs-16); color: var(--psg-graphite); margin-top: var(--space-5); }
.takeaways { margin: var(--space-2) 0 0; padding: 0; list-style: none; }
.takeaways li { position: relative; padding: var(--space-3) 0 var(--space-3) var(--space-6); border-bottom: 1px solid var(--psg-stone); font-size: var(--fs-16); color: var(--psg-graphite); }
.takeaways li:last-child { border-bottom: none; }
.takeaways li::before { content: ""; position: absolute; left: 4px; top: 18px; width: 8px; height: 8px; border-radius: var(--radius-pill); background: var(--psg-midnight); }
.takeaways b { color: var(--psg-midnight); }
.src { font-size: var(--fs-13); color: var(--psg-mist); line-height: var(--lh-relaxed); }
footer.psg { background: var(--psg-midnight); color: var(--psg-midnight-90); margin-top: var(--space-7); }
footer.psg .wrap { padding-top: var(--space-6); padding-bottom: var(--space-6); }
footer.psg p { color: var(--psg-midnight-90); font-size: var(--fs-13); line-height: var(--lh-relaxed); }
@media print { body { background: #fff; } section.panel { break-inside: avoid; box-shadow: none; } header.masthead, footer.psg { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
@page { size: Letter; margin: 0.5in; }
</style>`;
}

/** Seconds -> "m:ss" (e.g. 135 -> "2:15"). For averageSessionDuration KPIs. */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** A 0..1 ratio -> "XX.X%". For share / engagement-rate / bounce-rate cells. */
function formatRatioPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Total sessions across a dimension's rows (top-N + the (other) remainder). */
function dimensionTotal(rows: Ga4DimensionRow[]): number {
  return rows.reduce((sum, r) => sum + r.sessions, 0);
}

/**
 * One GA4 dimensional .panel: badge + title, optional KPI stat line, and a table.psg
 * whose columns are caller-supplied. Every GA4 string value is HTML-escaped; the share
 * column is each row's sessions over the section total (the (other) row keeps the total
 * honest). Returns "" for an empty dimension so no blank card renders.
 */
function renderDimensionPanel(
  title: string,
  rows: Ga4DimensionRow[],
  columns: { header: string; cell: (r: Ga4DimensionRow, total: number) => string }[],
  statLine = ""
): string {
  if (rows.length === 0) return "";
  const total = dimensionTotal(rows);
  const head = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const body = rows
    .map(
      (r) => `<tr>${columns.map((c) => c.cell(r, total)).join("")}</tr>`
    )
    .join("");
  return (
    `<section class="panel"><span class="badge-src">GA4</span>` +
    `<h2>${escapeHtml(title)}</h2>` +
    statLine +
    `<table class="psg"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    `</section>`
  );
}

/** The four GA4 dimensional sections (12-05a), rendered only when data is present. */
function renderDimensionSections(dim: Ga4DimensionsReport): string {
  const sessionsCell = (r: Ga4DimensionRow) =>
    `<td class="tgt">${formatNumber(Math.round(r.sessions))}</td>`;
  const usersCell = (r: Ga4DimensionRow) =>
    `<td>${formatNumber(Math.round(r.users))}</td>`;
  const shareCell = (r: Ga4DimensionRow, total: number) =>
    `<td>${total > 0 ? formatRatioPct(r.sessions / total) : "n/a"}</td>`;
  const nameCell = (r: Ga4DimensionRow) =>
    `<td>${escapeHtml(r.name)}</td>`;

  // Two scalar KPIs surfaced above Traffic Drivers (omit each when absent).
  const statBits: string[] = [];
  if (dim.averageSessionDuration > 0) {
    statBits.push(`Avg. session duration ${formatDuration(dim.averageSessionDuration)}`);
  }
  if (dim.bounceRate !== null) {
    statBits.push(`Bounce rate ${formatRatioPct(dim.bounceRate)}`);
  }
  const statLine = statBits.length
    ? `<p class="src">${escapeHtml(statBits.join("  ·  "))}</p>`
    : "";

  const trafficDrivers = renderDimensionPanel(
    "Top traffic drivers",
    dim.topChannels,
    [
      { header: "Channel", cell: nameCell },
      { header: "Sessions", cell: sessionsCell },
      { header: "Users", cell: usersCell },
      { header: "Share", cell: shareCell },
    ],
    statLine
  );

  const landingPages = renderDimensionPanel(
    "Top landing pages",
    dim.topLandingPages,
    [
      {
        header: "Landing page",
        cell: (r) => `<td class="lp">${escapeHtml(r.name)}</td>`,
      },
      { header: "Sessions", cell: sessionsCell },
      {
        header: "Engagement rate",
        cell: (r) =>
          `<td>${
            typeof r.engagement_rate === "number"
              ? formatRatioPct(r.engagement_rate)
              : "n/a"
          }</td>`,
      },
    ]
  );

  const devices = renderDimensionPanel(
    "Device breakdown",
    dim.devices,
    [
      { header: "Device", cell: nameCell },
      { header: "Sessions", cell: sessionsCell },
      { header: "Share", cell: shareCell },
    ]
  );

  const newVsReturning = renderDimensionPanel(
    "New vs returning",
    dim.newVsReturning,
    [
      { header: "Segment", cell: nameCell },
      { header: "Sessions", cell: sessionsCell },
      { header: "Share", cell: shareCell },
    ]
  );

  return trafficDrivers + landingPages + devices + newVsReturning;
}

/** Milliseconds -> "N.N s" (e.g. 3200 -> "3.2 s"); null -> "n/a". For perf timings. */
function formatMsToS(ms: number | null): string {
  return ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`;
}

/** Bytes -> "N.N MB" / "N KB"; null -> "n/a". For GTMetrix page weight. */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return "n/a";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}

/** CLS to 3 dp; null -> "n/a". */
function formatCls(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

/** Performance-score band -> the canon tint class: good(>=90)=up, warn(50-89)="", danger(<50)=down. */
function scoreClass(score: number | null): string {
  if (score === null) return "";
  if (score >= 90) return "up";
  if (score < 50) return "down";
  return "";
}

/** One perf KPI stat card (reuses the canon .kpi structure). */
function perfKpi(value: string, sub: string, label: string, cls = ""): string {
  return (
    `<div class="kpi"><div class="n">${escapeHtml(value)}</div>` +
    `<div class="chg ${cls}">${escapeHtml(sub)}</div>` +
    `<div class="l">${escapeHtml(label)}</div></div>`
  );
}

/**
 * The "Website performance" block (12-05b) — REPLACES the old GA4 "Performance Status / server
 * response 14:49" panel with real PSI lab (+ GTMetrix when present) numbers and a CrUX field row
 * rendered ONLY when real-user data exists (else a "Lab data" label, never a blank field block).
 */
function renderPerformanceBlock(perf: PerformanceReport): string {
  const { psi, gtmetrix } = perf;
  const hasField = psi.field !== null;

  const badges =
    `<span class="badge-src">PageSpeed</span>` +
    (gtmetrix ? ` <span class="badge-src">GTMetrix</span>` : "");

  // LCP / CLS prefer the real-user field value when present, else the lab value.
  const lcpMs = hasField ? psi.field!.lcp_ms : psi.lab_lcp_ms;
  const cls = hasField ? psi.field!.cls : psi.lab_cls;
  // TTFB: GTMetrix backend_duration is the richest real measurement; else PSI server-response-time.
  const ttfbMs = gtmetrix?.backend_duration ?? psi.lab_ttfb_ms;

  const cards: string[] = [
    perfKpi(
      psi.perf_score === null ? "n/a" : String(psi.perf_score),
      hasField ? "Real-user + lab" : "Lab data",
      "Performance score",
      scoreClass(psi.perf_score)
    ),
    perfKpi(formatMsToS(lcpMs), hasField ? "Real-user" : "Lab", "Largest contentful paint"),
    perfKpi(formatCls(cls), hasField ? "Real-user" : "Lab", "Cumulative layout shift"),
    perfKpi(
      formatMsToS(ttfbMs),
      gtmetrix ? "GTMetrix backend" : "Lab server response",
      "Server response (TTFB)"
    ),
  ];
  if (gtmetrix) {
    cards.push(
      perfKpi(formatMsToS(gtmetrix.fully_loaded_time), "GTMetrix", "Fully loaded"),
      perfKpi(formatBytes(gtmetrix.page_bytes), "GTMetrix", "Page weight")
    );
  }

  // Field row only when CrUX real-user data is present.
  const fieldRow = hasField
    ? `<p class="src">Real-user data (CrUX)${
        psi.field!.overall_category
          ? ` &middot; ${escapeHtml(psi.field!.overall_category)}`
          : ""
      }: LCP ${escapeHtml(formatMsToS(psi.field!.lcp_ms))}, INP ${
        psi.field!.inp_ms === null ? "n/a" : `${Math.round(psi.field!.inp_ms)} ms`
      }, CLS ${escapeHtml(formatCls(psi.field!.cls))}.</p>`
    : `<p class="src">Lab data (Lighthouse). Real-user (CrUX) data is not yet available for this site.</p>`;

  return (
    `<section class="panel">${badges}` +
    `<h2>Website performance</h2>` +
    fieldRow +
    `<div class="kpis">${cards.join("")}</div>` +
    `</section>`
  );
}

/** Open-status display labels for the presence block (raw enum -> friendly). */
const PRESENCE_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  CLOSED_PERMANENTLY: "Permanently closed",
  CLOSED_TEMPORARILY: "Temporarily closed",
};

/**
 * The "Reviews and listing" block (13-03b) — the monthly GBP presence snapshot:
 * the lifetime star-rating aggregate + listing-completeness + the current listing
 * signals. Titled distinctly from the daily "Local presence" source panel
 * (SOURCE_META.gbp) so a shop with both rows does not get two same-titled panels.
 * averageRating null -> "n/a" (never a fabricated "0.0"); the rating is point-in-time
 * STOCK, so there is no MoM framing.
 */
function renderGbpPresenceBlock(presence: GbpPresenceReport): string {
  const ratingValue =
    presence.averageRating === null ? "n/a" : presence.averageRating.toFixed(1);
  const reviewsSub = `${presence.totalReviewCount ?? 0} reviews`;
  const completenessValue =
    typeof presence.completenessScore === "number"
      ? `${presence.completenessScore}%`
      : "n/a";

  const cards = [
    perfKpi(ratingValue, reviewsSub, "Average rating"),
    perfKpi(completenessValue, "Listing signals present", "Profile completeness"),
  ];

  const statusLabel =
    PRESENCE_STATUS_LABELS[presence.openStatus] ?? presence.openStatus;
  const metaBits: string[] = [];
  if (statusLabel) metaBits.push(`Status ${statusLabel}`);
  metaBits.push(`Primary category ${presence.primaryCategory ?? "Not set"}`);
  const metaLine = `<p class="src">${escapeHtml(metaBits.join("  ·  "))}</p>`;

  const signals = [
    `Hours ${presence.hasHours ? "listed" : "missing"}`,
    `Description ${presence.hasDescription ? "present" : "missing"}`,
    `Website ${presence.websiteUri ? "linked" : "missing"}`,
    `Phone ${presence.phonePresent ? "listed" : "missing"}`,
  ];
  const signalsLine = `<p class="src">Listing signals: ${escapeHtml(
    signals.join(", ")
  )}.</p>`;

  return (
    `<section class="panel"><span class="badge-src">Google Business Profile</span>` +
    `<h2>Reviews and listing</h2>` +
    metaLine +
    `<div class="kpis">${cards.join("")}</div>` +
    signalsLine +
    `</section>`
  );
}

/**
 * Render the full branded report HTML for one shop+month. Pure and deterministic
 * over (reportData, narrative). Only linked sources appear; cold-start sources are
 * framed within-period. Every visible numeral traces to reportData/narrative.
 */
export function renderReportHtml(
  reportData: ReportData,
  narrative: ReportNarrative
): string {
  const linked = SOURCE_ORDER.filter((s) => reportData.linkedSources.includes(s));
  const anyColdStart =
    reportData.sourcesWithPriorMonth.length < reportData.linkedSources.length;
  const status = anyColdStart ? "Initial results" : "Monthly report";
  const month = monthLabel(reportData.periodMonth);

  // Masthead.
  const masthead =
    `<header class="masthead"><div class="wrap">` +
    `<p class="eyebrow">Monthly marketing performance</p>` +
    `<h1>${escapeHtml(narrative.headline)}</h1>` +
    `<p class="sub">Your marketing performance across search, paid, and SEO for ${escapeHtml(
      month
    )}.</p>` +
    `<div class="meta">` +
    `<span><b>Window:</b> ${escapeHtml(formatShortDate(reportData.window.start))} to ${escapeHtml(
      formatShortDate(reportData.window.end)
    )}</span>` +
    `<span><b>Sources:</b> ${
      linked.map((s) => escapeHtml(SOURCE_META[s].badge)).join(", ") || "n/a"
    }</span>` +
    `<span><b>Status:</b> ${escapeHtml(status)}</span>` +
    `</div></div></header>`;

  // Story so far: KPI cards (linked only) + executive-summary callout.
  const kpiCards = KPI_SET.filter((k) => reportData.linkedSources.includes(k.source))
    .map((k) => renderKpi(reportData, k))
    .join("");
  const story =
    `<section class="panel"><h2>The story so far</h2>` +
    `<div class="kpis">${kpiCards}</div>` +
    `<div class="callout">${escapeHtml(narrative.executiveSummary)}</div></section>`;

  // Per-source sections: badge + title + trend bars + detail table.
  const sourceSections = linked
    .map((source) => {
      const block = reportData.sources[source] as SourceReportBlock;
      return (
        `<section class="panel"><span class="badge-src">${escapeHtml(
          SOURCE_META[source].badge
        )}</span>` +
        `<h2>${escapeHtml(SOURCE_META[source].title)}</h2>` +
        renderTrend(block) +
        renderSourceTable(block) +
        `</section>`
      );
    })
    .join("");

  // GA4 dimensional sections (12-05a): only when a dimensions block is present.
  const dimensionSections = reportData.dimensions
    ? renderDimensionSections(reportData.dimensions)
    : "";

  // Website performance block (12-05b): only when a performance block is present.
  const performanceBlock = reportData.performance
    ? renderPerformanceBlock(reportData.performance)
    : "";

  // GBP presence + reviews block (13-03b): only when a gbp_presence row is present.
  const gbpPresenceBlock = reportData.gbpPresence
    ? renderGbpPresenceBlock(reportData.gbpPresence)
    : "";

  // This month vs prior: one headline-KPI row per linked source.
  const momRows = KPI_SET.filter((k) => reportData.linkedSources.includes(k.source))
    .map((k) => {
      const block = reportData.sources[k.source] as SourceReportBlock;
      const hasPrior = reportData.sourcesWithPriorMonth.includes(k.source);
      const cur = formatValue(k.metric, block.current[k.metric] ?? null);
      const prior = hasPrior ? formatValue(k.metric, block.prior?.[k.metric] ?? null) : "n/a";
      const mom = block.momDelta[k.metric] ?? null;
      const cls = changeClass(mom);
      const change = hasPrior ? formatMom(mom) || "flat" : "Within period";
      return (
        `<tr><td>${escapeHtml(k.label)}</td>` +
        `<td class="now">${prior}</td>` +
        `<td class="tgt">${cur}</td>` +
        `<td class="${cls}">${escapeHtml(change)}</td></tr>`
      );
    })
    .join("");
  const momTable =
    `<section class="panel"><h2>This month vs prior</h2>` +
    `<table class="psg"><thead><tr><th>Metric</th><th>Prior month</th>` +
    `<th>This month</th><th>Change</th></tr></thead><tbody>${momRows}</tbody></table></section>`;

  // What is driving movement: one takeaway per linked source (narrative.sourceSummaries).
  const takeawayItems = linked
    .map((source) => {
      const summary = narrative.sourceSummaries[source];
      if (!summary) return "";
      return `<li><b>${escapeHtml(SOURCE_META[source].badge)}.</b> ${escapeHtml(summary)}</li>`;
    })
    .filter(Boolean)
    .join("");
  const drivers = takeawayItems
    ? `<section class="panel"><h2>What is driving movement</h2>` +
      `<ul class="takeaways">${takeawayItems}</ul></section>`
    : "";

  // Recommendations.
  const recItems = narrative.recommendations
    .map((r) => `<li>${escapeHtml(r)}</li>`)
    .join("");
  const recommendations = recItems
    ? `<section class="panel"><h2>Recommendations</h2>` +
      `<ul class="takeaways">${recItems}</ul></section>`
    : "";

  // Sources and method.
  const sources =
    `<section class="panel"><h2>Sources and method</h2>` +
    `<p class="src">Prepared from your connected marketing data sources: ${
      linked.map((s) => escapeHtml(SOURCE_META[s].badge)).join(", ") || "n/a"
    }. Figures are rolled up monthly from daily measurements. Month-over-month change compares this month to the prior calendar month; sources without a clean prior month are framed within the current period.</p></section>`;

  // Footer.
  const footer =
    `<footer class="psg"><div class="wrap"><p>` +
    `Prepared by Phoenix Solutions Group &nbsp;&middot;&nbsp; Monthly marketing performance report &nbsp;&middot;&nbsp; ${escapeHtml(
      dateLabel(reportData.generatedAt)
    )}</p></div></footer>`;

  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>Monthly Marketing Report ${escapeHtml(month)}</title>` +
    styleBlock() +
    `</head><body>` +
    masthead +
    `<div class="wrap">` +
    story +
    sourceSections +
    dimensionSections +
    performanceBlock +
    gbpPresenceBlock +
    momTable +
    drivers +
    recommendations +
    sources +
    `</div>` +
    footer +
    `</body></html>`
  );
}
