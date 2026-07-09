// Phase 12 / 12-02 — Narrative orchestrator (writer -> eval -> fail-ladder).
// The single entry point 12-03/12-04 call. Guarantees the returned narrative has
// cleared the eval gate, or returns a hold (never a false pass). Ladder:
//   1. write -> substitute -> evaluate. Pass -> return (source: "model").
//   2. on block: regenerate up to maxRetries with the violations quoted back.
//   3. still blocked: deterministic template (numbers injected, never generated,
//      so it passes Stage B by construction) -> return (source: "template").
//   4. even the template fails (e.g. zero linked sources) -> hold for human.

import { writeNarrative, type WriteDeps } from "./narrative";
import { buildPlaceholders, substituteNarrative } from "./prompt";
import { evaluateReport, type Violation } from "./evaluate";
import type { ReportNarrative } from "./schema";
import type { ReportData } from "./types";

export type GenerateOutcome = {
  verdict: "pass" | "hold";
  narrative: ReportNarrative | null;
  source: "model" | "template" | "hold";
  violations: Violation[];
};

/**
 * Deterministic template: assembles section text by injecting the real formatted
 * values from ReportData (never model-generated). It uses no direction words and
 * only allowed numerals, so it passes the eval gate by construction and is always
 * truthful. The safety net when the model cannot produce a clean draft.
 */
export function renderTemplateNarrative(reportData: ReportData): ReportNarrative {
  const { values } = buildPlaceholders(reportData);
  const sourceSummaries: ReportNarrative["sourceSummaries"] = {};

  for (const source of reportData.linkedSources) {
    const block = reportData.sources[source];
    if (!block) continue;
    const parts = Object.keys(block.current).map((key) => {
      const v = values[`${source}_${key}`];
      const mom = values[`${source}_${key}_mom`];
      return `${key} ${v} (month over month ${mom})`;
    });
    sourceSummaries[source] = `Reported this month: ${parts.join("; ")}.`;
  }

  return {
    headline: "Your monthly marketing performance summary.",
    executiveSummary:
      "Here is your shop's performance for the period across your linked sources. The figures below are pulled directly from your connected accounts.",
    sourceSummaries,
    recommendations: [
      "Review the figures above and prioritize the channel with the weakest month over month movement.",
    ],
  };
}

/**
 * Generate a verified narrative for a shop's month. Never returns verdict "pass"
 * for a narrative that did not clear the gate.
 */
export async function generateNarrative(
  reportData: ReportData,
  deps: WriteDeps,
  maxRetries = 2
): Promise<GenerateOutcome> {
  if (reportData.linkedSources.length === 0) {
    return {
      verdict: "hold",
      narrative: null,
      source: "hold",
      violations: [{ code: "schema", detail: "no linked sources to report" }],
    };
  }

  const { values } = buildPlaceholders(reportData);
  let lastViolations: Violation[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let raw: ReportNarrative;
    try {
      raw = await writeNarrative(
        reportData,
        deps,
        attempt === 0 ? undefined : lastViolations.map((v) => v.detail)
      );
    } catch (err) {
      lastViolations = [
        {
          code: "schema",
          detail: `writer unavailable: ${err instanceof Error ? err.message : String(err)}`,
        },
      ];
      break;
    }
    const substituted = substituteNarrative(raw, values);
    const result = evaluateReport(substituted, reportData);
    if (result.verdict === "pass") {
      return { verdict: "pass", narrative: substituted, source: "model", violations: [] };
    }
    lastViolations = result.violations;
  }

  // Fail ladder: deterministic template (always truthful, passes by construction).
  const template = renderTemplateNarrative(reportData);
  const templateResult = evaluateReport(template, reportData);
  if (templateResult.verdict === "pass") {
    return { verdict: "pass", narrative: template, source: "template", violations: lastViolations };
  }

  // Even the template could not be assembled cleanly -> hold for human.
  return { verdict: "hold", narrative: null, source: "hold", violations: templateResult.violations };
}
