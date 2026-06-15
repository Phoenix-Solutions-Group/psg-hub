// Phase 12 / 12-02 — Prompt construction + token-substitution grounding.
// The static system/brand block is cache-stable (same across all shops in a run);
// the per-shop user block lists the linked sources and the placeholder catalogue
// derived from ReportData. The writer emits {{placeholder}} tokens; after
// generation, substitutePlaceholders swaps in the real formatted values, so a
// number can only appear in the report if it came from ReportData.

import { formatNumber } from "../analytics/aggregate";
import type { AnalyticsSource } from "../analytics/types";
import type { ReportData, SourceReportBlock } from "./types";

const SOURCE_LABELS: Record<AnalyticsSource, string> = {
  ga4: "Google Analytics (website traffic)",
  gsc: "Google Search Console (organic search)",
  google_ads: "Google Ads (paid)",
  semrush: "SEMrush (organic SEO)",
  gbp: "Google Business Profile (local presence + actions)",
};

/** Ratio metrics rendered as percentages; everything else as a grouped number. */
const RATIO_KEYS = new Set(["ctr", "engagement_rate"]);

/** Format a raw metric value for display (null -> em-dash-free "n/a"). */
function formatValue(key: string, value: number | null): string {
  if (value === null) return "n/a";
  if (RATIO_KEYS.has(key)) return `${(value * 100).toFixed(1)}%`;
  if (key === "position") return value.toFixed(1);
  if (key === "cpl" || key === "spend" || key === "organic_traffic_cost") {
    return `$${formatNumber(Math.round(value))}`;
  }
  return formatNumber(Math.round(value));
}

/** Format a MoM ratio as a signed percentage ("+20%", "-5%", "flat"). */
function formatMom(ratio: number | null): string {
  if (ratio === null) return "n/a";
  const pct = Math.round(ratio * 100);
  if (pct === 0) return "flat";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * Build the placeholder -> value map and the human-readable catalogue.
 * Keys: `${source}_${metric}` (current value) and `${source}_${metric}_mom`
 * (month-over-month). Only LINKED sources and present metrics are emitted.
 */
export function buildPlaceholders(reportData: ReportData): {
  values: Record<string, string>;
  catalogue: string[];
} {
  const values: Record<string, string> = {};
  const catalogue: string[] = [];

  for (const source of reportData.linkedSources) {
    const block = reportData.sources[source] as SourceReportBlock;
    for (const [key, value] of Object.entries(block.current)) {
      const base = `${source}_${key}`;
      values[base] = formatValue(key, value);
      catalogue.push(`{{${base}}} = ${values[base]} (${source} ${key}, this month)`);

      const mom = block.momDelta[key] ?? null;
      const momKey = `${base}_mom`;
      values[momKey] = formatMom(mom);
      catalogue.push(`{{${momKey}}} = ${values[momKey]} (${source} ${key}, vs prior month)`);
    }
  }

  return { values, catalogue };
}

/** Replace every {{key}} with its value; unknown tokens are left intact for the eval gate to flag. */
export function substitutePlaceholders(
  text: string,
  values: Record<string, string>
): string {
  return text.replace(/\{\{([a-z0-9_]+)\}\}/gi, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}

/** Recursively substitute placeholders across every string field of the narrative object. */
export function substituteNarrative<T>(node: T, values: Record<string, string>): T {
  if (typeof node === "string") return substitutePlaceholders(node, values) as T;
  if (Array.isArray(node)) return node.map((n) => substituteNarrative(n, values)) as T;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = substituteNarrative(v, values);
    return out as T;
  }
  return node;
}

/** Cache-stable system + brand block (identical across all shops in a run). */
export function buildSystemPrompt(): string {
  return [
    "You are PSG's marketing analyst writing a shop's monthly performance report.",
    "Write for a collision-repair business owner: clear, direct, practical.",
    "HARD RULES: no em dashes anywhere; no emojis; active voice; plain language; no metaphors or cliches.",
    "GROUNDING RULE: you may reference a metric ONLY by its {{placeholder}} token. Never write a literal number, percentage, or dollar amount yourself. The placeholders are substituted with real values after you write.",
    "Only discuss sources listed as linked for this shop. Do not invent metrics or sources.",
  ].join("\n");
}

/** Per-shop user block: the linked sources + the placeholder catalogue. */
export function buildUserPrompt(reportData: ReportData, violations?: string[]): string {
  const { catalogue } = buildPlaceholders(reportData);
  const lines = [
    `Report month: ${reportData.periodMonth}.`,
    `Linked sources: ${reportData.linkedSources.map((s) => SOURCE_LABELS[s]).join(", ") || "none"}.`,
    reportData.sourcesWithPriorMonth.length < reportData.linkedSources.length
      ? "Some sources have no prior month; frame those as early-progress within the period rather than month-over-month."
      : "",
    "",
    "Available placeholders (use these tokens verbatim, never the raw values):",
    ...catalogue,
    "",
    "Write the headline, executive summary, one paragraph per linked source, and 2 to 4 recommendations.",
  ];
  if (violations && violations.length > 0) {
    lines.push(
      "",
      "Your previous draft was REJECTED for these reasons. Fix them and do not introduce any literal numbers:",
      ...violations.map((v) => `- ${v}`)
    );
  }
  return lines.filter(Boolean).join("\n");
}
