/**
 * Smart onboarding auto-discovery (PSG-144).
 *
 * Given a shop's name + address, produce an *enriched profile* of suggested
 * fields (website / phone / hours / reviews / competitors) that pre-fill the
 * onboarding wizard. Every value carries its provenance and a `verified` flag.
 *
 * Verified-facts mandate (BSM Phase 0 / PSG-142): discovery NEVER asserts a fact
 * as truth. A discovered value is a *suggestion* the operator/owner confirms in
 * the wizard before anything is written. `verified` is therefore false for
 * everything the heuristic provider returns; only an authoritative external
 * provider (Google Places / GBP) may set it true.
 */

/** Where a discovered value came from. */
export type FieldSource =
  | "user" // echoed back from what the user typed
  | "inferred" // a deterministic guess (e.g. website from name) — low confidence
  | "google_places"
  | "gbp"
  | "semrush"
  | "web";

export interface DiscoveredField<T> {
  value: T;
  /** 0..1 — provider confidence. Heuristic guesses are low (<= 0.3). */
  confidence: number;
  source: FieldSource;
  /**
   * True ONLY when independently verified against an authoritative source.
   * Heuristic / inferred / user-echoed values are never verified — the user
   * must confirm them in the wizard.
   */
  verified: boolean;
}

export interface DiscoveredCompetitor {
  name: string;
  distanceMiles: number | null;
  source: FieldSource;
}

export interface ReviewSummary {
  rating: number | null;
  count: number | null;
}

/** The enriched profile returned to the onboarding wizard. */
export interface EnrichedShopProfile {
  shopName: DiscoveredField<string>;
  websiteUrl: DiscoveredField<string | null>;
  phone: DiscoveredField<string | null>;
  hours: DiscoveredField<string | null>;
  addressStreet: DiscoveredField<string | null>;
  addressLocality: DiscoveredField<string | null>;
  addressRegion: DiscoveredField<string | null>;
  reviewSummary: DiscoveredField<ReviewSummary | null>;
  competitors: DiscoveredCompetitor[];
  /**
   * Enrichments that require a board-gated paid provider that is not yet
   * configured (Google Places / SEMrush / BigQuery). Surfaced so the wizard can
   * tell the user "we'll auto-fill these once your data sources are connected".
   */
  pending: string[];
  /** Name of the provider that produced this profile. */
  provider: string;
}

export interface DiscoveryInput {
  shopName: string;
  addressStreet?: string;
  city?: string;
  state?: string;
}

/**
 * A pluggable discovery backend. The default is offline + deterministic; paid
 * external providers (Google Places, SEMrush, BigQuery competitor radius) slot
 * in behind this seam once the board approves their spend (PSG-142).
 */
export interface DiscoveryProvider {
  readonly name: string;
  discover(input: DiscoveryInput): Promise<EnrichedShopProfile>;
}
