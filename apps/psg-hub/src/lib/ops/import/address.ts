// v1.1 / PSG-38 — Address validation + smart-resolution.
//
// Absorbed from the standalone `psg-import` utility. Pure, dependency-free, and
// fully unit-tested: no network geocoder. The goal is to normalize the messy
// address columns that come out of estimating-system exports (CCC, Mitchell,
// Audatex) into a clean, consistent shape and to surface fixable issues as
// warnings rather than silently dropping rows.

export type AddressInput = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type NormalizedAddress = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null; // 2-letter USPS code when resolvable
  zip: string | null; // 5-digit, or ZIP+4 as "#####-####"
};

export type AddressResolution = {
  address: NormalizedAddress;
  /** Human-readable notes about corrections applied (e.g. "St -> Street"). */
  warnings: string[];
  /** Hard problems (e.g. unresolvable state, malformed zip). */
  errors: string[];
};

// 50 states + DC + common territories. Full name (lowercased) -> USPS code.
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR", guam: "GU", "virgin islands": "VI",
};

const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

// Street-type abbreviation expansion (smart-resolution of inconsistent inputs).
const STREET_TYPES: Record<string, string> = {
  st: "Street", str: "Street", ave: "Avenue", av: "Avenue", blvd: "Boulevard",
  rd: "Road", ln: "Lane", dr: "Drive", ct: "Court", cir: "Circle", pl: "Place",
  pkwy: "Parkway", hwy: "Highway", ter: "Terrace", trl: "Trail", way: "Way",
  sq: "Square", loop: "Loop",
};

const DIRECTIONALS: Record<string, string> = {
  n: "N", s: "S", e: "E", w: "W", ne: "NE", nw: "NW", se: "SE", sw: "SW",
  north: "N", south: "S", east: "E", west: "W",
  northeast: "NE", northwest: "NW", southeast: "SE", southwest: "SW",
};

function collapse(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Resolve a free-text state into a 2-letter USPS code, or null if unknown. */
export function normalizeState(raw: string | null | undefined): string | null {
  const value = collapse(raw);
  if (!value) return null;
  const upper = value.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  const code = STATE_NAME_TO_CODE[value.toLowerCase()];
  return code ?? null;
}

/** Normalize a US zip to 5-digit or ZIP+4. Returns null when not recoverable. */
export function normalizeZip(raw: string | null | undefined): string | null {
  const value = collapse(raw);
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 5) return digits;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  // A 5-digit prefix padded with a stray char (e.g. trailing space already
  // stripped) — accept a leading 5 only when nothing else trails.
  if (digits.length > 5 && digits.length < 9) return digits.slice(0, 5);
  if (digits.length === 4) return digits.padStart(5, "0"); // dropped-leading-zero zips
  return null;
}

/** Normalize a US phone to 10 digits (E.164-ish national). null when invalid. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const value = collapse(raw);
  if (!value) return null;
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return digits;
}

/** Expand street abbreviations + fix casing on a street line ("smart" fixup). */
export function normalizeStreet(raw: string | null | undefined): {
  value: string | null;
  changed: boolean;
} {
  const value = collapse(raw);
  if (!value) return { value: null, changed: false };

  const tokens = value.split(" ");
  let changed = false;
  const out = tokens.map((token, i) => {
    const bare = token.replace(/\.$/, ""); // drop trailing period: "St." -> "St"
    const lower = bare.toLowerCase();

    // Leading/trailing directional ("N", "SW").
    if ((i === 0 || i === tokens.length - 1) && DIRECTIONALS[lower]) {
      const resolved = DIRECTIONALS[lower];
      if (resolved !== token) changed = true;
      return resolved;
    }
    // Street-type suffix.
    if (STREET_TYPES[lower]) {
      changed = true;
      return STREET_TYPES[lower];
    }
    // House number — leave as-is.
    if (/^\d+[a-z]?$/i.test(bare)) return bare;
    // Otherwise title-case for consistency.
    const titled = titleCaseWord(bare);
    if (titled !== token) changed = true;
    return titled;
  });

  return { value: out.join(" "), changed };
}

/**
 * Validate + smart-resolve an address. Missing parts are tolerated (warnings),
 * but a present-but-unrecognized state or an unparseable zip is an error so the
 * operator can fix the source before commit.
 */
export function resolveAddress(input: AddressInput): AddressResolution {
  const warnings: string[] = [];
  const errors: string[] = [];

  const street = normalizeStreet(input.line1);
  if (street.changed) warnings.push("Street normalized to USPS-style formatting");

  const line2 = collapse(input.line2) || null;
  const city = collapse(input.city) ? titleCaseEach(collapse(input.city)) : null;

  let state: string | null = null;
  const rawState = collapse(input.state);
  if (rawState) {
    state = normalizeState(rawState);
    if (!state) errors.push(`Unrecognized state: "${rawState}"`);
    else if (state !== rawState.toUpperCase()) warnings.push(`State resolved to ${state}`);
  }

  let zip: string | null = null;
  const rawZip = collapse(input.zip);
  if (rawZip) {
    zip = normalizeZip(rawZip);
    if (!zip) errors.push(`Malformed ZIP: "${rawZip}"`);
    else if (zip !== rawZip) warnings.push(`ZIP normalized to ${zip}`);
  }

  return {
    address: { line1: street.value, line2, city, state, zip },
    warnings,
    errors,
  };
}

function titleCaseEach(value: string): string {
  return value.split(" ").map(titleCaseWord).join(" ");
}
