import { describe, it, expect } from "vitest";
import {
  deriveEngagementTier,
  selectLetters,
  buildLetterPlan,
  attributesToFlags,
  suppressionListFromSet,
  validateRecoveryContent,
  TRIGGER_RULES,
  type CustomerAttributes,
  type EngagementTier,
  type LetterPiece,
} from "@/lib/production/triggers";

const pieces = (attrs: CustomerAttributes): LetterPiece[] =>
  selectLetters(attrs).map((l) => l.piece);

const sentPieces = (
  attrs: CustomerAttributes,
  opts?: Parameters<typeof buildLetterPlan>[1]
): LetterPiece[] => buildLetterPlan(attrs, opts).letters.map((l) => l.piece);

describe("deriveEngagementTier (PSG-115d B1: survey→EMI, not raw CSI)", () => {
  it("FullyEngaged needs EMI>=0.95 + would-refer + no unresolved", () => {
    expect(
      deriveEngagementTier({ emi: 0.98, wouldRecommend: true, unresolvedIssue: false })
    ).toBe("FullyEngaged");
  });

  it("Engaged is EMI>=0.85 (and not a detractor / unresolved)", () => {
    expect(
      deriveEngagementTier({ emi: 0.86, wouldRecommend: true, unresolvedIssue: false })
    ).toBe("Engaged");
  });

  it("NotEngaged is the 0.60..0.85 middle", () => {
    expect(deriveEngagementTier({ emi: 0.7, wouldRecommend: true })).toBe("NotEngaged");
  });

  it("Disengaged fires on EMI below 0.60", () => {
    expect(deriveEngagementTier({ emi: 0.55 })).toBe("Disengaged");
  });

  it("Disengaged OVERRIDES a high EMI when an unresolved issue is flagged", () => {
    // The recovery trigger: even a 0.76 score is Disengaged if unresolved.
    expect(
      deriveEngagementTier({ emi: 0.76, wouldRecommend: true, unresolvedIssue: true })
    ).toBe("Disengaged");
  });

  it("Disengaged OVERRIDES a high EMI when the customer would not refer", () => {
    expect(deriveEngagementTier({ emi: 0.9, wouldRecommend: false })).toBe("Disengaged");
  });

  it("Misfire guard: imperfect-but-happy (would refer, no unresolved) is NOT Disengaged", () => {
    // A 0.86 with one low dimension but still a referrer → Engaged, not recovery.
    const tier = deriveEngagementTier({ emi: 0.86, wouldRecommend: true, unresolvedIssue: false });
    expect(tier).toBe("Engaged");
    expect(tier).not.toBe("Disengaged");
  });

  it("no EMI signal + no negative flags → NotEngaged (pending, not punished)", () => {
    expect(deriveEngagementTier({})).toBe("NotEngaged");
  });

  it("an explicit tier overrides derivation", () => {
    expect(deriveEngagementTier({ emi: 1, engagementTier: "Disengaged" })).toBe("Disengaged");
  });
});

describe("PSG-115d B4 — handed-off test cases (input → tier → action)", () => {
  const tierOf = (a: CustomerAttributes): EngagementTier =>
    buildLetterPlan(a).engagementTier;
  // For B4, "Service-Recovery fires" means the recovery piece is in the SENT set.
  const recoveryFires = (a: CustomerAttributes): boolean =>
    sentPieces({ surveyReturned: true, ...a }).includes("service_recovery");

  it("T1: 0.98 / refer / no-unresolved → FullyEngaged, recovery NOT triggered", () => {
    const a: CustomerAttributes = { emi: 0.98, wouldRecommend: true, unresolvedIssue: false };
    expect(tierOf(a)).toBe("FullyEngaged");
    expect(recoveryFires(a)).toBe(false);
  });

  it("T2: 0.86 Misfire / refer / no-unresolved → Engaged, recovery NOT triggered", () => {
    const a: CustomerAttributes = { emi: 0.86, wouldRecommend: true, unresolvedIssue: false };
    expect(tierOf(a)).toBe("Engaged");
    expect(recoveryFires(a)).toBe(false);
  });

  it("T3: 0.76 / refer / UNRESOLVED (Sandra P-H) → Disengaged, Service-Recovery fires, all else suppressed", () => {
    const a: CustomerAttributes = {
      emi: 0.76,
      wouldRecommend: true,
      unresolvedIssue: true,
      inWarranty: true, // would otherwise earn warranty/thank-you — must be suppressed
    };
    const plan = buildLetterPlan({ surveyReturned: true, ...a });
    expect(plan.engagementTier).toBe("Disengaged");
    const sent = plan.letters.map((l) => l.piece);
    expect(sent).toEqual(["service_recovery"]);
  });

  it("T4: 0.55 / would-not-refer → Disengaged, Service-Recovery fires", () => {
    const a: CustomerAttributes = { emi: 0.55, wouldRecommend: false };
    expect(tierOf(a)).toBe("Disengaged");
    expect(recoveryFires(a)).toBe(true);
  });

  it("T5: total_loss → no Thank-You/Warranty, routes to Totaled Vehicle", () => {
    const got = pieces({ surveyReturned: true, emi: 0.95, totalLoss: true, inWarranty: true });
    expect(got).toContain("totaled_vehicle");
    expect(got).not.toContain("thank_you");
    expect(got).not.toContain("warranty");
  });

  it("T6: 0.96 / refer / repeat → FullyEngaged, repeat flag set for the opening", () => {
    const a: CustomerAttributes = { emi: 0.96, wouldRecommend: true, repeatCustomer: true };
    expect(tierOf(a)).toBe("FullyEngaged");
    expect(attributesToFlags(a).isRepeat).toBe(true);
  });

  it("T7: EMI null (no survey) → NotEngaged, no tier-gated piece, delivery Thank-You still sends", () => {
    const got = pieces({ emi: null }); // surveyReturned omitted
    expect(buildLetterPlan({ emi: null }).engagementTier).toBe("NotEngaged");
    expect(got).toContain("thank_you"); // universal at delivery, not tier-gated
    expect(got).not.toContain("perfect_score");
    expect(got).not.toContain("service_recovery");
  });
});

describe("selectLetters — trigger rules pick the right piece from fixtures", () => {
  it("EMI=100% (1.0) returned survey → Perfect Score", () => {
    expect(pieces({ surveyReturned: true, emi: 1, wouldRecommend: true })).toContain(
      "perfect_score"
    );
  });

  it("EMI=0.99 does NOT earn Perfect Score (exact-100 rule)", () => {
    expect(pieces({ surveyReturned: true, emi: 0.99 })).not.toContain("perfect_score");
  });

  it("agent identified on a repair → Agent Acknowledgement (to the agent)", () => {
    const letters = selectLetters({ surveyReturned: true, emi: 0.92, wouldRecommend: true, agentIdentified: true });
    const ack = letters.find((l) => l.piece === "agent_acknowledgement");
    expect(ack).toBeDefined();
    expect(ack?.recipient).toBe("agent");
  });

  it("happy customer + agent identified → Call Your Agent", () => {
    expect(
      pieces({ surveyReturned: true, emi: 0.92, wouldRecommend: true, agentIdentified: true })
    ).toContain("call_your_agent");
  });

  it("agent dissatisfaction → Recommend An Agent (recovery), not Call Your Agent", () => {
    const got = pieces({ surveyReturned: true, emi: 0.8, agentIdentified: true, agentDissatisfied: true });
    expect(got).toContain("recommend_agent");
    expect(got).not.toContain("call_your_agent");
  });

  it("in-warranty completed repair → Warranty + Thank You", () => {
    const got = pieces({ surveyReturned: true, emi: 0.92, wouldRecommend: true, inWarranty: true });
    expect(got).toContain("warranty");
    expect(got).toContain("thank_you");
  });

  it("unclosed estimate → Estimate Follow Up (upsell), no thank-you", () => {
    const got = pieces({ estimateOnly: true });
    expect(got).toContain("estimate_followup");
    expect(got).not.toContain("thank_you");
  });

  it("results are ordered by priority", () => {
    const letters = selectLetters({ surveyReturned: true, emi: 1, wouldRecommend: true, agentIdentified: true, inWarranty: true });
    const priorities = letters.map((l) => l.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("every rule id is unique (no shadowed rules)", () => {
    const ids = TRIGGER_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("suppression hard-rules (engine-enforced before batch — PSG-115d B3)", () => {
  it("DISENGAGED → recovery only: upsell + relationship consumer pieces are dropped", () => {
    const attrs: CustomerAttributes = {
      surveyReturned: true,
      emi: 0.4, // Disengaged
      agentDissatisfied: true, // earns recommend_agent (recovery) + service_recovery
      inWarranty: true, // would earn warranty (relationship) — must be suppressed
    };
    const plan = buildLetterPlan(attrs);
    expect(plan.engagementTier).toBe("Disengaged");

    for (const letter of plan.letters) {
      if (letter.recipient === "customer") {
        expect(letter.category).toBe("recovery");
      }
    }
    const sent = plan.letters.map((l) => l.piece);
    expect(sent).toContain("service_recovery");
    expect(sent).toContain("recommend_agent");
    expect(sent).not.toContain("warranty");
    expect(sent).not.toContain("thank_you");

    const reasons = new Set(plan.suppressed.map((s) => s.suppressionReason));
    expect(reasons.has("disengaged_recovery_only")).toBe(true);
  });

  it("DISENGAGED never receives an upsell", () => {
    const sent = sentPieces({ estimateOnly: true, emi: 0.3 });
    expect(sent).not.toContain("estimate_followup");
  });

  it("agent pieces survive disengaged suppression (different recipient)", () => {
    const plan = buildLetterPlan({ surveyReturned: true, emi: 0.3, agentIdentified: true });
    expect(plan.letters.map((l) => l.piece)).toContain("agent_acknowledgement");
  });

  it("do-not-mail list drops everything for that recipient", () => {
    const list = suppressionListFromSet(["cust-123"], () => "opt-out");
    const plan = buildLetterPlan(
      { surveyReturned: true, emi: 1, wouldRecommend: true, inWarranty: true },
      { suppressionKey: "cust-123", suppressionList: list }
    );
    expect(plan.letters).toHaveLength(0);
    expect(plan.suppressed.length).toBeGreaterThan(0);
    expect(plan.suppressed.every((s) => s.suppressionReason === "do_not_mail")).toBe(true);
    expect(plan.suppressed[0].detail).toBe("opt-out");
  });

  it("a recipient NOT on the list is unaffected by suppression", () => {
    const list = suppressionListFromSet(["someone-else"]);
    const sent = sentPieces(
      { surveyReturned: true, emi: 1, wouldRecommend: true, inWarranty: true },
      { suppressionKey: "cust-123", suppressionList: list }
    );
    expect(sent).toContain("perfect_score");
    expect(sent).toContain("warranty");
  });

  it("fleet drops consumer pieces but keeps agent pieces", () => {
    const plan = buildLetterPlan({
      surveyReturned: true,
      emi: 0.92,
      wouldRecommend: true,
      agentIdentified: true,
      inWarranty: true,
      fleet: true,
    });
    const sent = plan.letters.map((l) => l.piece);
    expect(sent).toContain("agent_acknowledgement");
    expect(sent).not.toContain("warranty");
    expect(sent).not.toContain("call_your_agent");
    expect(plan.suppressed.some((s) => s.suppressionReason === "fleet_no_contact")).toBe(true);
  });

  it("an ENGAGED customer keeps relationship pieces (suppression is targeted)", () => {
    const sent = sentPieces({ surveyReturned: true, emi: 0.92, wouldRecommend: true, inWarranty: true });
    expect(sent).toContain("warranty");
    expect(sent).toContain("thank_you");
  });
});

describe("no-offer guard for the Owner Service-Recovery letter (PSG-115d §10.4)", () => {
  it("passes a relationship-only recovery body", () => {
    const html =
      "<p>Dear Jane, I'm the owner. I understand your repair didn't meet our standard. " +
      "Please call me directly so I can make it right.</p>";
    expect(validateRecoveryContent(html).ok).toBe(true);
  });

  it("rejects a recovery body that leaked a coupon / discount / offer", () => {
    const offer = validateRecoveryContent("<p>Call us — enjoy 20% off your next visit!</p>");
    expect(offer.ok).toBe(false);
    expect(offer.offenders.length).toBeGreaterThan(0);
  });

  it("rejects free-gift and dollar-discount language too", () => {
    expect(validateRecoveryContent("Here is a free detail on us.").ok).toBe(false);
    expect(validateRecoveryContent("Save $50 when you return.").ok).toBe(false);
  });

  // PSG-319 — the leading-`\b` group never let `\$\d` fire after a space/`>`,
  // so bare dollar-amount offers (the literal value of `program.offer` in the
  // W2 letter matrix) slipped past the guard. Fail closed on any `$NN`.
  it("rejects bare $NN / $NN off offers that the old leading-\\b group missed", () => {
    expect(validateRecoveryContent("$25 off").ok).toBe(false);
    expect(validateRecoveryContent("Present this letter for $50 off your next visit.").ok).toBe(
      false,
    );
    expect(validateRecoveryContent("Bring this in for $25 off when you schedule.").ok).toBe(false);
    // also catches a `>`-prefixed amount (rendered HTML boundary)
    expect(validateRecoveryContent("<span>$30</span>").ok).toBe(false);
    expect(validateRecoveryContent("$ 25 credit").ok).toBe(false);
  });

  // PSG-324 — same leading-`\b` defect as PSG-319, but on the percent branches.
  // `% off` / `\d+%\s*off` sat inside the `\b(?:…)` group, so spaced
  // ("50 % off"), spelled-out ("15 percent off"), bare ("% off"), and
  // no-"off" ("save 20%") percent forms slipped past. Fail closed on ANY `%`.
  it("rejects percent-form offers the old leading-\\b group missed", () => {
    expect(validateRecoveryContent("save 20%").ok).toBe(false);
    expect(validateRecoveryContent("50 % off").ok).toBe(false);
    expect(validateRecoveryContent("15 percent off").ok).toBe(false);
    expect(validateRecoveryContent("% off").ok).toBe(false);
    // forms already caught pre-PSG-324 stay caught
    expect(validateRecoveryContent("10% off").ok).toBe(false);
    expect(validateRecoveryContent("Enjoy 20% off your next visit!").ok).toBe(false);
    expect(validateRecoveryContent("20% discount").ok).toBe(false);
  });

  it("still passes legit relationship-only copy with no offer (phone, job#)", () => {
    const html =
      "<p>Dear Jane, I'm the owner. Please call me directly at (555) 014-2200 about " +
      "Job J-10293 so I can make it right.</p>";
    expect(validateRecoveryContent(html).ok).toBe(true);
  });
});

describe("attributesToFlags — L2 block-selection inputs", () => {
  it("derives EV/ICE, warranty, repeat, and repair-$ threshold flags", () => {
    const flags = attributesToFlags({
      powertrain: "EV",
      inWarranty: true,
      repeatCustomer: true,
      repairTotal: 900,
    });
    expect(flags.isEV).toBe(true);
    expect(flags.isICE).toBe(false);
    expect(flags.inWarranty).toBe(true);
    expect(flags.isRepeat).toBe(true);
    expect(flags.isFirstTime).toBe(false);
    expect(flags.repairOver500).toBe(true);
    expect(flags.repairOver750).toBe(true);
    expect(flags.repairOver1000).toBe(false);
  });

  it("exposes the resolved tier and perfect-score flag", () => {
    const flags = attributesToFlags({ surveyReturned: true, emi: 1, wouldRecommend: true });
    expect(flags.perfectScore).toBe(true);
    expect(flags.tier).toBe("FullyEngaged");
    expect(flags.disengaged).toBe(false);
  });

  it("treats a missing repair total as $0 (no threshold flags set)", () => {
    const flags = attributesToFlags({ powertrain: "ICE" });
    expect(flags.repairOver500).toBe(false);
    expect(flags.isFirstTime).toBe(true);
  });
});
