// BSM Phase 0 / PSG-143 — Claim-integrity validator.
//
// Combines the two halves of Check 2 (Content Writer spec §4):
//   1. Manifest verification — every claim in the claims manifest must trace to
//      a backing value in the verified-facts record (spec §3: "Unbacked claim ⇒
//      output cannot pass").
//   2. Denylist scan — the rendered output is scanned for prohibited patterns
//      regardless of the manifest (denylist.ts / agent-wiring §3a).
//
// Claim integrity is a trust-critical HARD-FAIL: ANY violation ⇒ verdict
// "reject", hardFail true. No "pass with notes".
//
// Pure functions, node-testable. No I/O.

import { scanDenylist, scanRating } from "./denylist";
import { RATING_STAR_THRESHOLD } from "./types";
import type {
  ClaimIntegrityResult,
  ClaimManifestEntry,
  VerifiedFacts,
  Violation,
} from "./types";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Verify a single manifest entry against the record. Returns a violation when
 * the backing field is empty/absent or the asserted value is not present in the
 * record.
 */
function verifyClaim(entry: ClaimManifestEntry, facts: VerifiedFacts): Violation | null {
  const { field, value, claimText } = entry;

  switch (field) {
    case "certifications": {
      const certs = facts.certifications ?? [];
      if (certs.length === 0) {
        return {
          code: "missing_backing_field",
          message: `Claim "${claimText}" cites a certification but the record has none.`,
          evidence: claimText,
        };
      }
      if (value !== undefined) {
        const found = certs.some(
          (c) =>
            norm(c.label) === norm(value) ||
            (c.level !== undefined && norm(c.level) === norm(value)) ||
            norm(c.label).includes(norm(value)),
        );
        if (!found) {
          return {
            code: "unbacked_claim",
            message: `Claim "${claimText}" asserts certification "${value}" which is not in the verified-facts record.`,
            evidence: value,
          };
        }
      }
      return null;
    }

    case "warranty": {
      if (!facts.warranty) {
        return {
          code: "missing_backing_field",
          message: `Claim "${claimText}" cites a warranty but the record has none.`,
          evidence: claimText,
        };
      }
      if (value !== undefined) {
        const w = facts.warranty;
        const hay = norm(w.terms);
        const needle = norm(value);
        const yearsMatch = w.years !== undefined && needle.includes(String(w.years));
        const lifetimeMatch = w.lifetime && needle.includes("lifetime");
        if (!hay.includes(needle) && !needle.includes(hay) && !yearsMatch && !lifetimeMatch) {
          return {
            code: "unbacked_claim",
            message: `Claim "${claimText}" asserts warranty "${value}" which the record does not support (record: "${w.terms}").`,
            evidence: value,
          };
        }
      }
      return null;
    }

    case "yearsInBusiness": {
      if (facts.yearsInBusiness === undefined) {
        return {
          code: "missing_backing_field",
          message: `Claim "${claimText}" cites years in business but the record has none.`,
          evidence: claimText,
        };
      }
      if (value !== undefined) {
        const claimed = parseInt(value.replace(/\D/g, ""), 10);
        // Over-claiming the tenure is unbacked; claiming fewer years is fine.
        if (!Number.isNaN(claimed) && claimed > facts.yearsInBusiness) {
          return {
            code: "unbacked_claim",
            message: `Claim "${claimText}" asserts ${claimed} years in business but the record verifies only ${facts.yearsInBusiness}.`,
            evidence: value,
          };
        }
      }
      return null;
    }

    case "approvedReviewQuotes": {
      const quotes = facts.approvedReviewQuotes ?? [];
      if (quotes.length === 0) {
        return {
          code: "missing_backing_field",
          message: `Claim "${claimText}" uses a review quote but the record has no approved quotes.`,
          evidence: claimText,
        };
      }
      if (value !== undefined) {
        const found = quotes.some(
          (q) => norm(q.quote) === norm(value) || norm(q.quote).includes(norm(value)),
        );
        if (!found) {
          return {
            code: "unbacked_claim",
            message: `Claim "${claimText}" uses a review quote that is not in the approved-quotes list.`,
            evidence: value,
          };
        }
      }
      return null;
    }

    case "rating": {
      // C6 — a rating claim may only bind to a verified rating that clears the
      // ~4.5★ bar, is linkable, and is not over-claimed. Mirrors `scanRating`
      // so a manifest-declared rating is held to the same bar as one detected
      // free-text in the copy.
      const rating = facts.rating;
      if (!rating) {
        return {
          code: "unverified_rating",
          message: `Claim "${claimText}" cites a rating but the record has no verified rating.`,
          evidence: claimText,
        };
      }
      if (rating.value < RATING_STAR_THRESHOLD) {
        return {
          code: "rating_below_threshold",
          message: `Claim "${claimText}" surfaces a rating but the verified rating (${rating.value}★) is below the ~${RATING_STAR_THRESHOLD}★ bar.`,
          evidence: claimText,
        };
      }
      if (!rating.profileUrl) {
        return {
          code: "rating_not_linkable",
          message: `Claim "${claimText}" surfaces a rating but the verified rating has no live profile URL to link to.`,
          evidence: claimText,
        };
      }
      if (value !== undefined) {
        const claimed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
        if (!Number.isNaN(claimed) && claimed > rating.value + 1e-9) {
          return {
            code: "overclaimed_rating",
            message: `Claim "${claimText}" asserts ${claimed}★ but the record verifies only ${rating.value}★.`,
            evidence: value,
          };
        }
      }
      return null;
    }

    case "drpDisclosure": {
      const drp = facts.drpDisclosure;
      if (!drp.allowed) {
        return {
          code: "carrier_disclosure_not_allowed",
          message: `Claim "${claimText}" asserts a DRP/carrier relationship but this shop has not opted in (drp_disclosure.allowed = false).`,
          evidence: claimText,
        };
      }
      if (value !== undefined) {
        const ok = drp.authorizedCarriers.some((c) => norm(c) === norm(value));
        if (!ok) {
          return {
            code: "carrier_not_authorized",
            message: `Claim "${claimText}" names carrier "${value}" which is not in this shop's authorized-carrier list.`,
            evidence: value,
          };
        }
      }
      return null;
    }

    default: {
      // Exhaustiveness guard — a new ClaimField must extend this switch.
      const _exhaustive: never = field;
      return {
        code: "missing_backing_field",
        message: `Claim "${claimText}" references unknown field "${String(_exhaustive)}".`,
        evidence: claimText,
      };
    }
  }
}

/** Verify every entry in a claims manifest against the verified-facts record. */
export function verifyManifest(
  manifest: readonly ClaimManifestEntry[],
  facts: VerifiedFacts,
): Violation[] {
  const violations: Violation[] = [];
  for (const entry of manifest) {
    const v = verifyClaim(entry, facts);
    if (v) violations.push(v);
  }
  return violations;
}

export type CheckInput = {
  /** Rendered output text (body + meta), scanned by the denylist. */
  text: string;
  /** The claims manifest that ships with the output (spec §3). */
  manifest: readonly ClaimManifestEntry[];
  /** The shop's verified-facts record — the only source of assertable facts. */
  facts: VerifiedFacts;
};

/**
 * Run the full claim-integrity gate (Check 2). Returns a HARD-FAIL reject on any
 * violation, ship otherwise. This is the single entry point the Content Writer
 * (and the QA validation run, PSG-145) calls before an output can pass.
 */
export function checkClaimIntegrity({ text, manifest, facts }: CheckInput): ClaimIntegrityResult {
  const violations: Violation[] = [
    ...verifyManifest(manifest, facts),
    ...scanDenylist(text, facts.drpDisclosure, facts.knownCompetitors),
    // C6 — reviews are the gatekeeper. A rating/review-count mention is a
    // HARD-FAIL unless the shop's verified rating clears the bar and is linkable.
    ...scanRating(text, facts.rating),
  ];

  if (violations.length > 0) {
    return { verdict: "reject", hardFail: true, violations };
  }
  return { verdict: "ship", hardFail: false, violations: [] };
}
