// Wave 1C / PSG-227 — Shared tuning constants for the SEO auditor + scorer.
// Kept in one place so the rule thresholds and the health-score weights are a
// single source of truth across auditor.ts (rules) and report.ts (scoring).

import type { FindingSeverity } from "./types";

/** Below this visible word count a page is "thin content" (Improve). */
export const THIN_CONTENT_WORDS = 300;

/** Health-score penalty per finding, by severity. Score starts at 100. */
export const SEVERITY_PENALTY: Record<FindingSeverity, number> = {
  critical: 25,
  high: 12,
  medium: 6,
  low: 2,
};

/** Letter-grade thresholds on the 0–100 health score (inclusive lower bound). */
export const GRADE_THRESHOLDS: { min: number; grade: "A" | "B" | "C" | "D" }[] = [
  { min: 90, grade: "A" },
  { min: 80, grade: "B" },
  { min: 70, grade: "C" },
  { min: 60, grade: "D" },
];
