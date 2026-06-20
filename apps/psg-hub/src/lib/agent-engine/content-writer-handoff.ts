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

import type { ContentBrief, ContentDraftRequest, ContentType, KeywordTarget } from "./types";

/**
 * Assemble a validated ContentDraftRequest for the Content Writer.
 * @throws until implemented by the PSG-153 Content Writer handoff child issue.
 */
export function buildContentDraftRequest(
  _brief: ContentBrief,
  _keywordTargets: KeywordTarget[],
  _contentType: ContentType,
): ContentDraftRequest {
  throw new Error(
    "buildContentDraftRequest not implemented — see PSG-153 Content Writer handoff child issue",
  );
}
