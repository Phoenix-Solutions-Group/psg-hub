// BSM Phase 0 / PSG-143 — Verified-facts record + claim-integrity layer.
//
// Public surface for the compliance spine of the Content Writer engine. The
// Content Writer skill (PSG-142) imports `checkClaimIntegrity` to gate every
// output (Content Writer spec §4, Check 2 — trust-critical HARD-FAIL), and uses
// `verifiedFactsSchema` to load/validate a shop's verified-facts record.
//
// Persistence (the `verified_facts` table + default-deny RLS) is in the sibling
// migration `20260620_verified_facts.sql`. This module is pure/node-testable.

export * from "./types";
export {
  scanDenylist,
  scanCompetitors,
  scanCarrierDisclosure,
  scanAbsoluteCost,
  scanInsuranceImplication,
  scanSuperlatives,
  scanUnverifiableNumbers,
  scanRating,
  CONSOLIDATOR_COMPETITORS,
  KNOWN_CARRIERS,
  ALLOWED_GENERIC_INSURER_PHRASES,
  ABSOLUTE_COST_PATTERNS,
  INSURANCE_CLAIM_IMPLICATION_PATTERNS,
  UNPROVABLE_SUPERLATIVE_PATTERNS,
  UNVERIFIABLE_NUMBER_PATTERNS,
} from "./denylist";
export { checkClaimIntegrity, verifyManifest, type CheckInput } from "./validator";
