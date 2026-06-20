// BSM Phase 0 / PSG-143 — Prohibited-patterns denylist.
//
// Encodes PSG-55 `agent-wiring` §3a (via Content Writer spec Check 2). These
// patterns are enforced against the rendered output text REGARDLESS of the
// claims manifest or the verified facts: even a "true" carrier mention is a
// HARD-FAIL unless the shop's drp_disclosure opt-in clears it.
//
// Pure data + pure functions — no I/O, node-testable.

import type { DrpDisclosure, Violation } from "./types";

/**
 * Major MSO / consolidator brands that are ALWAYS competitors to one of our
 * shops, so they are denied regardless of the per-shop competitor list. Matched
 * as whole words, case-insensitively. Per-shop competitors are added by the
 * validator from `VerifiedFacts.knownCompetitors`.
 */
export const CONSOLIDATOR_COMPETITORS: readonly string[] = [
  "Caliber Collision",
  "Caliber",
  "Gerber Collision",
  "Gerber",
  "Crash Champions",
  "Service King",
  "Classic Collision",
  "Joe Hudson",
  "Joe Hudson's",
  "ABRA Auto",
  "Maaco",
  "CARSTAR",
];

/**
 * Insurance carriers we recognise for disclosure-gating. Naming any of these is
 * a HARD-FAIL unless the shop opted in AND the carrier is authorized. The list
 * is deliberately broad; unknown carriers slip through name-detection but a
 * carrier *claim* in the manifest is still gated by the validator.
 */
export const KNOWN_CARRIERS: readonly string[] = [
  "State Farm",
  "Geico",
  "GEICO",
  "Progressive",
  "Allstate",
  "USAA",
  "Farmers",
  "Liberty Mutual",
  "Nationwide",
  "Travelers",
  "American Family",
  "Esurance",
  "Mercury Insurance",
  "The General",
  "Safeco",
  "AAA Insurance",
];

/**
 * Generic insurer phrases that are explicitly OK (spec §5: "We work with all
 * major insurers" is allowed). These contain no carrier name, so they never
 * trip carrier detection in `scanCarrierDisclosure` and pass naturally — no
 * special-casing required. Retained as a documentation of the allowed §5
 * phrasing and for any future copy-generation guidance.
 */
export const ALLOWED_GENERIC_INSURER_PHRASES: readonly string[] = [
  "all major insurers",
  "all major insurance companies",
  "most major insurers",
  "all insurance companies",
  "any insurance company",
  "all major carriers",
  "your insurance company",
];

/**
 * Absolute-cost promises that are never permitted (spec Check 2): the shop may
 * not promise the customer a specific cost outcome. Each is a whole-phrase,
 * case-insensitive regex.
 */
export const ABSOLUTE_COST_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\bno charge\b/i, label: '"no charge"' },
  { re: /\bno cost to you\b/i, label: '"no cost to you"' },
  { re: /\bfree of charge\b/i, label: '"free of charge"' },
  { re: /\brental (is )?(covered|free|included|on us)\b/i, label: "rental cost promise" },
  { re: /\bfree rental\b/i, label: '"free rental"' },
  { re: /\bwe (waive|cover|pay|eat) (your )?deductible\b/i, label: "deductible promise" },
  { re: /\b(your )?deductible (is )?(waived|covered|on us|free)\b/i, label: "deductible promise" },
  { re: /\bwon'?t (cost|pay) (you )?(a (penny|dime|cent)|anything)\b/i, label: "zero-cost promise" },
];

/**
 * Phrasing that implies every job is an insurance claim (spec Check 2: never
 * imply that). Distinct from naming a carrier.
 */
export const INSURANCE_CLAIM_IMPLICATION_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\bevery (repair|job) is (an? )?insurance claim\b/i, label: "implies every job is a claim" },
  { re: /\ball (repairs|jobs) are (covered by|paid by|through) insurance\b/i, label: "implies all jobs insured" },
  { re: /\byour insurance (will )?(pays?|covers?) (it|everything|the whole|all)\b/i, label: "implies insurance pays all" },
  { re: /\bwe only (do|handle|take) insurance (work|jobs|claims)\b/i, label: "implies insurance-only" },
];

/** Build a case-insensitive whole-word/phrase matcher for a literal string. */
function literalPhraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b only works at alnum boundaries; for multi-word brand names this is fine
  // because the boundary is anchored on the first/last alnum char.
  return new RegExp(`\\b${escaped}\\b`, "i");
}

/**
 * Scan output text for prohibited competitor mentions. The built-in consolidator
 * list is always enforced; `extraCompetitors` adds per-shop names.
 */
export function scanCompetitors(text: string, extraCompetitors: readonly string[] = []): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  // Match longest brand names first and mask each match so a contained alias
  // (e.g. "Caliber" inside "Caliber Collision") does not double-flag the same span.
  let working = text;
  const names = [...new Set([...CONSOLIDATOR_COMPETITORS, ...extraCompetitors])].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const re = literalPhraseRegex(name);
    if (re.test(working)) {
      violations.push({
        code: "competitor_mention",
        message: `Copy names or references a competitor ("${name}"). Competitors must never be named (Check 2).`,
        evidence: name,
      });
      working = working.replace(new RegExp(re.source, "gi"), " ");
    }
  }
  return violations;
}

/**
 * Scan output text for carrier names that are not cleared by the shop's
 * drp_disclosure opt-in. Default = never disclose. A carrier is permitted only
 * when `allowed` is true AND the carrier is in `authorizedCarriers`. Generic
 * "all major insurers"-style phrasing is always OK.
 */
export function scanCarrierDisclosure(text: string, drp: DrpDisclosure): Violation[] {
  const violations: Violation[] = [];
  const authorized = new Set(drp.authorizedCarriers.map((c) => c.toLowerCase()));
  const seen = new Set<string>();
  for (const carrier of KNOWN_CARRIERS) {
    const key = carrier.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!literalPhraseRegex(carrier).test(text)) continue;
    // NOTE: no generic-phrase guard here. Generic phrasing (e.g. "all major
    // insurers") contains no carrier name, so the literal-phrase regex above
    // never matches it — it passes naturally. A whole-text guard would instead
    // suppress ALL carrier flagging whenever any generic phrase appeared, which
    // defeats Check 2 (PSG-150 false-negative).

    if (!drp.allowed) {
      violations.push({
        code: "carrier_disclosure_not_allowed",
        message: `Copy names carrier "${carrier}" but this shop has not opted in to DRP/carrier disclosure (drp_disclosure.allowed = false). Default HARD-FAIL.`,
        evidence: carrier,
      });
    } else if (!authorized.has(key)) {
      violations.push({
        code: "carrier_not_authorized",
        message: `Copy names carrier "${carrier}" which is not in this shop's authorized-carrier list. Only authorized carriers may be disclosed.`,
        evidence: carrier,
      });
    }
  }
  return violations;
}

/** Scan for absolute-cost promises. */
export function scanAbsoluteCost(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const { re, label } of ABSOLUTE_COST_PATTERNS) {
    const m = text.match(re);
    if (m) {
      violations.push({
        code: "absolute_cost_promise",
        message: `Copy makes a prohibited absolute-cost promise (${label}). Never promise absolute costs (Check 2).`,
        evidence: m[0],
      });
    }
  }
  return violations;
}

/** Scan for phrasing that implies every job is an insurance claim. */
export function scanInsuranceImplication(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const { re, label } of INSURANCE_CLAIM_IMPLICATION_PATTERNS) {
    const m = text.match(re);
    if (m) {
      violations.push({
        code: "implies_insurance_claim",
        message: `Copy ${label}. Never imply every job is an insurance claim (Check 2).`,
        evidence: m[0],
      });
    }
  }
  return violations;
}

/**
 * Run the full prohibited-patterns denylist against rendered output text. This
 * is independent of the claims manifest — it catches violations even when the
 * manifest is clean.
 */
export function scanDenylist(
  text: string,
  drp: DrpDisclosure,
  extraCompetitors: readonly string[] = [],
): Violation[] {
  return [
    ...scanCompetitors(text, extraCompetitors),
    ...scanCarrierDisclosure(text, drp),
    ...scanAbsoluteCost(text),
    ...scanInsuranceImplication(text),
  ];
}
