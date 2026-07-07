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

describe("live stage map (PSG-622 — gated on Reese's confirmation)", () => {
  it("returns undefined while PIPELINE_8_STAGE_CODES is unconfirmed/empty (behavior-preserving)", () => {
    // Guard: until Reese confirms the 56–61 → Sn mapping, the constant is empty so the
    // forecast keeps its win_probability fallback. This asserts that gated state.
    expect(Object.keys(PIPELINE_8_STAGE_CODES)).toHaveLength(0);
    expect(liveStageProbabilityMap()).toBeUndefined();
    expect(liveCommittedStageIds()).toBeUndefined();
  });
  it("would activate weighting once the constant is filled (mechanism check)", () => {
    // Proves the wiring: a populated mapping yields a usable probability map + committed set.
    const codes = { 61: "S0", 60: "S2", 57: "S3", 59: "S4", 58: "S5", 56: "S6" } as const;
    const map = buildStageProbabilityMap(codes);
    expect(map[59]).toBe(0.7); // S4
    expect(map[56]).toBe(0.95); // S6
    expect([...committedStageIds(codes)]).toEqual([56]);
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
