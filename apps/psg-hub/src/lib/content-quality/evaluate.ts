// BSM Content-Quality Standard v1 — machine-check evaluator (PSG-752).
//
// The single automated entry point that runs the standard's machine-checkable
// gates against a Content Writer draft:
//   - C1 (honest claims) + C6 (reviews gatekeeper) — via the extended
//     `checkClaimIntegrity` trust gate (see ../claim-integrity), which
//     `gateGeneratedAsset` already runs. Every existing caller of that gate
//     therefore enforces C1/C6 automatically; this evaluator additionally layers:
//   - C2 (one conversion job) — the structural check on the draft
//     (./conversion-structure).
// and surfaces the human-review checks (C8 brand-voice, C10 inclusive
// representation) the standard leaves to a person, so a reviewer always sees what
// still needs a human eye before SHIP.
//
// Pure; node-testable. No I/O.

import { gateGeneratedAsset, type GeneratedAsset } from "@/lib/agent-engine";
import type { ClaimIntegrityResult, VerifiedFacts, Verdict, Violation } from "@/lib/claim-integrity";
import { checkConversionStructure } from "./conversion-structure";
import { HUMAN_REVIEW_CHECKS, type ContentQualityCheck } from "./standard";

export type ContentQualityResult = {
  /** Overall machine verdict: `reject` when any hard check fails, else `ship`. */
  verdict: Verdict;
  hardFail: boolean;
  /** C1 + C6 (and the pre-existing Check-2 denylist/manifest) verdict. */
  claimIntegrity: ClaimIntegrityResult;
  /** C2 conversion-structure violations (empty for non-shop-page content). */
  conversionStructure: Violation[];
  /** All machine violations flattened (C1 + C2 + C6). */
  violations: Violation[];
  /** Checks the standard leaves to the human reviewer (C8, C10). */
  humanReview: readonly ContentQualityCheck[];
};

/**
 * Evaluate a generated draft against the machine-checkable half of the BSM
 * Content-Quality Standard v1 (C1, C2, C6). Any hard-check violation ⇒
 * `verdict: "reject"`, `hardFail: true` — no "pass with notes", consistent with
 * the claim-integrity trust gate. A clean draft returns `ship` with the
 * human-review checklist still to be run by a person.
 */
export function evaluateContentQuality(
  asset: GeneratedAsset,
  facts: VerifiedFacts,
): ContentQualityResult {
  const claimIntegrity = gateGeneratedAsset(asset, facts).result;
  const conversionStructure = checkConversionStructure(asset);
  const violations = [...claimIntegrity.violations, ...conversionStructure];
  const hardFail = violations.length > 0;
  return {
    verdict: hardFail ? "reject" : "ship",
    hardFail,
    claimIntegrity,
    conversionStructure,
    violations,
    humanReview: HUMAN_REVIEW_CHECKS,
  };
}

/**
 * Collapse a `ContentQualityResult` into a single `ClaimIntegrityResult`-shaped
 * record so a caller can persist ONE machine verdict (spanning C1/C2/C6) in the
 * existing `claim_integrity_verdict` slot without changing the persistence shape.
 */
export function toRecordedVerdict(result: ContentQualityResult): ClaimIntegrityResult {
  return {
    verdict: result.verdict,
    hardFail: result.hardFail,
    violations: result.violations,
  };
}

/** True when a draft cleared every machine check and may proceed to human review. */
export function isMachinePassing(result: ContentQualityResult): boolean {
  return result.verdict === "ship" && !result.hardFail;
}
