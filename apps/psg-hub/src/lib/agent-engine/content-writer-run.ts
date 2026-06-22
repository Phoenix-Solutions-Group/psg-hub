// BSM Phase 0 / PSG-191 — Content Writer run harness (generate → gate → persist).
//
// `content-writer-handoff.ts` builds the *request* the Content Writer consumes.
// This module is the other half: it takes the Content Writer skill's *output*
// (the generated asset + its claims manifest) and runs it through the trust gate
// before it is allowed anywhere near `content_items`.
//
// The actual prose generation (the Anthropic call) lives in the Content Writer
// Claude Code skill — a `GeneratedAsset` is exactly what that skill returns. This
// harness is deliberately pure / node-testable (same discipline as
// claim-integrity and content-writer-handoff): no Supabase, no I/O. It does two
// jobs:
//   1. `gateGeneratedAsset` — render the asset's full text and run the PSG-143
//      `checkClaimIntegrity` HARD-FAIL gate (Content Writer spec §4 / PSG-173
//      publish-gate Check 3). A draft that does not `ship` here is not a draft.
//   2. `toContentItemDraft` — shape a shipped asset into the row the app persists
//      to `content_items` (status `draft`), carrying its claims manifest and the
//      recorded integrity verdict so the PSG-173 brand-voice gate (and the
//      `approved → published` enforcement) can resolve against verified facts.

import {
  checkClaimIntegrity,
  type ClaimIntegrityResult,
  type ClaimManifestEntry,
  type VerifiedFacts,
} from "@/lib/claim-integrity";
import type { ContentType } from "./types";

/**
 * The output of the Content Writer skill for a single asset: the prose plus the
 * claims manifest that maps every factual claim to the verified-facts field that
 * backs it (spec §3). `metaDescription` is the SERP snippet a blog/service page
 * also carries; for a `meta_description` asset the body *is* the meta text.
 */
export type GeneratedAsset = {
  shopId: string;
  contentType: ContentType;
  /** Page/post title (the `<title>` / H1). Empty for a bare meta_description. */
  title: string;
  /** The main body copy (markdown/plain). For meta_description, the snippet. */
  body: string;
  /** Optional SERP meta description that ships alongside a blog/service page. */
  metaDescription?: string;
  /** Claim → verified-facts binding for every factual assertion in the copy. */
  claimsManifest: ClaimManifestEntry[];
};

/** A generated asset paired with the verdict the trust gate returned for it. */
export type GatedAsset = {
  asset: GeneratedAsset;
  result: ClaimIntegrityResult;
};

/**
 * Render the full surface a reader (and the denylist scanner) sees for one
 * asset: title + body + meta. The claim-integrity denylist scan runs over this
 * rendered text, so anything customer-visible must be included here — a
 * competitor name or absolute-cost promise hiding in the meta description is
 * just as much a HARD-FAIL as one in the body.
 */
export function renderAssetText(asset: GeneratedAsset): string {
  return [asset.title, asset.body, asset.metaDescription]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");
}

/**
 * Run the PSG-143 claim-integrity HARD-FAIL gate over a generated asset against
 * its shop's verified-facts record. This is Check 3 of the PSG-173 publish gate
 * — any unbacked/mismatched claim or denylist hit ⇒ `verdict: "reject",
 * hardFail: true`. Pure; the caller decides what to do with a non-ship verdict.
 */
export function gateGeneratedAsset(asset: GeneratedAsset, facts: VerifiedFacts): GatedAsset {
  const result = checkClaimIntegrity({
    text: renderAssetText(asset),
    manifest: asset.claimsManifest,
    facts,
  });
  return { asset, result };
}

/** True when the asset cleared the trust gate and may persist as a `draft`. */
export function isShippable(gated: GatedAsset): boolean {
  return gated.result.verdict === "ship" && !gated.result.hardFail;
}

/**
 * The persistence shape for a gated asset. Mirrors `content_items` (status
 * `draft`) plus the review metadata PSG-191 adds: the claims manifest and the
 * recorded claim-integrity verdict. The `approved → published` enforcement hook
 * reads `claimIntegrityVerdict` so a draft can never be published on top of a
 * failing Check 3.
 *
 * `locationId` is required by the `content_items` schema (NOT NULL FK); the
 * caller resolves it from the shop's primary location.
 */
export type ContentItemDraft = {
  shopId: string;
  locationId: string;
  type: ContentType;
  title: string | null;
  body: string;
  status: "draft";
  claimsManifest: ClaimManifestEntry[];
  claimIntegrityVerdict: ClaimIntegrityResult;
};

/**
 * Shape a gated asset into a `content_items` draft row. Throws if the asset did
 * not clear the trust gate — an un-shipped asset must never reach persistence
 * (Done condition: claim-integrity passes on each before review). This is the
 * single chokepoint between generation and the database.
 */
export function toContentItemDraft(gated: GatedAsset, locationId: string): ContentItemDraft {
  if (!isShippable(gated)) {
    const codes = gated.result.violations.map((v) => v.code).join(", ") || "non-ship verdict";
    throw new Error(
      `Refusing to persist asset that failed claim-integrity (${gated.result.verdict}): ${codes}`,
    );
  }
  const { asset } = gated;
  return {
    shopId: asset.shopId,
    locationId,
    type: asset.contentType,
    // A bare meta_description has no title; everything else keeps its title.
    title: asset.contentType === "meta_description" ? null : asset.title || null,
    body: asset.body,
    status: "draft",
    claimsManifest: asset.claimsManifest,
    claimIntegrityVerdict: gated.result,
  };
}
