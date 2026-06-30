import { describe, it, expect } from "vitest";
import { buildForecast, resolveProbability } from "../forecast";
import type { PipedriveDeal } from "../types";

function deal(p: Partial<PipedriveDeal>): PipedriveDeal {
  return {
    dealId: p.dealId ?? 1,
    title: p.title ?? "deal",
    value: p.value ?? 0,
    currency: p.currency ?? "USD",
    status: p.status ?? "open",
    pipelineId: p.pipelineId ?? 1,
    stageId: "stageId" in p ? (p.stageId ?? null) : 1,
    stageName: "stageName" in p ? (p.stageName ?? null) : "S1",
    winProbability: p.winProbability ?? null,
    orgId: p.orgId ?? null,
    orgName: p.orgName ?? null,
    personId: p.personId ?? null,
    ownerId: p.ownerId ?? null,
    ownerName: p.ownerName ?? null,
    expectedCloseDate: p.expectedCloseDate ?? null,
    closeDate: p.closeDate ?? null,
    lastActivityDate: p.lastActivityDate ?? null,
  };
}

describe("resolveProbability", () => {
  it("prefers the explicit stage map over the deal's own probability", () => {
    const d = deal({ stageId: 3, winProbability: 90 });
    expect(resolveProbability(d, { 3: 0.25 })).toBe(0.25);
  });

  it("falls back to deal win_probability/100 when the stage is not mapped", () => {
    const d = deal({ stageId: 7, winProbability: 40 });
    expect(resolveProbability(d, { 1: 0.1 })).toBeCloseTo(0.4, 5);
  });

  it("defaults to 0 when neither source is present", () => {
    expect(resolveProbability(deal({ winProbability: null }))).toBe(0);
  });

  it("clamps out-of-range probabilities to [0,1]", () => {
    expect(resolveProbability(deal({ stageId: 1 }), { 1: 1.8 })).toBe(1);
    expect(resolveProbability(deal({ stageId: 1 }), { 1: -0.5 })).toBe(0);
  });
});

describe("buildForecast", () => {
  it("counts open deals and totals best-case / weighted / committed lines", () => {
    const deals: PipedriveDeal[] = [
      deal({ dealId: 1, value: 10_000, stageId: 1, stageName: "S1" }),
      deal({ dealId: 2, value: 20_000, stageId: 2, stageName: "S2" }),
      // closed deals must NOT count toward the open pipeline
      deal({ dealId: 3, value: 99_999, stageId: 8, status: "won" }),
      deal({ dealId: 4, value: 99_999, stageId: 0, status: "lost" }),
    ];
    const f = buildForecast(deals, { stageProbability: { 1: 0.2, 2: 0.5 } });

    expect(f.openDealCount).toBe(2);
    expect(f.bestCaseValue).toBe(30_000); // ceiling: 10k + 20k
    // weighted/expected: 10k*0.2 + 20k*0.5 = 2k + 10k = 12k
    expect(f.weightedValue).toBe(12_000);
    // committed floor: neither stage clears the 0.95 (S6) gate → 0
    expect(f.committedValue).toBe(0);
    expect(f.committedWeightedValue).toBe(0);
    expect(f.committedDealCount).toBe(0);
  });

  it("committed = face-$ of open deals at ≥ S6, via the probability gate", () => {
    const deals: PipedriveDeal[] = [
      deal({ dealId: 1, value: 10_000, stageId: 1 }), // S1 0.25 → not committed
      deal({ dealId: 2, value: 40_000, stageId: 6 }), // S6 0.95 → committed
      deal({ dealId: 3, value: 30_000, stageId: 7 }), // S7 0.99 → committed
    ];
    // Map stage_id → probability mirroring the S0–S8 ramp.
    const f = buildForecast(deals, {
      stageProbability: { 1: 0.25, 6: 0.95, 7: 0.99 },
    });

    expect(f.bestCaseValue).toBe(80_000);
    expect(f.committedDealCount).toBe(2);
    expect(f.committedValue).toBe(70_000); // 40k + 30k face
    // 40k*0.95 + 30k*0.99 = 38k + 29.7k = 67.7k
    expect(f.committedWeightedValue).toBe(67_700);
    // weighted over all open: 10k*0.25 + 67.7k = 70.2k
    expect(f.weightedValue).toBe(70_200);
  });

  it("honors an explicit committedStageIds set over the probability gate", () => {
    const deals: PipedriveDeal[] = [
      deal({ dealId: 1, value: 10_000, stageId: 5, winProbability: 99 }),
      deal({ dealId: 2, value: 20_000, stageId: 9, winProbability: 50 }),
    ];
    // stage 9 is the committed stage even though its prob (0.5) is below 0.95;
    // stage 5 is excluded even though its prob (0.99) clears the gate.
    const f = buildForecast(deals, { committedStageIds: new Set([9]) });

    expect(f.committedDealCount).toBe(1);
    expect(f.committedValue).toBe(20_000);
    expect(f.committedWeightedValue).toBe(10_000); // 20k*0.5
  });

  it("produces a per-stage breakdown ordered by stageId with effective probability", () => {
    const deals: PipedriveDeal[] = [
      deal({ dealId: 1, value: 1_000, stageId: 2, stageName: "S2" }),
      deal({ dealId: 2, value: 3_000, stageId: 2, stageName: "S2" }),
      deal({ dealId: 3, value: 5_000, stageId: 1, stageName: "S1" }),
    ];
    // Stage 2 has mixed deal probabilities → effective weight from aggregates.
    const f = buildForecast(deals, { stageProbability: { 1: 0.1, 2: 0.5 } });

    expect(f.perStage.map((s) => s.stageId)).toEqual([1, 2]);

    const s2 = f.perStage.find((s) => s.stageId === 2)!;
    expect(s2.count).toBe(2);
    expect(s2.value).toBe(4_000);
    expect(s2.weightedValue).toBe(2_000); // (1k+3k)*0.5
    expect(s2.probability).toBeCloseTo(0.5, 5); // 2000/4000
  });

  it("treats non-finite or missing values as 0 (no NaN leakage)", () => {
    const deals: PipedriveDeal[] = [
      deal({ dealId: 1, value: Number.NaN, stageId: 1 }),
      deal({ dealId: 2, value: 2_500, stageId: 1, winProbability: 100 }),
    ];
    const f = buildForecast(deals);
    expect(f.bestCaseValue).toBe(2_500);
    // winProbability 100 → prob 1.0 ≥ 0.95 gate → committed; value is finite 2_500
    expect(f.weightedValue).toBe(2_500);
    expect(f.committedValue).toBe(2_500);
    expect(Number.isNaN(f.weightedValue)).toBe(false);
    expect(Number.isNaN(f.committedValue)).toBe(false);
  });

  it("buckets deals with no stage under a trailing null group", () => {
    const deals: PipedriveDeal[] = [
      deal({ dealId: 1, value: 100, stageId: null, stageName: null }),
      deal({ dealId: 2, value: 200, stageId: 1, stageName: "S1" }),
    ];
    const f = buildForecast(deals);
    expect(f.perStage[f.perStage.length - 1].stageId).toBeNull();
  });
});
