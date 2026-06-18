// v1.6 / 16-02 — Consolidator-aware competitor scoring (pure, no I/O, no spend).
// threatScore = blend(proximity, presence) × consolidatorWeight, scaled to 0–100, then
// ranked within a shop. Every input is plain data so this is fully unit-testable and runs
// build-local with zero vendor cost — only the upstream discovery step is G5-gated.

import {
  DEFAULT_SCORING_WEIGHTS,
  type Competitor,
  type CompetitorScore,
  type ScoringWeights,
  type ShopContext,
} from "./types";

const EARTH_RADIUS_MILES = 3958.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in miles, or null if either point is missing a coordinate. */
export function haversineMiles(
  a: { latitude: number | null; longitude: number | null },
  b: { latitude: number | null; longitude: number | null },
): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return null;
  }
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * Proximity sub-score (0–1): 1 at the shop, decaying linearly to 0 at the service-area
 * edge. Beyond the radius → 0. Unknown distance → 0.5 (neutral; don't reward or punish
 * a competitor we couldn't geolocate).
 */
export function proximityScore(distanceMiles: number | null, radiusMiles: number | null): number {
  if (distanceMiles == null) return 0.5;
  const radius = radiusMiles && radiusMiles > 0 ? radiusMiles : 10;
  return clamp01(1 - distanceMiles / radius);
}

/**
 * Presence sub-score (0–1): rating strength × review-volume confidence. A 4.8 with 5
 * reviews is weaker market presence than a 4.5 with 400. Volume saturates (log) at
 * `reviewSaturation`. Unknown rating → 0 presence (no evidence of pull).
 */
export function presenceScore(
  rating: number | null,
  reviewCount: number | null,
  reviewSaturation = DEFAULT_SCORING_WEIGHTS.reviewSaturation,
): number {
  if (rating == null || rating <= 0) return 0;
  const ratingFactor = clamp01(rating / 5);
  const count = Math.max(0, reviewCount ?? 0);
  const volumeFactor = clamp01(Math.log1p(count) / Math.log1p(Math.max(1, reviewSaturation)));
  return ratingFactor * volumeFactor;
}

/** Consolidator multiplier: independents ×1.0, consolidators ×(1 + premium). */
export function consolidatorWeight(competitor: Competitor, premium: number): number {
  return competitor.type === "consolidator" ? 1 + premium : 1;
}

function buildRationale(
  competitor: Competitor,
  distanceMiles: number | null,
  prox: number,
  pres: number,
  weight: number,
): string {
  const parts: string[] = [];
  if (competitor.type === "consolidator") {
    parts.push(`${competitor.consolidatorGroup ?? "Consolidator"} location (×${weight.toFixed(2)} threat)`);
  } else {
    parts.push("Independent shop");
  }
  if (distanceMiles != null) parts.push(`${distanceMiles.toFixed(1)} mi away`);
  if (competitor.rating != null) {
    parts.push(`${competitor.rating.toFixed(1)}★ (${competitor.reviewCount ?? 0} reviews)`);
  }
  parts.push(`proximity ${(prox * 100).toFixed(0)} / presence ${(pres * 100).toFixed(0)}`);
  return parts.join(" · ");
}

/**
 * Score one competitor against its owning shop. distanceMiles is taken from the competitor
 * if present, else computed from coordinates. Pure.
 */
export function scoreCompetitor(
  competitor: Competitor,
  shop: ShopContext,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): Omit<CompetitorScore, "rank"> {
  const distanceMiles = competitor.distanceMiles ?? haversineMiles(shop, competitor);
  const prox = proximityScore(distanceMiles, shop.searchRadiusMiles);
  const pres = presenceScore(competitor.rating, competitor.reviewCount, weights.reviewSaturation);
  const weight = consolidatorWeight(competitor, weights.consolidatorPremium);

  const base = weights.proximity * prox + weights.presence * pres;
  const threatScore = Math.min(100, Math.round(base * weight * 100));

  return {
    competitorId: competitor.id,
    shopId: shop.id,
    threatScore,
    proximityScore: prox,
    presenceScore: pres,
    consolidatorWeight: weight,
    rationale: buildRationale(competitor, distanceMiles, prox, pres, weight),
  };
}

/**
 * Score + rank a shop's full competitor set. Sorted by threat descending; rank is 1-based.
 * Ties break on competitor id for deterministic ordering.
 */
export function scoreShopCompetitors(
  competitors: Competitor[],
  shop: ShopContext,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): CompetitorScore[] {
  const scored = competitors.map((c) => scoreCompetitor(c, shop, weights));
  scored.sort((a, b) =>
    b.threatScore !== a.threatScore
      ? b.threatScore - a.threatScore
      : a.competitorId.localeCompare(b.competitorId),
  );
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
