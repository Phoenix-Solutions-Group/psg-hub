// BSM Content-Quality Standard v1 — public surface (PSG-752).
//
// The Content Writer agent (Wren) and the app import from here:
//   - `buildDraftingGuidance()` for the drafting prompt (C3–C5, C7, C9 self-checks)
//   - `evaluateContentQuality()` to run the machine gates (C1, C2, C6) on a draft
//   - `buildHumanReviewChecklist()` / `HUMAN_REVIEW_CHECKS` to surface C8/C10
// The machine gates compose the extended claim-integrity trust gate (C1/C6) with
// the conversion-structure check (C2). Source of truth: PSG-746 standard doc.

export {
  CONTENT_QUALITY_CHECKS,
  DRAFTING_SELF_CHECKS,
  HUMAN_REVIEW_CHECKS,
  MACHINE_CHECKS,
  ONE_JOB_RULE,
  buildDraftingGuidance,
  buildHumanReviewChecklist,
  type ContentQualityCheck,
  type CheckTier,
  type CheckEnforcement,
} from "./standard";
export { checkConversionStructure } from "./conversion-structure";
export {
  evaluateContentQuality,
  toRecordedVerdict,
  isMachinePassing,
  type ContentQualityResult,
} from "./evaluate";
