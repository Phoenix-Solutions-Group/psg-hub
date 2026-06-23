/**
 * Production trigger + suppression engine (L3, PSG-115c / PSG-218).
 *
 * Extends the pure mail-merge renderer (./templates.ts) from "fill one template"
 * to PSG's historical Master Follow-Up decision tree: which letters a recipient
 * earns is driven by the survey→EMI engagement signal and the repair record, not
 * by raw CSI. This module encodes that tree as named, marketing-tunable rules and
 * enforces the suppression hard-rules BEFORE a batch is built.
 *
 * The engagement-tier model + suppression policy here implement the named rules
 * in PSG-115d's W1 spec (docs/marketing/direct-mail/w1-copy-and-emi-segment-rules.md,
 * Part B1–B3) and pass its B4 test cases. Thresholds are tunable params (defaults
 * below) to be recalibrated against the 30-yr distribution in W0 (PSG-115e).
 *
 * Grounded in PSG's real 6-letter Master Follow-Up Program
 * (docs/psg/master-follow-up-program):
 *   1. Recommend An Agent          — survey shows agent dissatisfaction
 *   2. Agent Customer Acknowledgement — sent to the AGENT (repair started)
 *   3. Customer Call Your Agent    — survey returned + agent identified + happy
 *   4. Totaled Vehicle             — vehicle not repaired here (total loss)
 *   5. Perfect Score               — rated the experience 100%
 *   6. Estimate Follow Up          — unclosed estimate, shop-designated
 * plus the always-on Thank-You and Warranty relationship pieces and the
 * Owner Service-Recovery letter for the Disengaged tier.
 *
 * This module is PURE: no DB, no clock, no network. The batch service assembles
 * `CustomerAttributes` from survey_responses + repair_orders rows and a
 * `SuppressionList` (PSG-115e provides the live list / priors; the interface is
 * the integration point, not a hard dependency).
 */

import type { TemplateFlags } from "./templates";

/* -------------------------------------------------------------------------- */
/* Engagement tier (survey→EMI, NOT raw CSI) — PSG-115d Part B1                */
/* -------------------------------------------------------------------------- */

/**
 * Engagement tier derived from EMI (Experience Management Index). PSG's thesis
 * is that CSI is a poor predictor of behaviour; EMI segments customers by true
 * engagement. "Disengaged" is the recovery-only segment (PSG-115d §10.4).
 */
export type EngagementTier = "FullyEngaged" | "Engaged" | "NotEngaged" | "Disengaged";

/** Powertrain class, used for EV/ICE block selection. */
export type Powertrain = "EV" | "ICE";

/**
 * Marketing-tunable EMI cut points, as 0..1 fractions matching
 * `survey_responses.scale_emi_pct` (numeric(7,6)). Named params per PSG-115d
 * B1; defaults below are to be recalibrated against the published 30-yr
 * distribution in W0 (PSG-115e: Fully 6.88% / Engaged 9.32% / NotEngaged
 * 82.59% / Disengaged 1.21%).
 */
export const ENGAGEMENT_THRESHOLDS = {
  /** `tier.fully_min` — >= AND would-refer AND no-unresolved → FullyEngaged. */
  fullyMin: 0.95,
  /** `tier.engaged_min` — >= AND would-refer AND no-unresolved → Engaged. */
  engagedMin: 0.85,
  /** `tier.notengaged_min` — below this (alone) forces Disengaged. */
  notEngagedMin: 0.6,
} as const;

/** A "perfect score" is EMI = 100% (fraction 1.0). */
export const PERFECT_SCORE_EMI = 1 as const;

/**
 * Repair-dollar trigger thresholds (USD). PSG let each client pick a fixed
 * trigger amount per mailing (e.g. ">$750", ">$1000"); we expose the standard
 * tiers as flags so a template can branch on investment level.
 */
export const REPAIR_THRESHOLDS = [500, 750, 1000] as const;

/* -------------------------------------------------------------------------- */
/* Attributes the engine reads                                                */
/* -------------------------------------------------------------------------- */

/**
 * Per-recipient attributes assembled from survey + repair data. Field sources
 * (PSG-115d B0, verified in schema): `emi`←`survey_responses.scale_emi_pct`;
 * `wouldRecommend`←`would_recommend`; `unresolvedIssue`←`unresolved_issue_flag`
 * (mapped from `SQ_Unresolved_Shop = Yes`); `totalLoss`←`total_loss_flag`.
 */
export interface CustomerAttributes {
  /**
   * EMI as a 0..1 fraction (e.g. 0.9 = 90%), matching `scale_emi_pct`. Drives
   * the engagement tier. `null`/undefined = no survey response yet.
   */
  emi?: number | null;
  /** Survey "would refer this facility?" — `would_recommend`. */
  wouldRecommend?: boolean;
  /**
   * Customer reported an unresolved issue — `unresolved_issue_flag`
   * (`SQ_Unresolved_Shop = Yes`). THE recovery trigger (PSG-115d B1).
   */
  unresolvedIssue?: boolean;
  /** Explicit tier override; derived from the above when omitted. */
  engagementTier?: EngagementTier;
  /** A survey was returned / completed. */
  surveyReturned?: boolean;
  /** Insurance agent identified on the survey / repair order. */
  agentIdentified?: boolean;
  /** Survey flagged dissatisfaction with the customer's current agent. */
  agentDissatisfied?: boolean;
  /** Vehicle was a total loss — not repaired at this shop. */
  totalLoss?: boolean;
  /** Repeat (vs first-time) customer. */
  repeatCustomer?: boolean;
  /** Repair total in dollars (drives the repair-$ trigger flags). */
  repairTotal?: number | null;
  /** Powertrain class for EV/ICE block selection. */
  powertrain?: Powertrain;
  /** Workmanship warranty still in force. */
  inWarranty?: boolean;
  /** Unclosed estimate (potential customer), shop-designated for follow-up. */
  estimateOnly?: boolean;
  /** Fleet / no mailable consumer contact — consumer pieces are suppressed. */
  fleet?: boolean;
}

/** Attributes with the tier resolved — what rules actually evaluate against. */
export interface NormalizedAttributes extends CustomerAttributes {
  engagementTier: EngagementTier;
  /** True when this is a repair customer (repaired here, not estimate-only). */
  isRepairCustomer: boolean;
}

/**
 * Derive the engagement tier (PSG-115d B1). Precedence matters:
 *
 *   1. An explicit `engagementTier` always wins.
 *   2. **Disengaged is the override** — fires on `unresolvedIssue`, an explicit
 *      `wouldRecommend === false`, OR EMI below `notEngagedMin`. This is the
 *      recovery trigger.
 *   3. Otherwise band by EMI. FullyEngaged / Engaged additionally require the
 *      customer is not an explicit detractor and reported no unresolved issue.
 *
 * Misfire ≠ Disengaged guard: a merely-imperfect score where the customer would
 * still refer and flagged no unresolved issue lands in Engaged/NotEngaged — NOT
 * Disengaged — so the recovery letter never over-fires at happy-but-sub-100
 * customers (PSG-115d B1, evidence-grounded).
 */
export function deriveEngagementTier(attrs: CustomerAttributes): EngagementTier {
  if (attrs.engagementTier) return attrs.engagementTier;

  const { fullyMin, engagedMin, notEngagedMin } = ENGAGEMENT_THRESHOLDS;
  const emi = attrs.emi;
  const detractor = attrs.wouldRecommend === false;
  const unresolved = attrs.unresolvedIssue === true;

  // 2. Disengaged override (the recovery trigger).
  if (unresolved || detractor || (emi != null && emi < notEngagedMin)) {
    return "Disengaged";
  }

  // No EMI signal yet and no negative flags → neutral middle (not punished).
  if (emi == null) return "NotEngaged";

  // 3. Positive bands — never apply to a detractor / unresolved (caught above).
  if (emi >= fullyMin) return "FullyEngaged";
  if (emi >= engagedMin) return "Engaged";
  return "NotEngaged";
}

/** Resolve the derived fields the rules and flags depend on. */
export function normalizeAttributes(attrs: CustomerAttributes): NormalizedAttributes {
  return {
    ...attrs,
    engagementTier: deriveEngagementTier(attrs),
    isRepairCustomer: !attrs.estimateOnly,
  };
}

/* -------------------------------------------------------------------------- */
/* Letter pieces + trigger rules (L3)                                         */
/* -------------------------------------------------------------------------- */

/** Named letter pieces in PSG's Master Follow-Up Program. */
export type LetterPiece =
  | "service_recovery"
  | "perfect_score"
  | "recommend_agent"
  | "agent_acknowledgement"
  | "call_your_agent"
  | "totaled_vehicle"
  | "estimate_followup"
  | "warranty"
  | "thank_you";

/**
 * Piece category. Suppression operates on these: a Disengaged customer receives
 * `recovery` only; `upsell` is never sent to the disengaged.
 */
export type LetterCategory = "recovery" | "relationship" | "upsell" | "agent";

/** Who the piece is addressed to. Agent pieces survive consumer suppression. */
export type LetterRecipient = "customer" | "agent";

/** A marketing-tunable trigger rule mapping an attribute condition to a piece. */
export interface TriggerRule {
  /** Stable id (used for tests, audit, and tuning). */
  id: string;
  /** PSG marketing name of the letter. */
  name: string;
  piece: LetterPiece;
  category: LetterCategory;
  recipient: LetterRecipient;
  /** Lower fires first; used for stable ordering and any per-batch cap. */
  priority: number;
  /** Selection predicate over normalized attributes. */
  when: (a: NormalizedAttributes) => boolean;
}

/**
 * The Master Follow-Up decision tree, encoded. Order here is documentation only
 * — selection sorts by `priority`. Each `when` is intentionally small and
 * independently testable so marketing can re-tune a rule without touching copy.
 */
export const TRIGGER_RULES: readonly TriggerRule[] = [
  {
    id: "service_recovery",
    name: "Owner Service-Recovery",
    piece: "service_recovery",
    category: "recovery",
    recipient: "customer",
    priority: 5,
    // PSG-115d B3: survey returned AND Disengaged → the recovery safety net.
    when: (a) => a.isRepairCustomer && a.surveyReturned === true && a.engagementTier === "Disengaged",
  },
  {
    id: "totaled_vehicle",
    name: "Totaled Vehicle",
    piece: "totaled_vehicle",
    category: "relationship",
    recipient: "customer",
    priority: 10,
    when: (a) => a.totalLoss === true,
  },
  {
    id: "recommend_agent",
    name: "Recommend An Agent",
    piece: "recommend_agent",
    category: "recovery",
    recipient: "customer",
    priority: 15,
    // Empathy letter for a customer unhappy with their current insurance agent.
    when: (a) => a.agentDissatisfied === true,
  },
  {
    id: "perfect_score",
    name: "Perfect Score",
    piece: "perfect_score",
    category: "relationship",
    recipient: "customer",
    priority: 20,
    // Rated the experience 100% (EMI = 1.0).
    when: (a) => a.surveyReturned === true && a.emi === PERFECT_SCORE_EMI,
  },
  {
    id: "agent_acknowledgement",
    name: "Agent Customer Acknowledgement",
    piece: "agent_acknowledgement",
    category: "agent",
    recipient: "agent",
    priority: 25,
    // Sent to the AGENT once their client chose this shop for the repair.
    when: (a) => a.isRepairCustomer && a.agentIdentified === true,
  },
  {
    id: "call_your_agent",
    name: "Customer Call Your Agent",
    piece: "call_your_agent",
    category: "relationship",
    recipient: "customer",
    priority: 30,
    // Happy customer with an identified agent → ask them to call the agent.
    when: (a) =>
      a.surveyReturned === true &&
      a.agentIdentified === true &&
      a.agentDissatisfied !== true &&
      a.engagementTier !== "Disengaged",
  },
  {
    id: "warranty",
    name: "Workmanship Warranty",
    piece: "warranty",
    category: "relationship",
    recipient: "customer",
    priority: 35,
    when: (a) => a.isRepairCustomer && a.totalLoss !== true && a.inWarranty === true,
  },
  {
    id: "estimate_followup",
    name: "Estimate Follow Up",
    piece: "estimate_followup",
    category: "upsell",
    recipient: "customer",
    priority: 40,
    // Acquisition coupon for an unclosed, shop-designated estimate.
    when: (a) => a.estimateOnly === true,
  },
  {
    id: "thank_you",
    name: "Thank You",
    piece: "thank_you",
    category: "relationship",
    recipient: "customer",
    priority: 50,
    // Always-on relationship piece for a completed repair that is not a write-off.
    // PSG-115d B3: universal at delivery, NOT tier-gated.
    when: (a) => a.isRepairCustomer && a.totalLoss !== true,
  },
] as const;

/** One selected letter for a recipient (before suppression). */
export interface SelectedLetter {
  ruleId: string;
  piece: LetterPiece;
  name: string;
  category: LetterCategory;
  recipient: LetterRecipient;
  priority: number;
}

/**
 * Select every letter a recipient earns, ordered by priority. Pure tree
 * evaluation — suppression is a separate, enforced step (see `buildLetterPlan`).
 */
export function selectLetters(
  attrs: CustomerAttributes,
  rules: readonly TriggerRule[] = TRIGGER_RULES
): SelectedLetter[] {
  const normalized = normalizeAttributes(attrs);
  return rules
    .filter((rule) => rule.when(normalized))
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => ({
      ruleId: rule.id,
      piece: rule.piece,
      name: rule.name,
      category: rule.category,
      recipient: rule.recipient,
      priority: rule.priority,
    }));
}

/* -------------------------------------------------------------------------- */
/* Suppression engine (hard rules, enforced before batch) — PSG-115d B3       */
/* -------------------------------------------------------------------------- */

/**
 * Do-not-mail list. PSG-115e provides the live implementation (opt-outs, bad
 * addresses, recent-contact dedup, empirical priors); the engine only needs the
 * membership check. `reason` is surfaced in the suppression audit.
 */
export interface SuppressionList {
  has(key: string): boolean;
  reason?(key: string): string | undefined;
}

/** Reason a specific letter was dropped, for the suppression audit trail. */
export type SuppressionReason =
  | "do_not_mail"
  | "fleet_no_contact"
  | "disengaged_recovery_only";

/** A letter dropped by the suppression engine, with the reason. */
export interface SuppressedLetter extends SelectedLetter {
  suppressionReason: SuppressionReason;
  detail?: string;
}

/** Result of running selection + suppression for one recipient. */
export interface LetterPlan {
  /** Letters cleared to send, in priority order. */
  letters: SelectedLetter[];
  /** Letters removed, with the hard-rule that removed them. */
  suppressed: SuppressedLetter[];
  /** The resolved tier, echoed for the batch / audit. */
  engagementTier: EngagementTier;
}

/** An empty suppression list — the default when PSG-115e is not yet wired. */
export function emptySuppressionList(): SuppressionList {
  return { has: () => false };
}

/** Build a suppression list from a set of keys (e.g. for tests / static lists). */
export function suppressionListFromSet(
  keys: Iterable<string>,
  reason?: (key: string) => string | undefined
): SuppressionList {
  const set = new Set(keys);
  return { has: (key) => set.has(key), reason };
}

/** Options for `buildLetterPlan`. */
export interface BuildLetterPlanOptions {
  /** Stable key (customer id / address hash) checked against the list. */
  suppressionKey?: string;
  /** PSG-115e suppression list; defaults to empty. */
  suppressionList?: SuppressionList;
  /** Override the rule set (defaults to the full Master Follow-Up tree). */
  rules?: readonly TriggerRule[];
}

/**
 * The batch entry point: select the earned letters, then enforce the suppression
 * HARD-RULES before anything is queued. In precedence order:
 *
 *   1. do_not_mail            — recipient is on the PSG-115e list → drop everything.
 *   2. fleet_no_contact       — no mailable consumer → drop consumer pieces
 *                               (agent pieces survive).
 *   3. disengaged_recovery_only — a Disengaged customer receives `recovery`
 *                               consumer pieces ONLY; upsell/relationship are
 *                               dropped. Agent pieces are unaffected. (PSG-115d
 *                               §10.4 — non-negotiable, enforced before batch.)
 *
 * Returns the cleared letters plus an audit of what was suppressed and why.
 */
export function buildLetterPlan(
  attrs: CustomerAttributes,
  options: BuildLetterPlanOptions = {}
): LetterPlan {
  const { suppressionKey, suppressionList = emptySuppressionList(), rules } = options;
  const normalized = normalizeAttributes(attrs);
  const selected = selectLetters(attrs, rules);
  const letters: SelectedLetter[] = [];
  const suppressed: SuppressedLetter[] = [];

  // 1. Do-not-mail wins outright.
  if (suppressionKey !== undefined && suppressionList.has(suppressionKey)) {
    const detail = suppressionList.reason?.(suppressionKey);
    for (const letter of selected) {
      suppressed.push({ ...letter, suppressionReason: "do_not_mail", detail });
    }
    return { letters, suppressed, engagementTier: normalized.engagementTier };
  }

  const disengaged = normalized.engagementTier === "Disengaged";
  for (const letter of selected) {
    const isConsumer = letter.recipient === "customer";

    // 2. Fleet: no consumer contact.
    if (attrs.fleet === true && isConsumer) {
      suppressed.push({ ...letter, suppressionReason: "fleet_no_contact" });
      continue;
    }

    // 3. Disengaged → recovery only (consumer pieces).
    if (disengaged && isConsumer && letter.category !== "recovery") {
      suppressed.push({ ...letter, suppressionReason: "disengaged_recovery_only" });
      continue;
    }

    letters.push(letter);
  }

  return { letters, suppressed, engagementTier: normalized.engagementTier };
}

/* -------------------------------------------------------------------------- */
/* No-offer guard for the recovery template (PSG-115d B3 / §10.4)             */
/* -------------------------------------------------------------------------- */

/**
 * Offer / coupon / price language that must NEVER resolve into the Owner
 * Service-Recovery letter — recovery is relationship-only. A render of the
 * recovery piece is rejected if any of these surface (PSG-115d §10.4,
 * Honest-claims lens).
 */
const RECOVERY_OFFER_PATTERN =
  /\b(coupon|discount|\d+%\s*off|% off|save \$|\$\d|free (?:detail|wash|service|gift)|special offer|promo(?:tion|tional)?\b|deal\b|sale\b|redeem)/i;

/**
 * Validate that rendered recovery content carries no offer/coupon/price hook.
 * Returns `{ ok, offenders }`; the batch service should refuse to queue a
 * recovery piece when `ok` is false.
 */
export function validateRecoveryContent(html: string): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  const matcher = new RegExp(RECOVERY_OFFER_PATTERN.source, "ig");
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(html)) !== null) {
    if (!offenders.includes(match[0])) offenders.push(match[0]);
  }
  return { ok: offenders.length === 0, offenders };
}

/* -------------------------------------------------------------------------- */
/* Flag builder for L2 conditional blocks                                     */
/* -------------------------------------------------------------------------- */

/**
 * Project attributes into the `{{#if flags.xxx}}` condition flags a single
 * template branches on (EV/ICE, in/out of warranty, repeat/first-time,
 * repair-$ threshold, plus the tier/trigger booleans). Feeds
 * `MailMergeData.flags` so the renderer can select blocks per recipient.
 */
export function attributesToFlags(attrs: CustomerAttributes): TemplateFlags {
  const normalized = normalizeAttributes(attrs);
  const repairTotal = normalized.repairTotal ?? 0;
  const flags: TemplateFlags = {
    isEV: normalized.powertrain === "EV",
    isICE: normalized.powertrain === "ICE",
    inWarranty: normalized.inWarranty === true,
    isRepeat: normalized.repeatCustomer === true,
    isFirstTime: normalized.repeatCustomer !== true,
    totalLoss: normalized.totalLoss === true,
    agentIdentified: normalized.agentIdentified === true,
    agentDissatisfied: normalized.agentDissatisfied === true,
    perfectScore: normalized.surveyReturned === true && normalized.emi === PERFECT_SCORE_EMI,
    disengaged: normalized.engagementTier === "Disengaged",
    tier: normalized.engagementTier,
  };
  for (const threshold of REPAIR_THRESHOLDS) {
    flags[`repairOver${threshold}`] = repairTotal > threshold;
  }
  return flags;
}
