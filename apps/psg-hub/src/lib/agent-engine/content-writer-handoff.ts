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
  type KeywordIntent,
  type KeywordTarget,
} from "./types";
// PSG-164 — adapter input only. The SEO-Auditor loader's snake_case transport
// shape (priority HIGH|MEDIUM|LOW, search_volume, competitor_presence,
// gap_opportunity, source) is `fetchKeywordTargets()` output. It is imported
// type-only so it never becomes a runtime dependency of the pure agent-engine,
// and it is deliberately confined to this adapter — the canonical contract in
// `./types` stays free of the transport DTO (Ada's PSG-153 architecture call).
import type {
  KeywordPriority as SeoKeywordPriority,
  KeywordTarget as SeoKeywordTargetDTO,
} from "@/types/keyword-target";

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

/* -------------------------------------------------------------------------- */
/* SEO-Auditor loader adapter (PSG-164)                                       */
/* -------------------------------------------------------------------------- */
//
// The SEO Auditor's keyword half (PSG-161) reaches the Content Writer as a
// transport DTO read off `research_artifacts` by `fetchKeywordTargets()`:
// snake_case, a bucketed HIGH|MEDIUM|LOW `priority`, plus `competitor_presence`,
// `gap_opportunity`, and `source`. The agent-engine contract (`./types`) is the
// canonical cross-module shape (camelCase, numeric 0–100 `priority`, `intent`).
// This adapter is the ONE place the two shapes meet, so the writer always
// consumes a single canonical `KeywordTarget` regardless of where a target came
// from (the brief, a synthesis, or a mid-draft ask to the SEO Auditor).

/** Bucketed loader priority → canonical numeric priority (Ada's PSG-153 scale). */
const SEO_PRIORITY_SCORE: Record<SeoKeywordPriority, number> = {
  HIGH: 85,
  MEDIUM: 55,
  LOW: 25,
};

/**
 * Infer a canonical search `intent` from the keyword text.
 *
 * The loader DTO carries NO intent (the SEMrush/auditor artifacts it reads don't
 * record one), but the canonical contract requires it to shape the draft. Rather
 * than stamp a blind constant, we derive a best-effort intent from the phrase and
 * fall back to `"service"` (the most common BSM collision-repair shape). This is
 * the one reconciliation choice flagged for the contract owner (Ada): if the SEO
 * loader later captures a real intent, this heuristic becomes the fallback only.
 */
function inferKeywordIntent(keyword: string): KeywordIntent {
  const k = keyword.toLowerCase();
  if (/\b(tow|towing|after (an? )?accident|emergency|wreck)\b/.test(k)) return "emergency";
  if (/\b(estimate|quote|free|near me|cost|price|cheap|book|appointment)\b/.test(k)) {
    return "transactional";
  }
  if (/\b(how|what|why|when|guide|tips|vs|difference|long does)\b/.test(k)) return "informational";
  // A bare city/state locality with no service/transaction verb reads as local.
  if (/\b(near|in|around)\b/.test(k)) return "local";
  return "service";
}

/**
 * Fold the loader-only signals the canonical contract has no field for
 * (`gap_opportunity`, `competitor_presence`, `source`) into the operator-facing
 * `rationale`, so the SEO context survives the handoff instead of being dropped
 * silently.
 */
function describeSeoSignal(dto: SeoKeywordTargetDTO): string {
  const bits = [`SEO Auditor: ${dto.priority} priority`];
  if (dto.gap_opportunity) bits.push("content gap");
  if (dto.competitor_presence > 0) {
    bits.push(`${dto.competitor_presence} competitor${dto.competitor_presence === 1 ? "" : "s"} ranking`);
  }
  return bits.join("; ");
}

/**
 * Map one SEO-Auditor loader DTO (`fetchKeywordTargets()` output) into the
 * canonical agent-engine `KeywordTarget`.
 *
 * - `priority` bucket HIGH|MEDIUM|LOW → numeric 85|55|25.
 * - `search_volume` → `searchVolume`, but only when > 0: the loader uses 0 for
 *   "no SEMrush volume", which the canonical contract represents as the field
 *   being absent (optional), so we preserve "unknown" rather than asserting a
 *   real zero-volume keyword.
 * - `competitor_presence` + `gap_opportunity` are folded into `rationale` (the
 *   contract has no dedicated field); `source` is dropped.
 * - `intent` is inferred from the keyword (see `inferKeywordIntent`).
 *
 * Pure and total: never mutates the input and always returns a schema-valid
 * canonical target.
 */
export function adaptSeoKeywordTarget(dto: SeoKeywordTargetDTO): KeywordTarget {
  const target: KeywordTarget = {
    keyword: dto.keyword,
    intent: inferKeywordIntent(dto.keyword),
    priority: SEO_PRIORITY_SCORE[dto.priority],
    rationale: describeSeoSignal(dto),
  };
  if (dto.search_volume > 0) target.searchVolume = dto.search_volume;
  return target;
}

/** Map a batch of SEO-Auditor loader DTOs into canonical KeywordTargets. */
export function adaptSeoKeywordTargets(dtos: SeoKeywordTargetDTO[]): KeywordTarget[] {
  return dtos.map(adaptSeoKeywordTarget);
}

/**
 * Build a validated `ContentDraftRequest` from BOTH cross-module halves using the
 * SEO Auditor's loader-shaped keyword targets directly.
 *
 * This is the integration entry point for the Content Writer: it consumes the
 * Market Researcher's canonical `ContentBrief` (PSG-160) and the SEO Auditor's
 * `fetchKeywordTargets()` DTOs (PSG-161), adapting the latter into the canonical
 * shape before the brief∪targets union+dedup that `buildContentDraftRequest`
 * performs. The brief's own `targetKeywords` still win on a keyword collision
 * (first-occurrence-wins in `buildContentDraftRequest`).
 */
export function buildContentDraftRequestFromSeoTargets(
  brief: ContentBrief,
  seoKeywordTargets: SeoKeywordTargetDTO[],
  contentType: ContentType,
): ContentDraftRequest {
  return buildContentDraftRequest(brief, adaptSeoKeywordTargets(seoKeywordTargets), contentType);
}
