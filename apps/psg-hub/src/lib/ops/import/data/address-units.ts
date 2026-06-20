// PSG-132 — USPS street-suffix / directional tables + unit extraction.
//
// Net-new IP harvested from `Phoenix-Solutions-Group/import` @ main `a11133d`
// (`src/lib/processing/address-validation.ts`, USPS-table portion) ahead of the
// PSG-50 decommission. The networked Smarty/Google geocoder from the source is
// intentionally omitted — the in-hub import stays dependency-free.
//
// RELATIONSHIP TO ../address.ts (PSG-38): the parent `address.ts` already covers
// street-suffix + directional expansion (STREET_TYPES / DIRECTIONALS /
// normalizeStreet) and is unit-tested. This module adds the one capability the
// in-hub address normalizer lacks: **unit extraction** (splitting "123 Main St
// Apt 4B" into a street line + a unit token), plus the verbatim USPS tables for
// parity with the source. `expandStreetSuffix` is provided as a thin token-level
// complement; prefer ../address.ts `normalizeStreet` for full-line normalization.

/** USPS standard suffix abbreviation -> long form. Verbatim from the source repo. */
export const USPS_SUFFIXES: Record<string, string> = {
  ST: "Street", AVE: "Avenue", BLVD: "Boulevard", DR: "Drive", LN: "Lane",
  CT: "Court", CIR: "Circle", PL: "Place", RD: "Road", WAY: "Way",
  TRL: "Trail", PKWY: "Parkway", HWY: "Highway", SQ: "Square",
  TER: "Terrace", PT: "Point",
};

/** USPS directional abbreviation -> long form. Verbatim from the source repo. */
export const USPS_DIRECTIONALS: Record<string, string> = {
  N: "North", S: "South", E: "East", W: "West",
  NE: "Northeast", NW: "Northwest", SE: "Southeast", SW: "Southwest",
};

/** USPS secondary-unit designator abbreviation -> long form. */
export const USPS_UNITS: Record<string, string> = {
  APT: "Apartment", STE: "Suite", UNIT: "Unit", FL: "Floor",
  RM: "Room", BLDG: "Building",
};

/** Designator alternation used to recognise a trailing unit segment. */
export const UNIT_DESIGNATORS =
  "Apartment|Apt|Suite|Ste|Unit|Building|Bldg|Floor|Fl|Room|Rm|Lot|Trailer|Trlr|Space|Spc|Penthouse";

/**
 * Matches a trailing unit segment: either a designator + value ("Apt 4B",
 * "Suite 200") or a hash form ("#4B", "# 12"). Verbatim from the source repo.
 */
export const UNIT_RE = new RegExp(
  `\\s+(?:(${UNIT_DESIGNATORS})\\.?\\s+\\S+|#\\s*\\S+)\\s*$`,
  "i",
);

/**
 * Expand a single USPS suffix or directional token to its long form.
 * Case-insensitive; a trailing period ("St.") is tolerated. Returns the input
 * (collapsed, original case) when the token is not a recognised abbreviation.
 */
export function expandStreetSuffix(token: string): string {
  const bare = String(token ?? "").trim().replace(/\.$/, "");
  if (!bare) return "";
  const upper = bare.toUpperCase();
  return USPS_SUFFIXES[upper] ?? USPS_DIRECTIONALS[upper] ?? bare;
}

/**
 * Extract a trailing unit designator (Apt, Suite, Unit, #, …) from an address
 * line. Returns `street` (the line with the unit removed) and `unit` (the
 * extracted unit segment, or "" when none is present). Whitespace is collapsed.
 *
 * Faithful reimplementation of the source `extractUnit` from `UNIT_RE` — the
 * source body was not captured through the read-bridge, but the regex and the
 * documented `{ street, unit }` contract were.
 */
export function extractUnit(line: string): { street: string; unit: string } {
  const s = String(line ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { street: "", unit: "" };
  const m = s.match(UNIT_RE);
  if (!m || m.index === undefined) return { street: s, unit: "" };
  const unit = m[0].trim();
  const street = s.slice(0, m.index).trim();
  return { street, unit };
}
