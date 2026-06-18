/**
 * v1.2 Ads Mutation Studio — shared types.
 *
 * The Studio surfaces the shipped `apps/psg-ads-mutations/` Python (Google Ads + GTM)
 * write-side tooling through a web UI. These types are the contract between the web
 * UI, the governance layer, and the Python-worker bridge. They are gate-independent:
 * no ops shell and no live Vercel Sandbox is required to type-check or unit-test them.
 */

export type AdsPlatform = "google_ads" | "gtm";

/** Mode mirrors the Python CLI: `--dry-run` (default, safe) vs `--execute`. */
export type MutationMode = "dry_run" | "execute";

/**
 * Risk classification drives governance. `high` mutations require superadmin/board
 * approval before `execute` (per PSG-26 scope). `low` = additive/restrictive only;
 * `medium` = changes structure but not directly spend; `high` = direct spend/bidding/
 * measurement impact or destructive/publishing actions.
 */
export type MutationRiskLevel = "low" | "medium" | "high";

/**
 * The required target identifier. Governance demands a target on every mutation
 * ("customer-id required"). Google Ads ops key on the customer id; GTM ops key on
 * the container public id.
 */
export type TargetKind = "google_ads_customer_id" | "gtm_container_id";

export interface MutationParamSpec {
  name: string;
  type: "string" | "int" | "float" | "bool" | "string[]" | "object[]";
  required: boolean;
  description: string;
}

export interface MutationTargetSpec {
  kind: TargetKind;
  /** The Python keyword arg name this target maps to (e.g. "customer_id"). */
  param: string;
  required: true;
}

/**
 * One UI-selectable mutation, mapped to a concrete Python entry point in
 * `apps/psg-ads-mutations/`. `fetchFn` produces the before-state for the dry-run diff;
 * `applyFn` performs the change (invoked with dry_run honoring the Python default).
 */
export interface MutationDef {
  /** Stable unique id, e.g. "google_ads.campaign_bidding". */
  key: string;
  platform: AdsPlatform;
  /** Importable Python module, e.g. "googleads_psg.mutations.campaign_bidding". */
  pythonModule: string;
  /** Before-state reader for the diff; null when the op has no readable prior state. */
  fetchFn: string | null;
  /** The mutating callable, e.g. "apply_changes". */
  applyFn: string;
  label: string;
  description: string;
  riskLevel: MutationRiskLevel;
  target: MutationTargetSpec;
  params: MutationParamSpec[];
}

/** A request to run a registered mutation through the bridge. */
export interface MutationRequest {
  mutationKey: string;
  mode: MutationMode;
  /** Customer id (Google Ads) or container public id (GTM). */
  targetRef: string;
  params: Record<string, unknown>;
  /** Set by the route from the session; used for audit + rate-limit scoping. */
  requestedBy?: string;
  shopId?: string;
  /** Approval ref required for high-risk `execute`. */
  approvalId?: string;
}

/** Structured before/after diff returned by a dry run or execute. */
export interface MutationDiff {
  before: unknown;
  requestedChanges: unknown;
  after: unknown;
}

export interface DryRunResult extends MutationDiff {
  jobId: string;
  /** Supabase Storage path to the mirrored Python log JSON, when written. */
  logsStoragePath?: string;
}

export interface ExecuteResult extends MutationDiff {
  jobId: string;
  auditLogId?: string;
  logsStoragePath?: string;
}
