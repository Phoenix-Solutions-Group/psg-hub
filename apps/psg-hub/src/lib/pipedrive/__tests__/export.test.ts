import { describe, it, expect } from "vitest";
import { buildDealsExport, dealsExportToCSV, dealsExportToJSON } from "../export";
import type { PipedriveDeal } from "../types";

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
    customFields: p.customFields ?? null,
  };
}

const ASOF = new Date("2026-06-30T00:00:00.000Z");

const DEALS: PipedriveDeal[] = [
  deal({ dealId: 1, value: 10_000, stageId: 1, stageName: "S1", winProbability: 25 }),
  deal({ dealId: 2, value: 40_000, stageId: 6, stageName: "S6", winProbability: 95 }),
  // won/booked — DISTINCT set, must not be in open pipeline
  deal({ dealId: 3, value: 75_000, status: "won", orgName: "Bodyshop A", closeDate: "2026-06-10" }),
  // stale open deal (no activity in ≥14d)
  deal({ dealId: 4, value: 5_000, stageId: 2, stageName: "S2", winProbability: 40, lastActivityDate: "2026-06-01" }),
];

describe("buildDealsExport", () => {
  it("rolls up open-only forecast lines (best-case / weighted / committed)", () => {
    const exp = buildDealsExport(DEALS, {
      asOf: ASOF,
      stageProbability: { 1: 0.25, 6: 0.95, 2: 0.4 },
    });
    // open pipeline = 10k + 40k + 5k = 55k (won 75k excluded)
    expect(exp.forecast.openDealCount).toBe(3);
    expect(exp.forecast.bestCaseValue).toBe(55_000);
    // committed (≥0.95) = the 40k S6 deal only
    expect(exp.forecast.committedValue).toBe(40_000);
    expect(exp.forecast.committedDealCount).toBe(1);
  });

  it("keeps won/booked DISTINCT and disjoint from the open pipeline", () => {
    const exp = buildDealsExport(DEALS, { asOf: ASOF });
    const openIds = exp.openDeals.map((d) => d.dealId);
    const wonIds = exp.wonBooked.map((d) => d.dealId);
    expect(openIds).not.toContain(3);
    expect(wonIds).toEqual([3]);
    expect(exp.wonBookedTotal).toBe(75_000);
    // disjoint
    expect(openIds.filter((id) => wonIds.includes(id))).toEqual([]);
  });

  it("carries revenue_type on every won/booked row; unmapped deals are honest 'unknown'", () => {
    const deals = [
      deal({ dealId: 10, value: 60_000, status: "won", closeDate: "2026-06-01", revenueType: "recurring" }),
      deal({ dealId: 11, value: 12_000, status: "won", closeDate: "2026-06-02", revenueType: "one_time" }),
      deal({ dealId: 12, value: 8_000, status: "won", closeDate: "2026-06-03" }), // no source → unknown
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF });
    const byId = new Map(exp.wonBooked.map((d) => [d.dealId, d.revenueType]));
    expect(byId.get(10)).toBe("recurring");
    expect(byId.get(11)).toBe("one_time");
    expect(byId.get(12)).toBe("unknown"); // CFO guard: never silently netted, never null
  });

  it("maps revenue_type from an options-supplied custom-field key; otherwise 'unknown'", () => {
    const deals = [
      // value lives in a Pipedrive custom field, named by the caller's key
      deal({ dealId: 20, value: 30_000, status: "won", closeDate: "2026-06-05", customFields: { abc123: "Recurring" } }),
      deal({ dealId: 21, value: 9_000, status: "won", closeDate: "2026-06-06", customFields: { abc123: "one-time" } }),
      deal({ dealId: 22, value: 5_000, status: "won", closeDate: "2026-06-07", customFields: { abc123: "mystery" } }), // unrecognized → unknown
      deal({ dealId: 23, value: 4_000, status: "won", closeDate: "2026-06-08" }), // no custom field at all → unknown
    ];
    const mapped = buildDealsExport(deals, { asOf: ASOF, revenueTypeFieldKey: "abc123" });
    const byId = new Map(mapped.wonBooked.map((d) => [d.dealId, d.revenueType]));
    expect(byId.get(20)).toBe("recurring"); // normalized, case-insensitive
    expect(byId.get(21)).toBe("one_time"); // "one-time" normalizes to one_time
    expect(byId.get(22)).toBe("unknown");
    expect(byId.get(23)).toBe("unknown");
    // without the key, the same custom field is ignored → default unknown
    const unmapped = buildDealsExport(deals, { asOf: ASOF });
    expect(unmapped.wonBooked.find((d) => d.dealId === 20)!.revenueType).toBe("unknown");
  });

  it("splits the won/booked total by revenue_type for John's §2.1 tie-out", () => {
    const deals = [
      deal({ dealId: 10, value: 60_000, status: "won", closeDate: "2026-06-15", revenueType: "recurring" }),
      deal({ dealId: 11, value: 12_000, status: "won", closeDate: "2026-06-15", revenueType: "one_time" }),
      deal({ dealId: 12, value: 8_000, status: "won", closeDate: "2026-06-15" }), // unknown
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF });
    expect(exp.wonBookedTotal).toBe(80_000);
    expect(exp.wonBookedByType.recurring).toBe(60_000);
    expect(exp.wonBookedByType.oneTime).toBe(12_000);
    expect(exp.wonBookedByType.unknown).toBe(8_000);
    expect(exp.wonBookedByType.unknownCount).toBe(1);
  });

  it("bounds won/booked to the recently-closed window (inclusive at the boundary)", () => {
    const deals = [
      deal({ dealId: 30, value: 1_000, status: "won", closeDate: "2026-06-29" }), // 1d ago — in
      deal({ dealId: 31, value: 1_000, status: "won", closeDate: "2026-04-01" }), // exactly 90d ago — in (inclusive)
      deal({ dealId: 32, value: 1_000, status: "won", closeDate: "2026-03-31" }), // 91d ago — out
      deal({ dealId: 33, value: 1_000, status: "won", closeDate: "2026-07-05" }), // future close — out
      deal({ dealId: 34, value: 1_000, status: "won", closeDate: null }), // undateable — out
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF }); // default 90d
    expect(exp.wonBooked.map((d) => d.dealId).sort()).toEqual([30, 31]);
    expect(exp.wonBookedTotal).toBe(2_000);
    expect(exp.wonBookedWindow).toEqual({ days: 90, start: "2026-04-01", end: "2026-06-30" });
    // a tighter window drops the 90d-old deal
    const tight = buildDealsExport(deals, { asOf: ASOF, closedWithinDays: 7 });
    expect(tight.wonBooked.map((d) => d.dealId)).toEqual([30]);
    expect(tight.wonBookedWindow.start).toBe("2026-06-23");
  });

  it("never lets won deals inflate any of the three forecast lines (window/revenue_type present)", () => {
    const deals = [
      deal({ dealId: 1, value: 10_000, stageId: 6, stageName: "S6", winProbability: 95 }), // open committed
      deal({ dealId: 2, value: 99_000, status: "won", closeDate: "2026-06-20", revenueType: "recurring" }),
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF, stageProbability: { 6: 0.95 } });
    expect(exp.forecast.bestCaseValue).toBe(10_000); // won 99k excluded
    expect(exp.forecast.weightedValue).toBe(9_500);
    expect(exp.forecast.committedValue).toBe(10_000);
    expect(exp.forecast.committedWeightedValue).toBe(9_500);
    // and the windowed won/booked total is the single reconcile number
    expect(exp.wonBookedTotal).toBe(99_000);
  });

  it("marks the stale open deal in the per-deal rows + diagnostics", () => {
    const exp = buildDealsExport(DEALS, { asOf: ASOF });
    const staleRow = exp.openDeals.find((d) => d.dealId === 4)!;
    expect(staleRow.stale).toBe(true);
    expect(exp.diagnostics.staleDealIds).toContain(4);
    const freshRow = exp.openDeals.find((d) => d.dealId === 1)!;
    expect(freshRow.stale).toBe(false);
  });
});

describe("serializers", () => {
  it("JSON summary carries open count, total open-$, and the won/booked split", () => {
    const exp = buildDealsExport(DEALS, { asOf: ASOF, stageProbability: { 6: 0.95 } });
    const json = dealsExportToJSON(exp) as {
      summary: Record<string, number>;
      perStage: unknown[];
      wonBooked: unknown[];
    };
    expect(json.summary.openDealCount).toBe(3);
    expect(json.summary.totalOpenPipeline).toBe(55_000);
    expect(json.summary.wonBookedCount).toBe(1);
    expect(json.summary.wonBookedTotal).toBe(75_000);
    // the reconcile window bounds are surfaced for John
    expect(json.summary.wonBookedWindowDays).toBe(90);
    expect(json.summary.wonBookedWindowStart).toBe("2026-04-01");
    expect(json.summary.wonBookedWindowEnd).toBe("2026-06-30");
    // deal 3 has no revenue_type source → surfaced as unknown, not silently netted
    expect(json.summary.wonBookedUnknownTotal).toBe(75_000);
    expect(json.summary.wonBookedUnknownCount).toBe(1);
    expect(json.summary.wonBookedRecurringTotal).toBe(0);
    expect(json.perStage.length).toBeGreaterThan(0);
  });

  it("CSV is RFC-4180 (CRLF) with named sections incl. the disjoint won-booked block", () => {
    const exp = buildDealsExport(DEALS, { asOf: ASOF });
    const csv = dealsExportToCSV(exp);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("SUMMARY");
    expect(csv).toContain("PER-STAGE");
    expect(csv).toContain("OPEN DEALS");
    expect(csv).toContain("WON-BOOKED");
    expect(csv).toContain("do NOT sum into pipeline");
    // the won deal's org appears only in the won-booked section
    expect(csv).toContain("Bodyshop A");
    // the won/booked block carries the required revenue_type column + split subtotals
    expect(csv).toContain("revenue_type");
    expect(csv).toContain("won_booked_recurring_total");
    expect(csv).toContain("won_booked_one_time_total");
    // the recently-closed window is surfaced in the SUMMARY and the WON-BOOKED header
    expect(csv).toContain("won_booked_window_days");
    expect(csv).toContain("won_booked_window_start");
    expect(csv).toContain("closed 2026-04-01..2026-06-30");
  });
});
