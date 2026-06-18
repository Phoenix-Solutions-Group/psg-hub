// v1.6 / 16-02 — Known collision-repair consolidator registry.
// "Consolidator-aware" scoring needs to recognize when a competitor is a location of a
// national/regional MSO consolidator. We match a competitor's name against a curated
// registry of brand aliases. This is the deterministic baseline; the G5-gated discovery
// step can later enrich type/ownership via the web_grounded router profile, but the
// registry alone classifies the obvious majors with zero spend.

/** A consolidator brand + the lowercased aliases that identify one of its locations. */
export type ConsolidatorBrand = {
  /** Canonical group name stored on the competitor row. */
  group: string;
  /** Lowercase substrings; a competitor name containing any one is classified as this group. */
  aliases: string[];
};

/**
 * Major U.S. collision-repair consolidators (the "Big 4" MSOs + notable regionals).
 * Aliases stay specific enough to avoid false positives on independents (e.g. a shop
 * literally named "Classic Auto Body" should NOT match "Classic Collision").
 */
export const CONSOLIDATOR_BRANDS: ConsolidatorBrand[] = [
  { group: "Caliber Collision", aliases: ["caliber collision", "caliber auto", "caliber - "] },
  { group: "Crash Champions", aliases: ["crash champions", "service king"] }, // Service King merged into Crash Champions
  { group: "Gerber Collision & Glass", aliases: ["gerber collision", "gerber auto", "boyd group"] },
  { group: "ABRA Auto Body", aliases: ["abra auto body", "abra collision"] },
  { group: "CARSTAR", aliases: ["carstar"] },
  { group: "Classic Collision", aliases: ["classic collision"] },
  { group: "Joe Hudson's Collision Center", aliases: ["joe hudson", "joe hudson's collision"] },
  { group: "Fix Auto", aliases: ["fix auto"] },
  { group: "Maaco", aliases: ["maaco"] },
  { group: "Driven Brands Collision", aliases: ["driven brands"] },
];

export type ConsolidatorMatch = {
  isConsolidator: boolean;
  /** Canonical group name when matched, else null. */
  group: string | null;
};

/**
 * Classify a competitor name against the registry. Case-insensitive substring match on the
 * curated aliases. Returns the canonical group on the first match (registry order).
 */
export function classifyConsolidator(name: string): ConsolidatorMatch {
  const hay = name.toLowerCase();
  for (const brand of CONSOLIDATOR_BRANDS) {
    if (brand.aliases.some((alias) => hay.includes(alias))) {
      return { isConsolidator: true, group: brand.group };
    }
  }
  return { isConsolidator: false, group: null };
}
