// BSM Phase 0 / PSG-153 — Content Writer consumption seam (SEAM — to implement).
//
// Owner: child issue (Nora, with the SEO Auditor handoff). This is where the
// cross-module flows converge: the Content Writer consumes a ContentBrief
// (from the Market Researcher) AND keyword targets (from the SEO Auditor,
// possibly asked for mid-draft), and the resulting draft is gated by
// `checkClaimIntegrity` from the PSG-143 claim-integrity spine before it can ship.
//
// Implement `buildContentDraftRequest` to assemble a validated
// ContentDraftRequest from a brief + the keyword targets to honor + the content
// type. The effective keywordTargets = brief.targetKeywords UNION any
// mid-draft asks (deduped by keyword). Validate with
// contentDraftRequestSchema.parse before returning.
//
// NOTE: actual draft generation (Anthropic call) and the checkClaimIntegrity
// gate wiring belong to the Content Writer Claude Code skill; this module only
// builds/validates the request contract that the skill consumes, keeping it pure
// and node-testable (same discipline as claim-integrity).

import {
  contentDraftRequestSchema,
  type ContentBrief,
  type ContentDraftRequest,
  type ContentType,
  type KeywordTarget,
} from "./types";

/**
 * Assemble a validated ContentDraftRequest for the Content Writer.
 *
 * The effective keyword set is `brief.targetKeywords` UNION the mid-draft asks
 * in `keywordTargets`, deduped by `keyword` (first occurrence wins, so the
 * brief's curated targets take precedence over later mid-draft asks for the same
 * keyword). The request carries `brief.shopId` through so the downstream Content
 * Writer skill can gate its output against that shop's verified-facts record via
 * `checkClaimIntegrity` (PSG-143).
 *
 * The result is validated with `contentDraftRequestSchema.parse`, which enforces
 * a non-empty keyword set — a draft request that would feed the writer nothing
 * throws. Draft generation / the Anthropic call live in the skill, not here.
 */
export function buildContentDraftRequest(
  brief: ContentBrief,
  keywordTargets: KeywordTarget[],
  contentType: ContentType,
): ContentDraftRequest {
  const seen = new Set<string>();
  const effectiveKeywordTargets: KeywordTarget[] = [];
  for (const target of [...brief.targetKeywords, ...keywordTargets]) {
    if (seen.has(target.keyword)) continue;
    seen.add(target.keyword);
    effectiveKeywordTargets.push(target);
  }

  return contentDraftRequestSchema.parse({
    shopId: brief.shopId,
    brief,
    keywordTargets: effectiveKeywordTargets,
    contentType,
  });
}
