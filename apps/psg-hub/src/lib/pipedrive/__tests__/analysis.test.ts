import { describe, it, expect } from "vitest";
import { diagnoseDeals, isStaleDeal, daysSince, STALE_DEAL_DAYS } from "../analysis";
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
    stageName: p.stageName ?? "S1",
    winProbability: p.winProbability ?? null,
    orgId: p.orgId ?? null,
    orgName: p.orgName ?? null,
    personId: p.personId ?? null,
    ownerId: p.ownerId ?? null,
    ownerName: p.ownerName ?? null,
    expectedCloseDate: p.expectedCloseDate ?? null,
    closeDate: p.closeDate ?? null,
    lastActivityDate: "lastActivityDate" in p ? (p.lastActivityDate ?? null) : null,
  };
}

const ASOF = new Date("2026-06-30T00:00:00.000Z");

describe("daysSince", () => {
  it("counts whole days, null for missing/invalid", () => {
    expect(daysSince("2026-06-16", ASOF)).toBe(14);
    expect(daysSince(null, ASOF)).toBeNull();
    expect(daysSince("not-a-date", ASOF)).toBeNull();
  });
});

describe("isStaleDeal", () => {
  it("flags an open deal with no activity in ≥14 days", () => {
    expect(isStaleDeal(deal({ status: "open", lastActivityDate: "2026-06-16" }), ASOF)).toBe(true); // 14d
  });
  it("does NOT flag a recently-active open deal", () => {
    expect(isStaleDeal(deal({ status: "open", lastActivityDate: "2026-06-25" }), ASOF)).toBe(false); // 5d
  });
  it("treats an open deal with no activity date as stale (never moved)", () => {
    expect(isStaleDeal(deal({ status: "open", lastActivityDate: null }), ASOF)).toBe(true);
  });
  it("never flags a closed deal", () => {
    expect(isStaleDeal(deal({ status: "won", lastActivityDate: null }), ASOF)).toBe(false);
  });
  it("uses the default 14-day window", () => {
    expect(STALE_DEAL_DAYS).toBe(14);
  });
});

describe("diagnoseDeals", () => {
  it("surfaces stale open pipeline (ids + summed value), not silently summed", () => {
    const deals = [
      deal({ dealId: 1, value: 10_000, status: "open", lastActivityDate: "2026-06-01" }), // 29d → stale
      deal({ dealId: 2, value: 25_000, status: "open", lastActivityDate: "2026-06-28" }), // 2d → fresh
      deal({ dealId: 3, value: 99_999, status: "won", lastActivityDate: null }), // closed → ignored
    ];
    const d = diagnoseDeals(deals, { asOf: ASOF });
    expect(d.openDealCount).toBe(2);
    expect(d.staleDealIds).toEqual([1]);
    expect(d.staleValue).toBe(10_000);
  });

  it("raises an open_in_won_stage warning for an S7/S8 deal still status=open", () => {
    const wonStageIds = new Set([7, 8]); // live stage_ids mapped to S7/S8
    const deals = [
      deal({ dealId: 1, value: 40_000, status: "open", stageId: 8, stageName: "Won", lastActivityDate: "2026-06-29" }),
      deal({ dealId: 2, value: 10_000, status: "open", stageId: 3, stageName: "Solution", lastActivityDate: "2026-06-29" }),
    ];
    const d = diagnoseDeals(deals, { asOf: ASOF, wonStageIds });
    expect(d.warnings).toHaveLength(1);
    expect(d.warnings[0]).toMatchObject({ kind: "open_in_won_stage", dealId: 1, stageId: 8 });
    expect(d.warnings[0].message).toContain("inflate the committed line");
  });

  it("raises no warning when no won-stage map is supplied (pre-live default)", () => {
    const deals = [deal({ dealId: 1, status: "open", stageId: 8, lastActivityDate: "2026-06-29" })];
    const d = diagnoseDeals(deals, { asOf: ASOF });
    expect(d.warnings).toEqual([]);
  });
});
