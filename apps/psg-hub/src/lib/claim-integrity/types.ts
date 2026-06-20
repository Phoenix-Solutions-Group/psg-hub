// BSM Phase 0 / PSG-143 — Verified-facts record + claim-integrity types.
//
// This module is the compliance spine of the Content Writer engine (PSG-142,
// Content Writer spec §2/§4/§5). It is INTENTIONALLY pure (no `server-only`, no
// Supabase, no I/O) so it is node-testable and importable from both the agent
// runtime and the app. Persistence (the `verified_facts` table + RLS) lives in
// the sibling migration; this file is the in-memory contract every claim is
// checked against.
//
// Source of truth: PSG-55 `quality-bar` / `agent-wiring` §3a, translated by the
// PSG-12 Content Writer spec. Where this code and PSG-55 disagree, PSG-55 wins.

import { z } from "zod";

/**
 * The certification kinds we recognise. The Content Writer may only assert a
 * certification that appears in the record, and must use the single highest TRUE
 * credential (quality-bar Check 3 — e.g. I-CAR Platinum over Gold Class).
 */
export const CERT_KINDS = ["i_car", "oem", "manufacturer", "other"] as const;
export type CertKind = (typeof CERT_KINDS)[number];

/** A single verified credential (e.g. I-CAR Gold Class, Honda ProFirst). */
export const certificationSchema = z.object({
  kind: z.enum(CERT_KINDS),
  /** Human-facing label exactly as it may be asserted, e.g. "I-CAR Gold Class". */
  label: z.string().min(1),
  /** Optional level/tier for ranking (e.g. "Gold Class", "Platinum"). */
  level: z.string().min(1).optional(),
  /** Issuing body / OEM, e.g. "Honda", "I-CAR". */
  issuer: z.string().min(1).optional(),
});
export type Certification = z.infer<typeof certificationSchema>;

/** Warranty terms the shop is verified to offer. */
export const warrantySchema = z.object({
  /** Exact assertable terms, e.g. "Lifetime warranty on all repairs". */
  terms: z.string().min(1),
  /** True when the warranty is lifetime — guards against over-claiming. */
  lifetime: z.boolean().default(false),
  /** Fixed-term length in years, when not lifetime. */
  years: z.number().int().positive().optional(),
});
export type Warranty = z.infer<typeof warrantySchema>;

/** A pre-approved customer review quote that copy may reuse verbatim. */
export const reviewQuoteSchema = z.object({
  quote: z.string().min(1),
  attribution: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
});
export type ReviewQuote = z.infer<typeof reviewQuoteSchema>;

/**
 * The DRP / carrier-disclosure opt-in block (Content Writer spec §5, v1.3).
 *
 * DEFAULT = never disclose. Naming an insurer/DRP relationship is a Check 2
 * HARD-FAIL *even when true* unless `allowed` is set for this shop, and then
 * ONLY the named, authorized carriers may be disclosed. No opt-in ⇒ HARD-FAIL.
 */
export const drpDisclosureSchema = z.object({
  /** Master opt-in. When false, no carrier/DRP may ever be named. */
  allowed: z.boolean().default(false),
  /** The exact carriers cleared for disclosure (only meaningful when allowed). */
  authorizedCarriers: z.array(z.string().min(1)).default([]),
  /** Audit: who authorised the opt-in (client/requester identity). */
  authorizedBy: z.string().min(1).optional(),
  /** Audit: when the opt-in was granted (ISO 8601). */
  authorizedAt: z.string().min(1).optional(),
});
export type DrpDisclosure = z.infer<typeof drpDisclosureSchema>;

/**
 * The verified-facts record — the ONLY source of assertable facts for a shop
 * (Content Writer spec §2). Anything not present here is "unverified — HOLD"
 * and must never be asserted.
 */
export const verifiedFactsSchema = z.object({
  shopId: z.string().min(1),
  certifications: z.array(certificationSchema).default([]),
  warranty: warrantySchema.optional(),
  yearsInBusiness: z.number().int().nonnegative().optional(),
  approvedReviewQuotes: z.array(reviewQuoteSchema).default([]),
  drpDisclosure: drpDisclosureSchema.default({ allowed: false, authorizedCarriers: [] }),
  /**
   * Per-shop competitor names to additionally treat as prohibited mentions
   * (e.g. from the competitor engine). The built-in consolidator list is always
   * enforced regardless of this field.
   */
  knownCompetitors: z.array(z.string().min(1)).default([]),
});
export type VerifiedFacts = z.infer<typeof verifiedFactsSchema>;

/**
 * The fields a claims-manifest entry may bind to. Mirrors `VerifiedFacts` keys
 * the Writer is allowed to assert from.
 */
export const CLAIM_FIELDS = [
  "certifications",
  "warranty",
  "yearsInBusiness",
  "approvedReviewQuotes",
  "drpDisclosure",
] as const;
export type ClaimField = (typeof CLAIM_FIELDS)[number];

/**
 * One entry in the claims manifest that ships with every output (spec §3):
 * a factual claim mapped to the verified-facts field that backs it. An entry
 * whose backing cannot be resolved is an unbacked claim ⇒ output cannot pass.
 */
export const claimManifestEntrySchema = z.object({
  /** The factual claim as it appears in the copy. */
  claimText: z.string().min(1),
  /** Which verified-facts field is supposed to back this claim. */
  field: z.enum(CLAIM_FIELDS),
  /**
   * The specific asserted value to verify against the record (e.g. the cert
   * label, the carrier name, the quote, the years number). When omitted we only
   * check that the backing field is present and non-empty.
   */
  value: z.string().min(1).optional(),
});
export type ClaimManifestEntry = z.infer<typeof claimManifestEntrySchema>;

/** Categories of integrity violation, all of which are Check-2 HARD-FAILs. */
export type ViolationCode =
  | "unbacked_claim" // claim has no backing field value in the record
  | "missing_backing_field" // claim references a field that is empty/absent
  | "carrier_disclosure_not_allowed" // carrier named without drp opt-in
  | "carrier_not_authorized" // carrier named but not in authorizedCarriers
  | "competitor_mention" // named/referenced a competitor
  | "absolute_cost_promise" // "no charge" / "rental covered" / "we waive your deductible"
  | "implies_insurance_claim"; // implies every job is an insurance claim

export type Violation = {
  code: ViolationCode;
  /** Operator-facing explanation of what failed and why. */
  message: string;
  /** The offending span / claim text, when available. */
  evidence?: string;
};

export type Verdict = "ship" | "revise" | "reject";

/**
 * The result of a claim-integrity check. Check 2 is a trust-critical HARD-FAIL:
 * any violation ⇒ `verdict: "reject"` and `hardFail: true` — no "pass with
 * notes" (quality-bar §4).
 */
export type ClaimIntegrityResult = {
  verdict: Verdict;
  hardFail: boolean;
  violations: Violation[];
};
