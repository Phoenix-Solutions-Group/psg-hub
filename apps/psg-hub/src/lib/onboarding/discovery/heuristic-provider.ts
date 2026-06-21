/**
 * Offline, deterministic discovery provider (PSG-144).
 *
 * Works with zero paid API keys: it echoes the user's name/address back as
 * structured fields, infers a candidate website from the name, and marks every
 * field the operator must source from an external provider as `pending`.
 *
 * This is the default provider so the smart-onboarding flow is fully functional
 * (and testable) before the board approves Google Places / SEMrush / Yext
 * spend (escalated on PSG-142). When those land, a real provider replaces this
 * one behind the DiscoveryProvider seam and fills `pending` with verified data.
 */

import type {
  DiscoveryInput,
  DiscoveryProvider,
  EnrichedShopProfile,
} from "./types";
import {
  cleanText,
  inferWebsiteCandidate,
  normalizeState,
} from "./normalize";

/** Fields the offline provider cannot source — need a paid external provider. */
const PENDING_FIELDS = ["phone", "hours", "reviews", "competitors"] as const;

export const heuristicProvider: DiscoveryProvider = {
  name: "heuristic",

  // Pure function of the input → output is deterministic, so discovery is
  // trivially idempotent: the same name+address always yields the same profile
  // and the endpoint performs no writes.
  async discover(input: DiscoveryInput): Promise<EnrichedShopProfile> {
    const shopName = input.shopName.trim();
    const websiteCandidate = inferWebsiteCandidate(shopName);

    return {
      shopName: {
        value: shopName,
        confidence: 1,
        source: "user",
        verified: false,
      },
      websiteUrl: {
        value: websiteCandidate,
        // A guess derived from the name — low confidence, user must confirm.
        confidence: websiteCandidate ? 0.25 : 0,
        source: "inferred",
        verified: false,
      },
      phone: { value: null, confidence: 0, source: "inferred", verified: false },
      hours: { value: null, confidence: 0, source: "inferred", verified: false },
      addressStreet: {
        value: cleanText(input.addressStreet),
        confidence: input.addressStreet ? 1 : 0,
        source: "user",
        verified: false,
      },
      addressLocality: {
        value: cleanText(input.city),
        confidence: input.city ? 1 : 0,
        source: "user",
        verified: false,
      },
      addressRegion: {
        value: normalizeState(input.state),
        confidence: normalizeState(input.state) ? 1 : 0,
        source: "user",
        verified: false,
      },
      reviewSummary: {
        value: null,
        confidence: 0,
        source: "inferred",
        verified: false,
      },
      competitors: [],
      pending: [...PENDING_FIELDS],
      provider: "heuristic",
    };
  },
};
