/**
 * v1.2 Ads Mutation Studio — mutation registry.
 *
 * The single source of truth mapping UI-selectable mutations to the shipped Python
 * entry points in `apps/psg-ads-mutations/`. Risk levels and targets here drive the
 * governance layer (governance.ts) and the dry-run/execute UI. Keep this in sync with
 * the Python modules; the registry tests assert the structural invariants.
 *
 * Risk rubric:
 *   low    — additive/restrictive only, no direct spend change (e.g. negatives, asset create)
 *   medium — changes structure/targeting reach but not bid math directly
 *   high   — direct spend/bidding/measurement impact, destructive, or live-publishing
 *            => requires superadmin/board approval before execute (PSG-26 scope)
 */
import type { MutationDef } from "./types";

const GOOGLE_ADS_TARGET = {
  kind: "google_ads_customer_id",
  param: "customer_id",
  required: true,
} as const;

const GTM_TARGET = {
  kind: "gtm_container_id",
  param: "container_public_id",
  required: true,
} as const;

export const MUTATION_REGISTRY: readonly MutationDef[] = [
  // ── Google Ads ─────────────────────────────────────────────────────────────
  {
    key: "google_ads.negative_keywords",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.negative_keywords",
    fetchFn: "fetch_existing_negatives",
    applyFn: "add_campaign_negatives",
    label: "Add campaign negative keywords",
    description:
      "Add campaign-level negative KeywordInfo criteria. Restrictive only — reduces wasted spend, never expands it.",
    riskLevel: "low",
    target: GOOGLE_ADS_TARGET,
    params: [
      { name: "campaign_id", type: "int", required: true, description: "Target campaign id." },
      {
        name: "negatives",
        type: "object[]",
        required: true,
        description: "[{ text, match_type: EXACT|PHRASE|BROAD }]",
      },
    ],
  },
  {
    key: "google_ads.assets",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.assets",
    fetchFn: null,
    applyFn: "create_sitelink_assets",
    label: "Create ad assets (sitelink / callout / snippet / call / image)",
    description:
      "Create extension assets. Additive; linking/removal of assets is a separate higher-risk op.",
    riskLevel: "low",
    target: GOOGLE_ADS_TARGET,
    params: [
      {
        name: "asset_type",
        type: "string",
        required: true,
        description: "sitelink | callout | structured_snippet | call | image",
      },
      { name: "specs", type: "object[]", required: true, description: "Asset spec list (see Python dataclasses)." },
    ],
  },
  {
    key: "google_ads.geo_targets",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.geo_targets",
    fetchFn: "fetch_campaign_locations",
    applyFn: "add_campaign_locations",
    label: "Add campaign geo targets",
    description:
      "Add location targeting criteria to a campaign. Expands reach and therefore spend exposure.",
    riskLevel: "medium",
    target: GOOGLE_ADS_TARGET,
    params: [
      { name: "campaign_id", type: "int", required: true, description: "Target campaign id." },
      { name: "geo_target_ids", type: "string[]", required: true, description: "Geo target constant ids." },
    ],
  },
  {
    key: "google_ads.campaign_bidding",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.campaign_bidding",
    fetchFn: "fetch_state",
    applyFn: "apply_changes",
    label: "Change campaign bidding strategy",
    description:
      "Switch bidding strategy / target CPA / target ROAS. Direct, immediate spend impact.",
    riskLevel: "high",
    target: GOOGLE_ADS_TARGET,
    params: [
      { name: "changes", type: "object[]", required: true, description: "[{ campaign_id, strategy, target_cpa_micros?, target_roas? }]" },
    ],
  },
  {
    key: "google_ads.campaign_device_bids",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.campaign_device_bids",
    fetchFn: "fetch_state",
    applyFn: "apply_changes",
    label: "Change campaign device bid modifiers",
    description: "Adjust per-device bid modifiers. Direct spend impact across devices.",
    riskLevel: "high",
    target: GOOGLE_ADS_TARGET,
    params: [
      { name: "changes", type: "object[]", required: true, description: "[{ campaign_id, device, bid_modifier }]" },
    ],
  },
  {
    key: "google_ads.campaign_network",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.campaign_network",
    fetchFn: "fetch_state",
    applyFn: "apply_changes",
    label: "Change campaign network settings",
    description:
      "Toggle search/search-partner/content/partner-search network targeting. Reach + spend impact.",
    riskLevel: "high",
    target: GOOGLE_ADS_TARGET,
    params: [
      { name: "changes", type: "object[]", required: true, description: "[{ campaign_id, target_*: bool }]" },
    ],
  },
  {
    key: "google_ads.conversion_actions",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.conversion_actions",
    fetchFn: "fetch_state",
    applyFn: "apply_changes",
    label: "Change conversion actions",
    description:
      "Edit conversion action counting / inclusion / default value. Alters bidding signals account-wide.",
    riskLevel: "high",
    target: GOOGLE_ADS_TARGET,
    params: [
      { name: "changes", type: "object[]", required: true, description: "[{ conversion_action_id, ... }]" },
    ],
  },
  {
    key: "google_ads.customer_conversion_goals",
    platform: "google_ads",
    pythonModule: "googleads_psg.mutations.customer_conversion_goals",
    fetchFn: "fetch_state",
    applyFn: "apply_changes",
    label: "Change customer conversion goals",
    description:
      "Edit account-level conversion goal biddability. Account-wide bidding-signal impact.",
    riskLevel: "high",
    target: GOOGLE_ADS_TARGET,
    params: [
      { name: "changes", type: "object[]", required: true, description: "[{ category, origin, biddable }]" },
    ],
  },
  // ── Google Tag Manager ─────────────────────────────────────────────────────
  {
    key: "gtm.tag_paused",
    platform: "gtm",
    pythonModule: "gtm_psg.mutations.tags",
    fetchFn: "list_tags",
    applyFn: "set_tag_paused",
    label: "Pause / unpause GTM tag",
    description:
      "Pause or unpause a container tag. Affects live tracking/measurement; requires a publish to take effect.",
    riskLevel: "high",
    target: GTM_TARGET,
    params: [
      { name: "tag_name", type: "string", required: true, description: "Tag display name." },
      { name: "paused", type: "bool", required: true, description: "true to pause, false to unpause." },
    ],
  },
  {
    key: "gtm.publish_version",
    platform: "gtm",
    pythonModule: "gtm_psg.mutations.tags",
    fetchFn: null,
    applyFn: "create_version_and_publish",
    label: "Publish GTM container version",
    description:
      "Create and publish a new container version — goes live immediately to all site visitors.",
    riskLevel: "high",
    target: GTM_TARGET,
    params: [
      { name: "notes", type: "string", required: true, description: "Version notes / change summary." },
    ],
  },
] as const;

/** Look up a mutation by its registry key. */
export function getMutation(key: string): MutationDef | undefined {
  return MUTATION_REGISTRY.find((m) => m.key === key);
}

/** True when the mutation requires superadmin/board approval before execute. */
export function requiresSuperadminApproval(def: MutationDef): boolean {
  return def.riskLevel === "high";
}

/** Registry filtered to one platform, for platform-scoped UI tabs. */
export function mutationsForPlatform(platform: MutationDef["platform"]): MutationDef[] {
  return MUTATION_REGISTRY.filter((m) => m.platform === platform);
}
