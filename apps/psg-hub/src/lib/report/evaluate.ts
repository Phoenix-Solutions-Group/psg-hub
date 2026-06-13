// Phase 12 / 12-02 — Report eval gate.
// Cheap-deterministic-first cascade run AFTER narrative generation, BEFORE any PDF
// render. No report is rendered from an un-passed narrative. Operates on the
// SUBSTITUTED narrative object (placeholders already swapped for real values).
//
//   Stage A  schema      — required sections present + non-empty.
//   Stage B  groundedness — THE gate. Every numeral must trace to ReportData;
//                           wrong-direction (F2) and cross-source mis-attribution
//                           (F3) are blocks. Threshold 100%.
//   Stage C  brand lint   — em dash / emoji / stray placeholder = hard block.
//   Stage D  LLM judge    — interface present, SKIPPED in v1.

import type { AnalyticsSource } from "../analytics/types";
import { buildPlaceholders } from "./prompt";
import type { ReportNarrative } from "./schema";
import type { ReportData } from "./types";

export type Violation = {
  code: "F1" | "F2" | "F3" | "schema" | "brand";
  detail: string;
};

export type EvalResult = {
  verdict: "pass" | "block";
  violations: Violation[];
  judge: null; // Stage D skipped in v1
};

/** Optional LLM judge hook (Stage D) — a different model family from the writer. */
export type LLMJudge = (
  narrative: ReportNarrative,
  reportData: ReportData
) => Promise<{ scores: Record<string, number>; pass: boolean }>;

const UP_WORDS = ["up", "rose", "grew", "increase", "increased", "gained", "higher", "climbed"];
const DOWN_WORDS = ["down", "fell", "dropped", "decrease", "decreased", "lost", "lower", "declined", "slipped"];
// Emoji + pictographic ranges (covers the common blocks; we only need a hard gate).
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/u;
const DASH = /[—–]/; // em dash, en dash
const STRAY_PLACEHOLDER = /\{\{[a-z0-9_]+\}\}/i;
const NUMERAL = /[-+]?\$?\d[\d,]*(?:\.\d+)?%?/g;
const SIGNED_PCT = /[-+]\d+%/g;

// Canonical source names, longest-first so the two-token "google_ads" is matched
// before any single-token prefix. Placeholder keys are `${source}_${metric}`, so a
// naive split on "_" mis-files google_ads_* under "google" (F3 false positives).
const SOURCE_NAMES: AnalyticsSource[] = ["google_ads", "semrush", "ga4", "gsc"];

/** Resolve the source prefix of a placeholder key (`google_ads_spend` -> "google_ads"). */
function sourceOfKey(key: string): string {
  return SOURCE_NAMES.find((s) => key === s || key.startsWith(`${s}_`)) ?? key.split("_")[0];
}

/** Normalize a numeral token for set membership ("$1,500" -> "1500", "+20%" -> "+20%"). */
function norm(token: string): string {
  return token.replace(/[$,]/g, "");
}

/** Allowed numeral set per source (current + MoM, normalized) plus the global union. */
function buildAllowedNumbers(reportData: ReportData): {
  bySource: Record<string, Set<string>>;
  global: Set<string>;
} {
  const { values } = buildPlaceholders(reportData);
  const bySource: Record<string, Set<string>> = {};
  const global = new Set<string>();

  for (const [key, formatted] of Object.entries(values)) {
    if (formatted === "n/a" || formatted === "flat") continue;
    const source = sourceOfKey(key);
    const tokens = formatted.match(NUMERAL) ?? [];
    for (const tok of tokens) {
      const n = norm(tok);
      (bySource[source] ??= new Set<string>()).add(n);
      global.add(n);
    }
  }
  return { bySource, global };
}

/** Check one text segment's numerals against its allowed set (F1 / F3). */
function checkNumerals(
  text: string,
  allowed: Set<string>,
  global: Set<string>,
  where: string,
  violations: Violation[]
): void {
  for (const tok of text.match(NUMERAL) ?? []) {
    const n = norm(tok);
    if (allowed.has(n)) continue;
    if (global.has(n)) {
      violations.push({ code: "F3", detail: `${where}: number "${tok}" belongs to a different source` });
    } else {
      violations.push({ code: "F1", detail: `${where}: fabricated number "${tok}" not in the report data` });
    }
  }
}

/** Direction check (F2): a signed percentage whose sign contradicts an adjacent direction word. */
function checkDirection(text: string, where: string, violations: Violation[]): void {
  const lower = text.toLowerCase();
  for (const m of text.matchAll(SIGNED_PCT)) {
    const idx = m.index ?? 0;
    const window = lower.slice(Math.max(0, idx - 40), idx + (m[0]?.length ?? 0) + 40);
    const isNeg = m[0].startsWith("-");
    const hasUp = UP_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(window));
    const hasDown = DOWN_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(window));
    if (isNeg && hasUp && !hasDown) {
      violations.push({ code: "F2", detail: `${where}: "${m[0]}" described with an upward word` });
    } else if (!isNeg && hasDown && !hasUp) {
      violations.push({ code: "F2", detail: `${where}: "${m[0]}" described with a downward word` });
    }
  }
}

/** Brand lint (Stage C): em dash / emoji / stray placeholder = hard block. */
function checkBrandStyle(text: string, where: string, violations: Violation[]): void {
  if (DASH.test(text)) violations.push({ code: "brand", detail: `${where}: contains an em/en dash` });
  if (EMOJI.test(text)) violations.push({ code: "brand", detail: `${where}: contains an emoji` });
  if (STRAY_PLACEHOLDER.test(text)) violations.push({ code: "brand", detail: `${where}: unresolved {{placeholder}}` });
}

/**
 * Evaluate a SUBSTITUTED narrative against its ReportData. Returns block on any
 * Stage A/B/C violation (threshold 100% on groundedness). Stage D is v1-skipped.
 */
export function evaluateReport(narrative: ReportNarrative, reportData: ReportData): EvalResult {
  const violations: Violation[] = [];
  const { bySource, global } = buildAllowedNumbers(reportData);

  // Stage A — schema / required sections.
  if (!narrative.headline?.trim()) violations.push({ code: "schema", detail: "missing headline" });
  if (!narrative.executiveSummary?.trim()) violations.push({ code: "schema", detail: "missing executive summary" });
  if (!Array.isArray(narrative.recommendations) || narrative.recommendations.length === 0) {
    violations.push({ code: "schema", detail: "missing recommendations" });
  }
  for (const source of reportData.linkedSources) {
    if (!narrative.sourceSummaries?.[source]?.trim()) {
      violations.push({ code: "schema", detail: `missing summary for linked source ${source}` });
    }
  }

  // Cross-section text: headline + exec summary + recommendations check against the GLOBAL set.
  const globalSegments: Array<[string, string]> = [
    ["headline", narrative.headline ?? ""],
    ["executiveSummary", narrative.executiveSummary ?? ""],
    ...(narrative.recommendations ?? []).map(
      (r, i) => [`recommendation ${i + 1}`, r] as [string, string]
    ),
  ];
  for (const [where, text] of globalSegments) {
    checkNumerals(text, global, global, where, violations); // global vs global: only F1 possible
    checkDirection(text, where, violations);
    checkBrandStyle(text, where, violations);
  }

  // Per-source summaries check against the SOURCE-specific set (so a GA4 number in a
  // GSC sentence is F3 mis-attribution).
  for (const source of Object.keys(narrative.sourceSummaries ?? {}) as AnalyticsSource[]) {
    const text = narrative.sourceSummaries[source];
    if (!text) continue;
    const allowed = bySource[source] ?? new Set<string>();
    const where = `${source} summary`;
    checkNumerals(text, allowed, global, where, violations);
    checkDirection(text, where, violations);
    checkBrandStyle(text, where, violations);
  }

  return { verdict: violations.length === 0 ? "pass" : "block", violations, judge: null };
}
