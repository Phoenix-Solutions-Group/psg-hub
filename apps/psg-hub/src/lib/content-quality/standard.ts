// BSM Content-Quality Standard v1.0 — encoded checklist (PSG-752).
//
// Source of truth: the "BSM Content-Quality Standard v1" document (PSG-746),
// owned by Lee (CMO). This module is the machine-readable mirror of that
// standard's 10 checks (C1–C10) plus the two derived text surfaces the runtime
// needs:
//   1. `buildDraftingGuidance()` — the prompt section the Content Writer agent
//      (Wren) embeds so C3–C5, C7 and C9 become required self-checks it must
//      satisfy AND flag uncertainty on, before it emits a draft.
//   2. `buildHumanReviewChecklist()` — the C8 (brand-voice) and C10 (inclusive
//      representation) items surfaced to the human reviewer, which the standard
//      leaves to human judgement.
//
// The machine-checkable checks (C1 honest claims, C2 conversion job, C6 reviews
// gatekeeper) are enforced in code — see `../claim-integrity` (C1/C6) and
// `./conversion-structure` (C2), composed by `./evaluate`. This file is the ONE
// place the standard's shape lives so the prompt, the reviewer checklist, and the
// automated checks never drift from each other.
//
// Pure data + pure string builders — no I/O, node-testable.

/** The standard's three enforcement tiers (PSG-746 §Verdict rule). */
export type CheckTier = 0 | 1 | 2;

/**
 * How a check is enforced against the agent (PSG-746 §4 encoding guide):
 *  - `hard`   — a machine-checked HARD block; a failure REJECTs the draft.
 *  - `prompt` — folded into the drafting prompt as a required self-check the
 *               agent must satisfy and flag uncertainty on (human confirms).
 *  - `human`  — left to the human reviewer's checklist (not machine-decidable).
 */
export type CheckEnforcement = "hard" | "prompt" | "human";

export type ContentQualityCheck = {
  /** Stable id, "C1".."C10", matching the PSG-746 standard. */
  id: string;
  title: string;
  tier: CheckTier;
  enforcement: CheckEnforcement;
  /** True when the rule is enforced automatically in code (C1, C2, C6). */
  machineCheckable: boolean;
  /** One-line plain-English statement of what the check enforces. */
  summary: string;
};

/**
 * The 10 checks of the BSM Content-Quality Standard v1, in run order. Tier-0
 * (C1, C2) failures REJECT; Tier-1/2 failures REVISE (PSG-746 §3).
 */
export const CONTENT_QUALITY_CHECKS: readonly ContentQualityCheck[] = [
  {
    id: "C1",
    title: "Honest claims",
    tier: 0,
    enforcement: "hard",
    machineCheckable: true,
    summary:
      "No certification, insurer/DRP, rating, review count, before/after photo, superlative, or undocumentable number appears without a verified source. Unverifiable ⇒ withhold + flag for human confirmation.",
  },
  {
    id: "C2",
    title: "One conversion job, present and reachable",
    tier: 0,
    enforcement: "hard",
    machineCheckable: true,
    summary:
      "A real tap-to-call (tel:) action and a 'get a free estimate' action are present and reachable early on the shop page, and the primary action repeats as the reader scrolls.",
  },
  {
    id: "C3",
    title: "Answer the rattled customer's real question first",
    tier: 1,
    enforcement: "prompt",
    machineCheckable: false,
    summary:
      "The top of the page reassures (can they fix my car, is insurance handled, can I trust them?) and offers action before any slogan, mission, or company history.",
  },
  {
    id: "C4",
    title: "Insurance + right-to-choose reassurance",
    tier: 1,
    enforcement: "prompt",
    machineCheckable: false,
    summary:
      "State plainly BOTH that the shop works with all insurance companies and handles the claim, AND that it is the customer's choice which shop repairs their car. Name a specific insurer/DRP only if C1-verified.",
  },
  {
    id: "C5",
    title: "Lead with proof, not adjectives",
    tier: 1,
    enforcement: "prompt",
    machineCheckable: false,
    summary:
      "Build trust with provable specifics (exact certification names, written warranty, verified years) placed next to the CTA — not vague praise like 'quality' or 'the best'.",
  },
  {
    id: "C6",
    title: "Reviews are the gatekeeper (≥~4.5★, real, linkable)",
    tier: 1,
    enforcement: "hard",
    machineCheckable: true,
    summary:
      "Surface a rating only when it is the shop's real rating, genuinely clears ~4.5★, and links to a live public profile. Below the bar or unlinkable ⇒ omit. Invented ⇒ REJECT.",
  },
  {
    id: "C7",
    title: "Local, urgent, mobile-first — answer 'how fast?'",
    tier: 1,
    enforcement: "prompt",
    machineCheckable: false,
    summary:
      "Hours, location/map and the estimate action are easy to reach on mobile; the page answers 'how fast?' when the shop can honestly state it; copy is grounded in the shop's real town/service area.",
  },
  {
    id: "C8",
    title: "Brand-voice fidelity",
    tier: 2,
    enforcement: "human",
    machineCheckable: false,
    summary:
      "The page sounds like THIS specific shop (real wedge, matching tone) and could not be lifted onto any other shop's site by swapping the name. No warmth in a money/safety/insurance 'red zone' (Restrained Delight Standard).",
  },
  {
    id: "C9",
    title: "Scannability",
    tier: 2,
    enforcement: "prompt",
    machineCheckable: false,
    summary:
      "A stressed person can skim it: short blocks (no paragraph over ~3 lines / wall of text), clear hierarchy, and a CTA that visually stands out.",
  },
  {
    id: "C10",
    title: "Inclusive & respectful representation",
    tier: 2,
    enforcement: "human",
    machineCheckable: false,
    summary:
      "Imagery and copy pass the Inclusive-Visuals 8-point Pass/Fix/Hold checklist (no non-representative stock people presented as 'our customers', no gendered assumptions about who drives or pays).",
  },
] as const;

/** The checks the agent must self-check inside its drafting prompt (C3–C5, C7, C9). */
export const DRAFTING_SELF_CHECKS = CONTENT_QUALITY_CHECKS.filter(
  (c) => c.enforcement === "prompt",
);

/** The checks left to the human reviewer's judgement (C8, C10). */
export const HUMAN_REVIEW_CHECKS = CONTENT_QUALITY_CHECKS.filter((c) => c.enforcement === "human");

/** The machine-enforced hard blocks (C1, C2, C6). */
export const MACHINE_CHECKS = CONTENT_QUALITY_CHECKS.filter((c) => c.machineCheckable);

/** The one rule everything serves (PSG-746 §2). */
export const ONE_JOB_RULE =
  "Every shop page has exactly ONE job: earn the call or the estimate request. Name that one job at the top of the draft, and cut anything that does not help a rattled customer call, request an estimate, or trust the shop enough to do either.";

/**
 * Build the drafting-prompt section the Content Writer agent (Wren) embeds. It
 * states the one-job rule, restates the hard constraints the automated gate WILL
 * enforce (so the agent self-corrects before the gate rejects), and lists the
 * C3–C5/C7/C9 self-checks the agent must satisfy and flag uncertainty on.
 */
export function buildDraftingGuidance(): string {
  const hard = MACHINE_CHECKS.map((c) => `- ${c.id} (${c.title}): ${c.summary}`).join("\n");
  const self = DRAFTING_SELF_CHECKS.map((c) => `- ${c.id} (${c.title}): ${c.summary}`).join("\n");
  return [
    "## BSM Content-Quality Standard v1 — drafting rules",
    "",
    `ONE JOB: ${ONE_JOB_RULE}`,
    "",
    "HARD CONSTRAINTS (the automated gate will REJECT a draft that breaks these — satisfy them yourself first):",
    hard,
    "",
    "REQUIRED SELF-CHECKS (verify each before you emit a draft; when a fact you'd need is unverified or you are unsure, DO NOT assert it — withhold it and flag it for human confirmation instead of guessing):",
    self,
    "",
    "UNCERTAINTY RULE: unverifiable is not 'soften it' — it is 'remove it and flag it'. Never invent a certification, insurer/DRP relationship, rating, review count, photo, superlative, or hard number.",
  ].join("\n");
}

/**
 * Build the human-review checklist surfaced to the reviewer for the checks the
 * standard leaves to human judgement (C8 brand-voice, C10 inclusive
 * representation). These ride alongside a draft's automated verdict so a reviewer
 * always sees what still needs a human eye before SHIP.
 */
export function buildHumanReviewChecklist(): string {
  const items = HUMAN_REVIEW_CHECKS.map((c) => `- [ ] ${c.id} (${c.title}): ${c.summary}`).join(
    "\n",
  );
  return ["## Human review still required before SHIP", "", items].join("\n");
}
