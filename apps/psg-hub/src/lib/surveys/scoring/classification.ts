/**
 * FileMaker-parity survey alert classification.
 *
 * Mirrors the Advantage Survey Input `SQ_Alert_*_post` gate order captured in
 * docs/specs/001-filemaker-advantage-integration. Keep this pure so survey
 * ingest, reports, and eligibility suppression can share one source of truth.
 */

export type SurveyAlertClass =
  | "perfect"
  | "misfire"
  | "hotspot"
  | "unresolved"
  | "referral"
  | "none";

export interface SurveyAlertClassificationInput {
  /** FileMaker `csi_resolve`: 1 means perfect; values below 1 are non-perfect. */
  csiResolve?: number | string | null;
  /** Customer would recommend/refer the shop. */
  wouldRecommend?: boolean | null;
  /** Customer flagged an unresolved shop issue. */
  unresolvedShop?: boolean | null;
  /** Survey noted a referral consumer. */
  referralConsumer?: boolean | null;
  /** Company participates in referral tracking. Default-deny when absent. */
  referralTrackingEnabled?: boolean | null;
  /** Customer/company is on credit hold. True blocks referral classification. */
  creditHold?: boolean | null;
}

function finiteNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify one survey into exactly one FileMaker alert class.
 *
 * Gate order is load-bearing:
 * 1. happy referral with referral tracking on and no credit hold -> referral
 * 2. happy perfect score -> perfect
 * 3. happy non-perfect score -> misfire
 * 4. unresolved shop issue -> unresolved
 * 5. negative/non-perfect score -> hotspot
 * 6. otherwise -> none
 */
export function classifySurveyAlert(input: SurveyAlertClassificationInput): SurveyAlertClass {
  const csiResolve = finiteNumber(input.csiResolve);
  const unresolvedShop = input.unresolvedShop === true;
  const happy = input.wouldRecommend === true && !unresolvedShop;

  if (
    happy &&
    input.referralConsumer === true &&
    input.referralTrackingEnabled === true &&
    input.creditHold !== true
  ) {
    return "referral";
  }

  if (happy && csiResolve === 1) return "perfect";
  if (happy && csiResolve !== null && csiResolve < 1) return "misfire";
  if (unresolvedShop) return "unresolved";
  if (csiResolve !== null && csiResolve < 1) return "hotspot";
  return "none";
}

/** Alias matching the SDD example name. */
export const classifySurvey = classifySurveyAlert;
