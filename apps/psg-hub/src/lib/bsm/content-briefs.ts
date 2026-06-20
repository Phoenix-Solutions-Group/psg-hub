// BSM Phase 0 / PSG-160 — Market Researcher → ContentBrief writer + loader.
//
// The cross-module Market Researcher → Content Writer path (PSG-153 / QA defect
// PSG-145 item 6). Three pieces:
//   • writeContentBrief  — persist a synthesized brief as a `content_brief` row
//                          in `research_artifacts` (so a brief is actually
//                          *produced*, not just read).
//   • fetchMarketResearchBrief — load the newest brief for a shop, parsed.
//   • parseContentBrief  — validate a stored jsonb payload into a ContentBrief.
//
// SCHEMA REALITY (verified against the live migration 20260602105554):
// `research_artifacts(id, campaign_id→campaigns, artifact_type CHECK (... incl.
// 'content_brief'), source_skill NOT NULL, data jsonb NOT NULL, file_path,
// created_at)`. The table has NO `shop_id` column and links to `campaigns`
// (→`clients`), a lineage with no `shops` relationship. BSM briefs are therefore
// shop-scoped via the `data->>shop_id` payload, not a column or FK.
//
// RLS POSTURE (verified against 20260603194623_close_blanket_allow_rls): the
// table is default-deny (RLS on, no policy) → service-role only. Reads must run
// behind an explicit app-level tenancy gate (shop_users membership) with the
// `data->>shop_id` filter as the tenant clamp — the same model
// `getDashboardAccess` uses for default-deny tables. Callers pass a service
// client AFTER gating; this module never widens RLS. (Flagged for Ada's security
// review on PSG-153.)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentBrief as SynthesizedBrief } from "@/lib/agent-engine";
import { contentBriefSchema, type ContentBrief } from "@/types/content-brief";

/** Table + identity constants for the content_brief artifact. */
const RESEARCH_ARTIFACTS = "research_artifacts";
const ARTIFACT_TYPE = "content_brief";
/** Provenance tag — which BSM agent skill produced the row. */
const SOURCE_SKILL = "market-researcher";

/**
 * Flatten the agent-engine synthesis output (rich `ContentBrief`: camelCase, full
 * KeywordTarget[] `targetKeywords`, status draft|approved|published, `sources`
 * provenance) into the persisted/API DTO this module owns. Keyword targets
 * collapse to bare phrases (the SEO objects are merged back in by Ada on PSG-153);
 * any non-draft synthesis status maps to `active` (queued for content work).
 *
 * Exported for unit tests and for the writer; the result is schema-validated by
 * the caller before it touches the DB.
 */
export function toPersistedBrief(brief: SynthesizedBrief): ContentBrief {
  return {
    id: brief.id,
    shop_id: brief.shopId,
    topic: brief.topic,
    target_keywords: brief.targetKeywords.map((k) => k.keyword),
    competitor_gap: brief.competitorGap,
    audience_persona: brief.audiencePersona,
    priority_score: brief.priorityScore,
    status: brief.status === "draft" ? "draft" : "active",
    created_at: brief.createdAt,
  };
}

/**
 * Validate + normalize a stored `research_artifacts.data` jsonb payload into a
 * typed ContentBrief. Throws (via zod) on a malformed payload so a corrupt row
 * surfaces loudly rather than flowing a half-built brief into the Content Writer.
 */
export function parseContentBrief(data: unknown): ContentBrief {
  return contentBriefSchema.parse(data);
}

/** Optional metadata when persisting a brief. */
export type WriteContentBriefOptions = {
  /** Owning campaign, when the brief was produced inside a campaign workflow. */
  campaignId?: string | null;
};

/**
 * Persist a synthesized brief as a `content_brief` artifact and return the
 * stored DTO. The caller supplies a service-role client (research_artifacts is
 * default-deny). Append-only: the loader always takes the newest row, so a
 * re-synthesized brief simply supersedes the prior one.
 */
export async function writeContentBrief(
  client: SupabaseClient,
  brief: SynthesizedBrief,
  opts: WriteContentBriefOptions = {},
): Promise<ContentBrief> {
  // Validate the flattened shape BEFORE writing — never persist a bad payload.
  const dto = contentBriefSchema.parse(toPersistedBrief(brief));

  const { error } = await client.from(RESEARCH_ARTIFACTS).insert({
    artifact_type: ARTIFACT_TYPE,
    source_skill: SOURCE_SKILL,
    campaign_id: opts.campaignId ?? null,
    data: dto,
  });

  if (error) {
    throw new Error(`writeContentBrief: failed to persist brief: ${error.message}`);
  }

  return dto;
}

/**
 * Load the newest `content_brief` for a shop, parsed into a ContentBrief, or
 * `null` when the shop has none. `client` MUST be authorized to read
 * research_artifacts (service-role) and the caller MUST have already gated the
 * request on shop membership — the `data->>shop_id` filter is the tenant clamp,
 * not the authorization boundary.
 */
export async function fetchMarketResearchBrief(
  client: SupabaseClient,
  shopId: string,
): Promise<ContentBrief | null> {
  const { data, error } = await client
    .from(RESEARCH_ARTIFACTS)
    .select("data")
    .eq("artifact_type", ARTIFACT_TYPE)
    .eq("data->>shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`fetchMarketResearchBrief: query failed: ${error.message}`);
  }
  if (!data) return null;

  return parseContentBrief((data as { data: unknown }).data);
}
