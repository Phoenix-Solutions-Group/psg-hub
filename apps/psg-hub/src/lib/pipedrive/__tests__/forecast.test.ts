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
    expectedCloseDate: p.expectedCloseDate ?? null,
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
  it("counts open deals and totals best-case vs committed pipeline", () => {
    const deals: PipedriveDeal[] = [
      deal({ dealId: 1, value: 10_000, stageId: 1, stageName: "S1" }),
      deal({ dealId: 2, value: 20_000, stageId: 2, stageName: "S2" }),
      // closed deals must NOT count toward the open pipeline
      deal({ dealId: 3, value: 99_999, stageId: 8, status: "won" }),
      deal({ dealId: 4, value: 99_999, stageId: 0, status: "lost" }),
    ];
    const f = buildForecast(deals, { stageProbability: { 1: 0.2, 2: 0.5 } });

    expect(f.openDealCount).toBe(2);
    expect(f.bestCaseValue).toBe(30_000);
    // 10k*0.2 + 20k*0.5 = 2k + 10k = 12k committed
    expect(f.committedValue).toBe(12_000);
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
    expect(f.committedValue).toBe(2_500);
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
