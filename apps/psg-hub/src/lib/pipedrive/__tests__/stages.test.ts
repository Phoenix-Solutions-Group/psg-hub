import { describe, it, expect } from "vitest";
import {
  buildStageProbabilityMap,
  committedStageIds,
  liveStageProbabilityMap,
  liveCommittedStageIds,
  PIPELINE_8_STAGE_CODES,
  PSG_LIFECYCLE_STAGES,
} from "../stages";

describe("buildStageProbabilityMap", () => {
  it("maps stage_id → Sn code → the canonical S0–S8 confidence", () => {
    const map = buildStageProbabilityMap({ 61: "S0", 57: "S3", 56: "S6" });
    expect(map).toEqual({ 61: 0.1, 57: 0.6, 56: 0.95 });
  });
  it("drops stage_ids whose code is outside S0–S8 (defensive, no NaN)", () => {
    // `S42` is a valid `S${number}` at the type level but not a real lifecycle stage,
    // so it must be dropped at runtime rather than mapped to an undefined probability.
    const map = buildStageProbabilityMap({ 99: "S42" });
    expect(map).toEqual({});
  });
});

describe("committedStageIds (≥ S6 / Contract)", () => {
  it("keeps only stage_ids mapped to S6 or later", () => {
    const set = committedStageIds({ 61: "S0", 58: "S5", 56: "S6", 55: "S7", 54: "S8" });
    expect([...set].sort((a, b) => a - b)).toEqual([54, 55, 56]);
  });
  it("is empty when no stage reaches the committed gate", () => {
    expect(committedStageIds({ 61: "S0", 57: "S3" }).size).toBe(0);
  });
});

describe("live stage map (PSG-622 — Reese's name-corrected mapping, PSG-631)", () => {
  it("PIPELINE_8_STAGE_CODES holds the confirmed 56–61 → Sn mapping (56=New Lead … 61=Won)", () => {
    expect(PIPELINE_8_STAGE_CODES).toEqual({
      56: "S0",
      57: "S2",
      58: "S3",
      59: "S4",
      60: "S5",
      61: "S5",
    });
  });
  it("liveStageProbabilityMap resolves each stage_id to its S0–S8 confidence", () => {
    expect(liveStageProbabilityMap()).toEqual({
      56: 0.1, // S0  New Lead
      57: 0.4, // S2  Contacted / Discovery
      58: 0.6, // S3  Qualified
      59: 0.7, // S4  Proposal Sent
      60: 0.85, // S5  Verbal / Negotiation
      61: 0.85, // S5  Won (open, unclosed) — interim cap
    });
  });
  it("liveCommittedStageIds is undefined — no live stage is ≥ S6 (committed stays $0, PSG-631)", () => {
    // Reese's call: the 9 open deals in the 'Won' stage are NOT booked-committed. No live
    // stage maps to ≥ S6, so there is no committed stage set and the committed line is $0
    // (via the probability-threshold fallback) until PSG-632 promotes any verified deals.
    expect(liveCommittedStageIds()).toBeUndefined();
  });
});

describe("PSG_LIFECYCLE_STAGES sanity", () => {
  it("has 9 codes S0–S8 with monotonically non-decreasing probabilities", () => {
    expect(PSG_LIFECYCLE_STAGES).toHaveLength(9);
    for (let i = 1; i < PSG_LIFECYCLE_STAGES.length; i += 1) {
      expect(PSG_LIFECYCLE_STAGES[i]!.probability).toBeGreaterThanOrEqual(
        PSG_LIFECYCLE_STAGES[i - 1]!.probability,
      );
    }
  });
});
