import { describe, it, expect } from "vitest";
import {
  deriveEngagementTier,
  selectLetters,
  buildLetterPlan,
  attributesToFlags,
  suppressionListFromSet,
  TRIGGER_RULES,
  type CustomerAttributes,
  type LetterPiece,
} from "@/lib/production/triggers";

const pieces = (attrs: CustomerAttributes): LetterPiece[] =>
  selectLetters(attrs).map((l) => l.piece);

const sentPieces = (
  attrs: CustomerAttributes,
  opts?: Parameters<typeof buildLetterPlan>[1]
): LetterPiece[] => buildLetterPlan(attrs, opts).letters.map((l) => l.piece);

describe("deriveEngagementTier (survey→EMI, not raw CSI)", () => {
  it("maps EMI bands to tiers", () => {
    expect(deriveEngagementTier({ emiPct: 100 })).toBe("Champion");
    expect(deriveEngagementTier({ emiPct: 96 })).toBe("Champion");
    expect(deriveEngagementTier({ emiPct: 90 })).toBe("Engaged");
    expect(deriveEngagementTier({ emiPct: 75 })).toBe("Passive");
    expect(deriveEngagementTier({ emiPct: 50 })).toBe("Disengaged");
  });

  it("defaults to Passive when EMI is unknown (no signal, not punished)", () => {
    expect(deriveEngagementTier({})).toBe("Passive");
  });

  it("an explicit tier overrides the EMI band", () => {
    expect(deriveEngagementTier({ emiPct: 100, engagementTier: "Disengaged" })).toBe(
      "Disengaged"
    );
  });
});

describe("selectLetters — trigger rules pick the right piece from fixtures", () => {
  it("EMI=100 returned survey → Perfect Score", () => {
    expect(pieces({ surveyReturned: true, emiPct: 100 })).toContain("perfect_score");
  });

  it("EMI=99 does NOT earn Perfect Score (exact-100 rule)", () => {
    expect(pieces({ surveyReturned: true, emiPct: 99 })).not.toContain("perfect_score");
  });

  it("agent identified on a repair → Agent Acknowledgement (to the agent)", () => {
    const letters = selectLetters({ surveyReturned: true, emiPct: 92, agentIdentified: true });
    const ack = letters.find((l) => l.piece === "agent_acknowledgement");
    expect(ack).toBeDefined();
    expect(ack?.recipient).toBe("agent");
  });

  it("happy customer + agent identified → Call Your Agent", () => {
    expect(pieces({ surveyReturned: true, emiPct: 92, agentIdentified: true })).toContain(
      "call_your_agent"
    );
  });

  it("agent dissatisfaction → Recommend An Agent (recovery), not Call Your Agent", () => {
    const got = pieces({ surveyReturned: true, emiPct: 80, agentIdentified: true, agentDissatisfied: true });
    expect(got).toContain("recommend_agent");
    expect(got).not.toContain("call_your_agent");
  });

  it("total loss → Totaled Vehicle, and no thank-you/warranty", () => {
    const got = pieces({ surveyReturned: true, emiPct: 92, totalLoss: true, inWarranty: true });
    expect(got).toContain("totaled_vehicle");
    expect(got).not.toContain("thank_you");
    expect(got).not.toContain("warranty");
  });

  it("in-warranty completed repair → Warranty + Thank You", () => {
    const got = pieces({ surveyReturned: true, emiPct: 92, inWarranty: true });
    expect(got).toContain("warranty");
    expect(got).toContain("thank_you");
  });

  it("unclosed estimate → Estimate Follow Up (upsell), no thank-you", () => {
    const got = pieces({ estimateOnly: true });
    expect(got).toContain("estimate_followup");
    expect(got).not.toContain("thank_you");
  });

  it("results are ordered by priority", () => {
    const letters = selectLetters({ surveyReturned: true, emiPct: 100, agentIdentified: true, inWarranty: true });
    const priorities = letters.map((l) => l.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("every rule id is unique (no shadowed rules)", () => {
    const ids = TRIGGER_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("suppression hard-rules (engine-enforced before batch)", () => {
  it("DISENGAGED → recovery only: upsell + relationship consumer pieces are dropped", () => {
    const attrs: CustomerAttributes = {
      surveyReturned: true,
      emiPct: 40, // Disengaged
      agentDissatisfied: true, // earns recommend_agent (recovery) + service_recovery
      inWarranty: true, // would earn warranty (relationship) — must be suppressed
    };
    const plan = buildLetterPlan(attrs);
    expect(plan.engagementTier).toBe("Disengaged");

    // Only recovery-category consumer pieces survive.
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

    // And the drops are audited with the right reason.
    const reasons = new Set(plan.suppressed.map((s) => s.suppressionReason));
    expect(reasons.has("disengaged_recovery_only")).toBe(true);
  });

  it("DISENGAGED never receives an upsell", () => {
    const sent = sentPieces({ estimateOnly: true, emiPct: 30 });
    // estimate-only + disengaged: the upsell coupon is suppressed.
    expect(sent).not.toContain("estimate_followup");
  });

  it("agent pieces survive disengaged suppression (different recipient)", () => {
    const plan = buildLetterPlan({ surveyReturned: true, emiPct: 30, agentIdentified: true });
    expect(plan.letters.map((l) => l.piece)).toContain("agent_acknowledgement");
  });

  it("do-not-mail list drops everything for that recipient", () => {
    const list = suppressionListFromSet(["cust-123"], () => "opt-out");
    const plan = buildLetterPlan(
      { surveyReturned: true, emiPct: 100, inWarranty: true },
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
      { surveyReturned: true, emiPct: 100, inWarranty: true },
      { suppressionKey: "cust-123", suppressionList: list }
    );
    expect(sent).toContain("perfect_score");
    expect(sent).toContain("warranty");
  });

  it("fleet drops consumer pieces but keeps agent pieces", () => {
    const plan = buildLetterPlan({
      surveyReturned: true,
      emiPct: 92,
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

  it("an ENGAGED customer keeps relationship + upsell pieces (suppression is targeted)", () => {
    const sent = sentPieces({ surveyReturned: true, emiPct: 92, inWarranty: true });
    expect(sent).toContain("warranty");
    expect(sent).toContain("thank_you");
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
    const flags = attributesToFlags({ surveyReturned: true, emiPct: 100 });
    expect(flags.perfectScore).toBe(true);
    expect(flags.tier).toBe("Champion");
    expect(flags.disengaged).toBe(false);
  });

  it("treats a missing repair total as $0 (no threshold flags set)", () => {
    const flags = attributesToFlags({ powertrain: "ICE" });
    expect(flags.repairOver500).toBe(false);
    expect(flags.isFirstTime).toBe(true);
  });
});
