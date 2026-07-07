// PSG-594 — the /ops/sales-pipeline presenter is tested against the pure lib (no DB /
// token): build a deal fixture → buildDealsExport → buildSalesPipelineView, and assert
// every rendered number comes VERBATIM off the DealsExport (the page never recomputes
// forecast math), plus the won/booked line stays DISTINCT from the open pipeline.
import { describe, it, expect } from "vitest";
import { buildDealsExport } from "../export";
import type { PipedriveDeal } from "../types";
import {
  buildSalesPipelineView,
  formatMoney,
  formatCount,
  formatSyncedAgo,
  type SyncRunFreshness,
} from "../view";

function deal(p: Partial<PipedriveDeal>): PipedriveDeal {
  return {
    dealId: p.dealId ?? 1,
    title: p.title ?? "deal",
    value: p.value ?? 0,
    currency: p.currency ?? "USD",
    status: p.status ?? "open",
    pipelineId: p.pipelineId ?? 1,
    stageId: p.stageId ?? 1,
    stageName: p.stageName ?? "S1",
    winProbability: p.winProbability ?? null,
    orgId: p.orgId ?? null,
    orgName: p.orgName ?? null,
    personId: p.personId ?? null,
    ownerId: p.ownerId ?? null,
    ownerName: p.ownerName ?? null,
    expectedCloseDate: p.expectedCloseDate ?? null,
    closeDate: p.closeDate ?? null,
    lastActivityDate: p.lastActivityDate ?? "2026-06-29",
    revenueType: p.revenueType ?? null,
    monthlyValue: p.monthlyValue ?? null,
    customFields: p.customFields ?? null,
  };
}

const ASOF = new Date("2026-06-30T00:00:00.000Z");
const STAGE_PROB = { 1: 0.25, 6: 0.95, 2: 0.4 };

const DEALS: PipedriveDeal[] = [
  deal({ dealId: 1, value: 10_000, stageId: 1, stageName: "S1 Outreach", winProbability: 25 }),
  deal({ dealId: 2, value: 40_000, stageId: 6, stageName: "S6 Contract", winProbability: 95 }),
  deal({ dealId: 4, value: 5_000, stageId: 2, stageName: "S2 Discovery", winProbability: 40 }),
  // won/booked — DISTINCT set, must never appear in the open pipeline
  deal({
    dealId: 3,
    value: 75_000,
    status: "won",
    orgName: "Bodyshop A",
    closeDate: "2026-06-10",
    revenueType: "recurring",
    monthlyValue: 6_250,
  }),
  deal({
    dealId: 5,
    value: 12_000,
    status: "won",
    orgName: "Bodyshop B",
    closeDate: "2026-06-20",
    revenueType: "one_time",
  }),
];

const SYNC: SyncRunFreshness = {
  startedAt: "2026-06-30T11:55:00.000Z",
  finishedAt: "2026-06-30T12:00:00.000Z",
  ok: true,
  openDeals: 3,
  totalDeals: 5,
};

describe("buildSalesPipelineView", () => {
  const exp = buildDealsExport(DEALS, { asOf: ASOF, stageProbability: STAGE_PROB });
  const view = buildSalesPipelineView(exp, SYNC);

  it("renders open-pipeline headline numbers VERBATIM from the forecast (no recompute)", () => {
    expect(view.openDealCount).toBe(exp.forecast.openDealCount);
    expect(view.totalOpenPipeline).toBe(exp.forecast.bestCaseValue);
    expect(view.weightedValue).toBe(exp.forecast.weightedValue);
    expect(view.committedValue).toBe(exp.forecast.committedValue);
    expect(view.committedDealCount).toBe(exp.forecast.committedDealCount);
    expect(view.currency).toBe(exp.forecast.currency);
    // sanity: open pipeline = 10k+40k+5k = 55k, won 87k excluded
    expect(view.totalOpenPipeline).toBe(55_000);
    expect(view.openDealCount).toBe(3);
  });

  it("carries the S0–S8 per-stage breakdown straight from the forecast", () => {
    expect(view.perStage).toHaveLength(exp.forecast.perStage.length);
    view.perStage.forEach((s, i) => {
      const src = exp.forecast.perStage[i];
      expect(s.stageId).toBe(src.stageId);
      expect(s.stageName).toBe(src.stageName);
      expect(s.count).toBe(src.count);
      expect(s.value).toBe(src.value);
      expect(s.weightedValue).toBe(src.weightedValue);
      // probability is display-mapped to whole percent, never recomputed
      expect(s.probabilityPct).toBe(Math.round(src.probability * 100));
    });
    // S6 contract stage shows a 95% win chance
    const s6 = view.perStage.find((s) => s.stageId === 6);
    expect(s6?.probabilityPct).toBe(95);
  });

  it("keeps the won/booked line DISTINCT from the open totals", () => {
    expect(view.wonBooked.count).toBe(exp.wonBooked.length);
    expect(view.wonBooked.total).toBe(exp.wonBookedTotal);
    expect(view.wonBooked.recurring).toBe(exp.wonBookedByType.recurring);
    expect(view.wonBooked.oneTime).toBe(exp.wonBookedByType.oneTime);
    expect(view.wonBooked.recurringMonthlyTotal).toBe(exp.wonBookedRecurringMonthlyTotal);
    // won total (75k + 12k) is NOT part of the open pipeline (55k)
    expect(view.wonBooked.total).toBe(87_000);
    expect(view.totalOpenPipeline).toBe(55_000);
    expect(view.wonBooked.total).not.toBe(view.totalOpenPipeline);
  });

  it("maps the reconcile window + freshness through", () => {
    expect(view.wonBooked.window.start).toBe(exp.wonBookedWindow.start);
    expect(view.wonBooked.window.end).toBe(exp.wonBookedWindow.end);
    expect(view.freshness.lastSyncedAt).toBe("2026-06-30T12:00:00.000Z"); // finished wins
    expect(view.freshness.totalDeals).toBe(5);
    expect(view.freshness.ok).toBe(true);
  });

  it("tolerates a never-synced state", () => {
    const v = buildSalesPipelineView(exp, null);
    expect(v.freshness.lastSyncedAt).toBeNull();
    expect(v.freshness.totalDeals).toBeNull();
    // the pipeline figures still render regardless of freshness
    expect(v.totalOpenPipeline).toBe(55_000);
  });
});

describe("formatters", () => {
  it("formatMoney: whole-dollar USD", () => {
    expect(formatMoney(55_000)).toBe("$55,000");
    expect(formatMoney(1234.5)).toBe("$1,235");
  });
  it("formatCount: thousands separated", () => {
    expect(formatCount(1234)).toBe("1,234");
  });
  it("formatSyncedAgo: relative label, deterministic", () => {
    const now = new Date("2026-06-30T12:30:00.000Z");
    expect(formatSyncedAgo("2026-06-30T12:00:00.000Z", now)).toBe("30 min ago");
    expect(formatSyncedAgo("2026-06-30T09:30:00.000Z", now)).toBe("3 hrs ago");
    expect(formatSyncedAgo(null, now)).toBe("never synced");
  });
});
