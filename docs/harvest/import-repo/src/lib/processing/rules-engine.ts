import type { Row } from "./types";

export const DEFAULT_FLEET_KEYWORDS = [
  "rental", "fleet", "enterprise", "hertz", "avis", "budget",
  "national", "alamo", "dollar", "thrifty", "zipcar", "turo",
  "leasing", "insurance", "salvage", "auction", "copart", "iaa",
  "auto auction",
];

// HTML entity decoding for ampersands
function decodeAmpersand(str: string): string {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&");
}

/**
 * Apply rules: ampersand handling, fleet detection, deduplication.
 * Returns clean and error arrays.
 */
export function applyRules(
  rows: Row[],
  fleetKeywords: string[] = DEFAULT_FLEET_KEYWORDS
): { clean: Row[]; errors: Row[] } {
  const clean: Row[] = [];
  const errors: Row[] = [];

  // Phase 1: Ampersand handling
  const ampersandProcessed = rows.map((row) => {
    const updated = { ...row };
    let hadAmpersand = false;

    // Check name fields for ampersands
    for (const field of ["OwnerFName", "OwnerLName", "OwnerCompanyName"]) {
      const val = updated[field];
      if (!val) continue;

      const decoded = decodeAmpersand(val);
      if (decoded.includes("&")) {
        updated[field] = decoded.replace(/\s*&\s*/g, " and ");
        hadAmpersand = true;
      } else if (decoded !== val) {
        updated[field] = decoded;
      }
    }

    if (hadAmpersand) {
      updated._nameContainedAmpersand = "true";
    }

    return updated;
  });

  // Phase 2: Fleet detection
  const lowerKeywords = fleetKeywords.map((k) => k.toLowerCase());
  const TEXT_FIELDS = [
    "OwnerFName", "OwnerLName", "OwnerCompanyName",
    "OwnerAddress1", "OwnerAddress2",
  ];

  const nonFleet: Row[] = [];

  for (const row of ampersandProcessed) {
    let isFleet = false;

    // Check all text fields for fleet keywords
    for (const field of TEXT_FIELDS) {
      const val = (row[field] ?? "").toLowerCase();
      if (val && lowerKeywords.some((kw) => val.includes(kw))) {
        isFleet = true;
        break;
      }
    }

    // Company name without personal name = likely fleet/commercial
    if (!isFleet && row.OwnerCompanyName && !row.OwnerFName && !row.OwnerLName) {
      if (lowerKeywords.some((kw) => (row.OwnerCompanyName ?? "").toLowerCase().includes(kw))) {
        isFleet = true;
      }
    }

    if (isFleet) {
      errors.push({ ...row, _errorReason: "Fleet/Commercial detected" });
    } else {
      nonFleet.push(row);
    }
  }

  // Phase 3: Deduplication
  const seen = new Map<string, { row: Row; index: number }>();

  for (let i = 0; i < nonFleet.length; i++) {
    const row = nonFleet[i];
    const key = [
      (row.OwnerFName ?? "").toLowerCase().trim(),
      (row.OwnerLName ?? "").toLowerCase().trim(),
      (row.OwnerAddress1 ?? "").toLowerCase().trim(),
      (row.OwnerHomePhone ?? "").replace(/\D/g, ""),
    ].join("|");

    if (!key || key === "|||") {
      // No dedup key available, keep row
      clean.push(row);
      continue;
    }

    const existing = seen.get(key);
    if (existing) {
      // Keep the row with the newer DeliveredDate
      const existingDate = existing.row.DeliveredDate ?? "";
      const newDate = row.DeliveredDate ?? "";

      if (newDate > existingDate) {
        // Replace with newer row, move older to errors
        errors.push({ ...existing.row, _errorReason: "Duplicate (older record)" });
        seen.set(key, { row, index: i });
      } else {
        errors.push({ ...row, _errorReason: "Duplicate (older record)" });
      }
    } else {
      seen.set(key, { row, index: i });
    }
  }

  // Add all surviving deduped rows to clean
  for (const { row } of seen.values()) {
    clean.push(row);
  }

  return { clean, errors };
}
