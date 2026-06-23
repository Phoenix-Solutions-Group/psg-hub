import { describe, it, expect } from "vitest";
import {
  mineSendPriors,
  renderPriorsSummary,
  splitPiece,
  pieceTrigger,
  segmentKey,
  normalizePayType,
  matchOutcome,
  type SendRecord,
  type OutcomeRecord,
} from "../priors";
import {
  repairCustomerToOutcome,
  surveyToOutcome,
  buildOutcomeStream,
  type OutcomeHashers,
} from "../outcome-sources";

describe("splitPiece — A/B arm derivation", () => {
  it("treats base codes as arm A", () => {
    expect(splitPiece("04")).toEqual({ base: "04", arm: "A" });
    expect(splitPiece("07")).toEqual({ base: "07", arm: "A" });
    expect(splitPiece("t")).toEqual({ base: "t", arm: "A" });
  });
  it("folds the lettered alternate into arm B with the same base", () => {
    expect(splitPiece("04b")).toEqual({ base: "04", arm: "B" });
    expect(splitPiece("10b")).toEqual({ base: "10", arm: "B" });
  });
  it("keeps a bare 'b' (birthday/seasonal) as its own base, arm A", () => {
    expect(splitPiece("b")).toEqual({ base: "b", arm: "A" });
  });
  it("trims whitespace", () => {
    expect(splitPiece("  10b ")).toEqual({ base: "10", arm: "B" });
  });
});

describe("pieceTrigger", () => {
  it("maps known pieces to their program trigger", () => {
    expect(pieceTrigger("t")).toBe("total_loss_thank_you");
    expect(pieceTrigger("04")).toBe("warranty_letter");
    expect(pieceTrigger("07")).toBe("survey_followup_warranty");
    expect(pieceTrigger("12")).toBe("followup_sequence");
    expect(pieceTrigger("b")).toBe("birthday_seasonal");
  });
  it("falls back to 'unknown' for unmapped pieces", () => {
    expect(pieceTrigger("99")).toBe("unknown");
  });
});

describe("normalizePayType bucketing", () => {
  it("buckets the messy real export pay types", () => {
    expect(normalizePayType("Ins Pay (Which Party Unknown)")).toBe("Ins");
    expect(normalizePayType("Claimant (Other Insurance)")).toBe("Ins");
    expect(normalizePayType("Third Party Pay")).toBe("ThirdParty");
    expect(normalizePayType("Customer Pay")).toBe("Customer");
    expect(normalizePayType("")).toBe("unknown");
    expect(normalizePayType(null)).toBe("unknown");
    expect(normalizePayType("Warranty")).toBe("Other");
  });
});

describe("segmentKey", () => {
  const base: SendRecord = { pieceCode: "04", sentDate: "2020-01-01", payType: "Ins Pay", region: "la", repeatCustomer: true };
  it("builds paytype|repeat|region with normalized values", () => {
    expect(segmentKey(base)).toBe("paytype=Ins|repeat=Y|region=LA");
  });
  it("omits repeat when segmentByRepeat is false", () => {
    expect(segmentKey(base, { segmentByRepeat: false })).toBe("paytype=Ins|region=LA");
  });
  it("uses 'unknown' for missing region and repeat=N for false", () => {
    expect(segmentKey({ pieceCode: "04", sentDate: "2020-01-01", payType: "Customer", repeatCustomer: false })).toBe(
      "paytype=Customer|repeat=N|region=unknown"
    );
  });
  it("omits repeat dim when repeatCustomer is null/undefined", () => {
    expect(segmentKey({ pieceCode: "04", sentDate: "2020-01-01", payType: "Ins", region: "TX" })).toBe(
      "paytype=Ins|region=TX"
    );
  });
});

describe("matchOutcome — key priority + date window", () => {
  const idxOf = (outcomes: OutcomeRecord[]) =>
    // exercise via mineSendPriors' indexing by re-implementing buildIndex inputs
    outcomes;
  it("matches on ro_number within the window", () => {
    const send: SendRecord = { pieceCode: "07", sentDate: "2020-01-01", roNumber: "ACRB1" };
    const outcomes: OutcomeRecord[] = [
      { roNumber: "ACRB1", outcomeDate: "2020-03-01", repeat: true, referral: false, surveyReturned: false },
    ];
    const rows = mineSendPriors([send], outcomes, { windowDays: 180 });
    expect(rows[0].nOutcome).toBe(1);
  });
  it("does NOT match an outcome outside the window", () => {
    const send: SendRecord = { pieceCode: "07", sentDate: "2020-01-01", roNumber: "ACRB1" };
    const outcomes: OutcomeRecord[] = [
      { roNumber: "ACRB1", outcomeDate: "2021-06-01", repeat: true, referral: false, surveyReturned: false },
    ];
    const rows = mineSendPriors([send], outcomes, { windowDays: 180 });
    expect(rows[0].nOutcome).toBe(0);
  });
  it("does NOT match an outcome BEFORE the send", () => {
    const send: SendRecord = { pieceCode: "07", sentDate: "2020-06-01", roNumber: "ACRB1" };
    const outcomes: OutcomeRecord[] = [
      { roNumber: "ACRB1", outcomeDate: "2020-01-01", repeat: true, referral: false, surveyReturned: false },
    ];
    const rows = mineSendPriors([send], outcomes, { windowDays: 180 });
    expect(rows[0].nOutcome).toBe(0);
  });
  it("falls back to recipient_hash then household_key when no RO match", () => {
    const send: SendRecord = { pieceCode: "07", sentDate: "2020-01-01", recipientHash: "rc_x", householdKey: "hh_y" };
    const viaRecipient: OutcomeRecord[] = [
      { recipientHash: "rc_x", outcomeDate: "2020-02-01", repeat: false, referral: true, surveyReturned: false },
    ];
    expect(mineSendPriors([send], viaRecipient, {})[0].nOutcome).toBe(1);
    const viaHousehold: OutcomeRecord[] = [
      { householdKey: "hh_y", outcomeDate: "2020-02-01", repeat: false, referral: false, surveyReturned: true },
    ];
    expect(mineSendPriors([{ pieceCode: "07", sentDate: "2020-01-01", householdKey: "hh_y" }], viaHousehold, {})[0].nOutcome).toBe(1);
  });
  it("returns null when there is no candidate at all", () => {
    const built = matchOutcome(
      { pieceCode: "07", sentDate: "2020-01-01", roNumber: "NOPE" },
      { byRo: new Map(), byRecipient: new Map(), byHousehold: new Map() },
      180
    );
    expect(built).toBeNull();
    expect(idxOf([])).toEqual([]);
  });
  it("does not count an in-window but non-positive outcome", () => {
    const send: SendRecord = { pieceCode: "07", sentDate: "2020-01-01", roNumber: "ACRB1" };
    const outcomes: OutcomeRecord[] = [
      { roNumber: "ACRB1", outcomeDate: "2020-02-01", repeat: false, referral: false, surveyReturned: false },
    ];
    const rows = mineSendPriors([send], outcomes, {});
    expect(rows[0].nSent).toBe(1);
    expect(rows[0].nOutcome).toBe(0);
  });
});

describe("mineSendPriors — aggregation + rates", () => {
  it("aggregates sends into (segment, piece, arm) cells with correct rate", () => {
    const sends: SendRecord[] = [
      { pieceCode: "04", sentDate: "2020-01-01", payType: "Ins", region: "LA", repeatCustomer: true, roNumber: "R1" },
      { pieceCode: "04", sentDate: "2020-01-01", payType: "Ins", region: "LA", repeatCustomer: true, roNumber: "R2" },
      { pieceCode: "04b", sentDate: "2020-01-01", payType: "Ins", region: "LA", repeatCustomer: true, roNumber: "R3" },
    ];
    const outcomes: OutcomeRecord[] = [
      { roNumber: "R1", outcomeDate: "2020-02-01", repeat: true, referral: false, surveyReturned: false },
      // R2 no outcome; R3 (arm B) converts
      { roNumber: "R3", outcomeDate: "2020-02-01", repeat: false, referral: true, surveyReturned: false },
    ];
    const rows = mineSendPriors(sends, outcomes, {});
    const armA = rows.find((r) => r.pieceCode === "04" && r.abVariant === "A")!;
    const armB = rows.find((r) => r.pieceCode === "04" && r.abVariant === "B")!;
    expect(armA.nSent).toBe(2);
    expect(armA.nOutcome).toBe(1);
    expect(armA.outcomeRate).toBe(0.5);
    expect(armA.trigger).toBe("warranty_letter");
    expect(armA.segmentKey).toBe("paytype=Ins|repeat=Y|region=LA");
    expect(armB.nSent).toBe(1);
    expect(armB.outcomeRate).toBe(1);
  });
  it("separates segments", () => {
    const sends: SendRecord[] = [
      { pieceCode: "07", sentDate: "2020-01-01", payType: "Ins", region: "LA", roNumber: "R1" },
      { pieceCode: "07", sentDate: "2020-01-01", payType: "Customer", region: "TX", roNumber: "R2" },
    ];
    const rows = mineSendPriors(sends, [], {});
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.segmentKey)).size).toBe(2);
  });
  it("returns deterministically sorted rows", () => {
    const sends: SendRecord[] = [
      { pieceCode: "10b", sentDate: "2020-01-01", payType: "Ins", region: "TX" },
      { pieceCode: "04", sentDate: "2020-01-01", payType: "Ins", region: "LA" },
    ];
    const rows = mineSendPriors(sends, [], {});
    expect(rows.map((r) => r.segmentKey)).toEqual([
      "paytype=Ins|region=LA",
      "paytype=Ins|region=TX",
    ]);
  });
  it("handles empty input", () => {
    expect(mineSendPriors([], [], {})).toEqual([]);
  });
});

describe("renderPriorsSummary", () => {
  it("renders an empty-state notice when there are no priors", () => {
    const md = renderPriorsSummary([], { computedAt: "2026-06-23", windowDays: 180, sourceLabel: "fixture" });
    expect(md).toContain("No priors");
    expect(md).toContain("gated on PSG-216a");
  });
  it("renders trigger sections, the table, and an A/B verdict", () => {
    const sends: SendRecord[] = [
      { pieceCode: "04", sentDate: "2020-01-01", payType: "Ins", region: "LA", roNumber: "R1" },
      { pieceCode: "04", sentDate: "2020-01-01", payType: "Ins", region: "LA", roNumber: "R2" },
      { pieceCode: "04b", sentDate: "2020-01-01", payType: "Ins", region: "LA", roNumber: "R3" },
    ];
    const outcomes: OutcomeRecord[] = [
      { roNumber: "R1", outcomeDate: "2020-02-01", repeat: true, referral: false, surveyReturned: false },
      { roNumber: "R3", outcomeDate: "2020-02-01", repeat: true, referral: false, surveyReturned: false },
    ];
    const rows = mineSendPriors(sends, outcomes, {});
    const md = renderPriorsSummary(rows, { computedAt: "2026-06-23", windowDays: 180, sourceLabel: "fixture demo" });
    expect(md).toContain("## Trigger: warranty_letter");
    expect(md).toContain("| Segment | Piece | Arm | Sent | Outcomes | Rate |");
    expect(md).toContain("A/B verdicts");
    expect(md).toContain("arm **B** wins"); // B 100% vs A 50%
    expect(md).toContain("fixture demo");
  });
});

describe("outcome-sources adapters", () => {
  it("maps a repair-customer row (real RC_* columns) to an outcome", () => {
    const row = {
      RC_SerialNum: "ACRB1440719",
      RC_Date_Out: "2017-12-26 00:00:00",
      RC_Repeat_Yes_No: "Yes",
      RC_Referral_Yes_No: "Yes",
    };
    const o = repairCustomerToOutcome(row);
    expect(o.roNumber).toBe("ACRB1440719");
    expect(o.outcomeDate).toBe("2017-12-26");
    expect(o.repeat).toBe(true);
    expect(o.referral).toBe(true);
    expect(o.surveyReturned).toBe(false);
    expect(o.subsequentRo).toBe(true);
  });
  it("treats a survey row's existence as a returned survey", () => {
    const row = {
      S_RC_RONumber: "900421",
      S_CreationDate: "2018-01-02 00:00:00",
      S_RC_Repeat: "No",
      S_RC_Referral: "Yes",
    };
    const o = surveyToOutcome(row);
    expect(o.roNumber).toBe("900421");
    expect(o.outcomeDate).toBe("2018-01-02");
    expect(o.surveyReturned).toBe(true);
    expect(o.referral).toBe(true);
    expect(o.repeat).toBe(false);
  });
  it("injects hashers for the no-RO fallback keys", () => {
    const hashers: OutcomeHashers = {
      householdKey: (a) => `hh_${a.zip ?? ""}`,
      recipientHash: (n, a) => `rc_${n}_${a.zip ?? ""}`,
    };
    const o = repairCustomerToOutcome(
      {
        RC_SerialNum: "",
        RC_Date_Out: "2020-02-01 00:00:00",
        RC_Repeat_Yes_No: "Yes",
        RC_Cust_First: "JANE",
        RC_Cust_Last: "DOE",
        RC_Cust_Zip: "70001",
      },
      hashers
    );
    expect(o.roNumber).toBeNull();
    expect(o.householdKey).toBe("hh_70001");
    expect(o.recipientHash).toBe("rc_JANE DOE_70001");
  });
  it("buildOutcomeStream merges both sources and drops dateless rows", () => {
    const stream = buildOutcomeStream(
      [{ RC_SerialNum: "R1", RC_Date_Out: "2020-02-01", RC_Repeat_Yes_No: "Yes" }],
      [
        { S_RC_RONumber: "R2", S_CreationDate: "2020-03-01", S_RC_Referral: "Yes" },
        { S_RC_RONumber: "R3", S_CreationDate: "" }, // dropped: no date
      ]
    );
    expect(stream).toHaveLength(2);
    expect(stream.map((o) => o.roNumber)).toEqual(["R1", "R2"]);
  });

  it("end-to-end: normalized outcomes drive the miner", () => {
    const sends: SendRecord[] = [
      { pieceCode: "07", sentDate: "2020-01-15", payType: "Ins Pay (Which Party Unknown)", region: "LA", roNumber: "R1" },
    ];
    const outcomes = buildOutcomeStream(
      [{ RC_SerialNum: "R1", RC_Date_Out: "2020-04-01", RC_Repeat_Yes_No: "Yes" }],
      []
    );
    const rows = mineSendPriors(sends, outcomes, {});
    expect(rows[0].segmentKey).toBe("paytype=Ins|region=LA");
    expect(rows[0].trigger).toBe("survey_followup_warranty");
    expect(rows[0].outcomeRate).toBe(1);
  });
});
