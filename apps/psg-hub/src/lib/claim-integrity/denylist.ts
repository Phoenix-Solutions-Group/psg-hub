// BSM Phase 0 / PSG-143 — Prohibited-patterns denylist.
//
// Encodes PSG-55 `agent-wiring` §3a (via Content Writer spec Check 2). These
// patterns are enforced against the rendered output text REGARDLESS of the
// claims manifest or the verified facts: even a "true" carrier mention is a
// HARD-FAIL unless the shop's drp_disclosure opt-in clears it.
//
// Pure data + pure functions — no I/O, node-testable.

import { RATING_STAR_THRESHOLD, type DrpDisclosure, type Rating, type Violation } from "./types";

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

/**
 * C1 (honest claims) — unprovable superlatives. The BSM Content-Quality Standard
 * v1 lists these as REJECT triggers with NO "unless verified" escape: a
 * superlative that can't be proven is removed, not softened. So — unlike a rating
 * (C6), which is allowed when verified — these are ALWAYS a HARD-FAIL regardless
 * of the verified-facts record.
 *
 * Hardened per PSG-775 (spec: PSG-775 "C1 Hardening Spec") to catch digit-form
 * and reworded rank brags that slipped past the human review in PSG-762 QA:
 *   1a  `#1` / `#1 rated` — the `#` numeral is inherently a rank claim.
 *   1b  `number/no. 1|one` — ONLY in a ranking context (preceded by a claim cue
 *       like "we're"/"voted"/"the", or followed within ~2 words by a rank noun).
 *       Raw "No. 1" is left alone so street addresses ("No. 1 Elm St") and bay
 *       numbers pass — that is the false-positive guard.
 *   1c  `1-rated` / `one-rated`.
 *   1d  self-superlatives: top-rated, highest-rated, finest, premier, the
 *       leading, unbeatable, second to none, best in the business.
 *   1e  `best` ONLY as a business superlative (best + a business/service noun,
 *       or "best in <place>", or preceded by "the"/"#1"). The adverbial "we'll
 *       do our best" is NOT a business superlative, so it passes.
 *   1f  legacy: "voted best", "nobody beats/does it".
 *
 * Each is a case-insensitive, word-boundary regex. Detection is per-segment so
 * the attribution escape hatch (a cited/linked third-party source in the same
 * sentence/element — see `hasAttributionLink`) can clear an otherwise-flagged
 * phrase. No link ⇒ no escape.
 */
export const UNPROVABLE_SUPERLATIVE_PATTERNS: readonly { re: RegExp; label: string }[] = [
  // 1a — hash-numeral rank claim.
  { re: /#\s?1\b/, label: '"#1"' },
  // 1b — "number/no. 1|one" in a ranking context only (claim cue before …).
  {
    re: /\b(?:we(?:'re|\s+are)?|voted|rated|the)\s+(?:the\s+)?(?:number|no\.?)\s?(?:1|one)\b/i,
    label: '"number one" (rank claim)',
  },
  // 1b — … or a rank noun within ~2 words after.
  {
    re: /\b(?:number|no\.?)\s?(?:1|one)\b(?:\s+\w+){0,2}?\s+(?:rated|shops?|body\s?shops?|auto\s?body|collision|repair|choice|name|in\s+town|around)\b/i,
    label: '"number one" (rank claim)',
  },
  // 1c — "1-rated" / "one-rated".
  { re: /\b(?:1|one)[\s-]?rated\b/i, label: '"1-rated"' },
  // 1d — self-applied superlatives.
  {
    re: /\b(?:top[\s-]?rated|highest[\s-]?rated|finest|premier|the leading|unbeatable|second to none|best (?:in the )?business)\b/i,
    label: '"self-superlative"',
  },
  // 1e — "best" as a business superlative (best + business/service noun).
  // PSG-793: "work" was removed from this noun set. "Our best work" is honest
  // craftsmanship copy ("our finest effort"), not a claim to beat every rival,
  // so blocking it over-flagged honest wording. A real superlative like "best
  // body shop / best price" is still caught. (The competitive-ranking sense,
  // "best in <place>", is handled by the two rules just below.)
  {
    re: /\b(?:the\s+|#\s?1\s+)?best\s+(?:body\s?shops?|auto\s?body|collision(?:\s+(?:repair|center|shop))?|repair(?:\s+shop)?|service|price|shops?)\b/i,
    label: '"best <business>"',
  },
  // 1e — "best in <known place-word>". PSG-793: case-insensitive on purpose —
  // headlines are often title-cased ("Best in Town"), and this alternative is a
  // CLOSED set of place words, so folding case here cannot over-match innocent
  // copy. (This is why it is a separate rule from the open proper-noun rule
  // below, which must stay capital-sensitive.)
  {
    re: /\bbest\s+in\s+(?:town|the\s+(?:state|area|city|county|business|region)|[a-z]+\s+county)\b/i,
    label: '"best in …"',
  },
  // 1e — "best in <Proper Noun>" (e.g. "Best in Yonkers"). The place token must
  // start with a real capital, so innocent "best in class / best in stock" still
  // pass; only the leading "Best"/"best" is case-folded (a headline capitalizes
  // it). Keeping the capital requirement here is the false-positive guard, so
  // this rule is intentionally NOT given the /i flag.
  {
    re: /\b[Bb]est\s+in\s+[A-Z][a-zA-Z]+\b/,
    label: '"best in …"',
  },
  // 1f — legacy constructs kept for continuity.
  { re: /\bvoted (?:the )?best\b/i, label: '"voted best"' },
  { re: /\bnobody (?:does it|beats)\b/i, label: '"nobody beats/does it better"' },
];

/**
 * C1 (honest claims) — hard numbers a shop generally cannot document, and for
 * which the verified-facts record has NO backing field (unlike tenure, governed
 * by the `yearsInBusiness` manifest binding).
 *
 * Hardened per PSG-775:
 *   2a  vague magnitude used as proof — "thousands|hundreds|millions of <count
 *       noun>" (and "countless <count noun>", which takes no "of"). Up to 2
 *       adjective tokens are allowed so "hundreds of happy customers" is caught.
 *   2b  an explicit count directly qualifying a count noun — the count-noun set
 *       is widened to families/customers/drivers/jobs/vehicles/cars/repairs and
 *       up to 2 adjective tokens are allowed between the number and the noun, so
 *       "5,000 happy families" (the PSG-762 slip-through) is caught. The
 *       `\d[\d,]{2,}` shape requires ≥3 digit/comma chars, so a 2-digit tenure
 *       ("22 years"), a street number ("1 Elm St"), or a phone number never trip
 *       it.
 *
 * Detection is per-segment so an attributed, documented figure with a link in
 * the same sentence/element can clear (e.g. "Over 200 verified Google reviews"
 * + a live profile link).
 */
// Count nouns are PLURAL-only on purpose: a boast counts many ("5,000 families",
// "thousands of cars"), while the singular ("the repair", "your car") is ordinary
// service copy and must never trip the gate.
const COUNT_NOUNS = "cars|vehicles|customers|families|repairs|drivers|jobs";
// Function words that must NOT count as an "adjective" filler between a number and
// a count noun. Without this guard a founding year would bridge across a clause —
// e.g. "since 1969, and the repair …" would falsely read as a "1969 … repair"
// count. Requiring the filler to be a real modifier keeps "5,000 happy families"
// caught while leaving honest tenure/service copy alone.
const FILLER_STOPWORDS =
  "a|an|the|and|or|of|for|to|in|on|at|our|your|their|my|its|this|that|these|those|with|by|from|as|we|you|they|since|over|more|than|about|around|back";
export const UNVERIFIABLE_NUMBER_PATTERNS: readonly { re: RegExp; label: string }[] = [
  // 2a — "thousands/hundreds/millions of <count noun>" (adjectives allowed).
  {
    re: new RegExp(
      `\\b(?:thousands|hundreds|millions)\\s+of\\s+(?:[a-z]+\\s+){0,2}?(?:${COUNT_NOUNS})\\b`,
      "i",
    ),
    label: "vague large-quantity boast",
  },
  // 2a — "countless <count noun>" (no "of").
  {
    re: new RegExp(`\\bcountless\\s+(?:[a-z]+\\s+){0,2}?(?:${COUNT_NOUNS})\\b`, "i"),
    label: "vague large-quantity boast",
  },
  // 2b — explicit count (≥3 digit/comma chars, anchored so a trailing comma is
  // NOT absorbed into the number) directly qualifying a count noun, with up to 2
  // real-adjective fillers (function words excluded — see FILLER_STOPWORDS).
  {
    re: new RegExp(
      `\\b\\d[\\d,]{2,}\\b\\+?\\s+(?:(?!(?:${FILLER_STOPWORDS})\\b)[a-z]+\\s+){0,2}?(?:${COUNT_NOUNS})\\b`,
      "i",
    ),
    label: "undocumentable count",
  },
];

/**
 * Attribution escape hatch (C1 design rule): a rank/quantity boast PASSES when it
 * is attributed to a named third party with a citation/link in the same sentence
 * or element. We detect the link (an http(s):// or www. URL) in the segment; no
 * link ⇒ no escape. NOTE (deferred to Lee / C8 human review): a link to the
 * shop's OWN site is not third-party attribution, but distinguishing that is a
 * judgment call outside this deterministic gate — the human brand-voice review
 * remains the backstop for that edge.
 */
const ATTRIBUTION_LINK_RE = /(?:https?:\/\/|www\.)[^\s)]+/i;
function hasAttributionLink(segment: string): boolean {
  return ATTRIBUTION_LINK_RE.test(segment);
}

/**
 * Split copy into sentence/element segments so attribution is judged locally: a
 * link two sentences away must not excuse an unattributed brag. Splits on line
 * breaks and sentence terminators; an em-dash citation ("… — Westchester
 * Magazine") is deliberately kept in one segment with its claim.
 */
function toSegments(text: string): string[] {
  return text
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Scan for unprovable superlatives (C1). Always a HARD-FAIL unless attributed. */
export function scanSuperlatives(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const segment of toSegments(text)) {
    if (hasAttributionLink(segment)) continue;
    for (const { re, label } of UNPROVABLE_SUPERLATIVE_PATTERNS) {
      const m = segment.match(re);
      if (m) {
        violations.push({
          code: "unprovable_superlative",
          message: `Copy uses an unprovable superlative (${label}). A claim that can't be proven must be removed, not softened, unless it is attributed to a cited, linked third-party source (C1 honest claims).`,
          evidence: m[0].trim(),
        });
      }
    }
  }
  return violations;
}

/** Scan for undocumentable / vague hard numbers used as proof (C1). */
export function scanUnverifiableNumbers(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const segment of toSegments(text)) {
    if (hasAttributionLink(segment)) continue;
    for (const { re, label } of UNVERIFIABLE_NUMBER_PATTERNS) {
      const m = segment.match(re);
      if (m) {
        violations.push({
          code: "unverifiable_number",
          message: `Copy states a quantity the shop can't document (${label}). Vague or undocumentable numbers must be left out unless a specific figure is attributed to a linked source (C1 honest claims).`,
          evidence: m[0].trim(),
        });
      }
    }
  }
  return violations;
}

/**
 * Star-rating / review-count assertions we detect in copy for C6. Detection is
 * separate from the verdict: a matched rating is ALLOWED only when the shop has a
 * verified rating that clears the bar and is linkable (see `scanRating`). Each
 * captures the asserted numeric value where present so over-claiming can be
 * caught.
 */
const RATING_MENTION_PATTERNS: readonly { re: RegExp; kind: "value" | "count" }[] = [
  { re: /\b([0-5](?:\.\d)?)\s*(?:★|\bstars?\b|-?\s*star\b)/i, kind: "value" },
  { re: /\brated\s+([0-5](?:\.\d)?)\b/i, kind: "value" },
  { re: /\b([0-5](?:\.\d)?)\s*\/\s*5\b/i, kind: "value" },
  { re: /\b(\d[\d,]*)\+?\s+(?:google\s+)?reviews?\b/i, kind: "count" },
  { re: /\bgoogle rating\b/i, kind: "count" },
  { re: /\bstar rating\b/i, kind: "count" },
];

/**
 * C6 — reviews are the gatekeeper. A rating or review count may be surfaced ONLY
 * when the shop's verified record carries a rating that (a) genuinely clears the
 * ~4.5★ bar and (b) is linkable to a live public profile — and the copy must not
 * over-claim past the verified value. Anything else is a HARD-FAIL:
 *   - no verified rating on record ⇒ `unverified_rating` (never invent one)
 *   - verified rating below ~4.5★ ⇒ `rating_below_threshold` (omit, don't dress up)
 *   - verified rating not linkable ⇒ `rating_not_linkable`
 *   - copy asserts more than the record ⇒ `overclaimed_rating`
 * When the copy makes no rating/review-count claim at all, this returns nothing.
 */
export function scanRating(text: string, rating?: Rating): Violation[] {
  let asserted: string | undefined;
  let assertedValue: number | undefined;
  for (const { re, kind } of RATING_MENTION_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    asserted = m[0].trim();
    if (kind === "value" && m[1] !== undefined) {
      const v = Number.parseFloat(m[1]);
      if (!Number.isNaN(v)) assertedValue = v;
    }
    break;
  }
  if (asserted === undefined) return [];

  if (!rating) {
    return [
      {
        code: "unverified_rating",
        message: `Copy surfaces a rating/review count ("${asserted}") but the shop has no verified rating on record. A rating must never be invented — omit it (C6).`,
        evidence: asserted,
      },
    ];
  }
  if (rating.value < RATING_STAR_THRESHOLD) {
    return [
      {
        code: "rating_below_threshold",
        message: `Copy surfaces a rating ("${asserted}") but the shop's verified rating (${rating.value}★) is below the ~${RATING_STAR_THRESHOLD}★ bar. A weak rating is left off, not dressed up (C6).`,
        evidence: asserted,
      },
    ];
  }
  if (!rating.profileUrl) {
    return [
      {
        code: "rating_not_linkable",
        message: `Copy surfaces a rating ("${asserted}") but the verified rating has no live public profile to link to. An unlinkable rating cannot be surfaced (C6).`,
        evidence: asserted,
      },
    ];
  }
  if (assertedValue !== undefined && assertedValue > rating.value + 1e-9) {
    return [
      {
        code: "overclaimed_rating",
        message: `Copy asserts a ${assertedValue}★ rating but the record verifies only ${rating.value}★. Never over-claim the rating (C6).`,
        evidence: asserted,
      },
    ];
  }
  return [];
}

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
    // C1 (honest claims) — always-prohibited unprovable superlatives and
    // undocumentable hard numbers. Text-only, independent of the manifest.
    ...scanSuperlatives(text),
    ...scanUnverifiableNumbers(text),
  ];
}
