import { describe, it, expect } from "vitest";
import {
  buildDealsExport,
  dealsExportToCSV,
  dealsExportToJSON,
  monthBounds,
  wonBookedTieOutGap,
} from "../export";
import { mapRawDeal } from "../client";
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
    monthlyValue: p.monthlyValue ?? null,
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

  it("ties the three revenue_type subtotals EXACTLY to wonBookedTotal (John's §2.1 hard tie-out)", () => {
    // Mixed buckets incl. an unmapped (unknown) row — the partition must be exhaustive
    // and reconcile with no dropped rows and no double-count.
    const deals = [
      deal({ dealId: 40, value: 60_000, status: "won", closeDate: "2026-06-15", revenueType: "recurring" }),
      deal({ dealId: 41, value: 25_000, status: "won", closeDate: "2026-06-16", revenueType: "recurring" }),
      deal({ dealId: 42, value: 12_000, status: "won", closeDate: "2026-06-17", revenueType: "one_time" }),
      deal({ dealId: 43, value: 8_000, status: "won", closeDate: "2026-06-18" }), // unknown
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF });
    const { recurring, oneTime, unknown } = exp.wonBookedByType;
    expect(recurring + oneTime + unknown).toBe(exp.wonBookedTotal);
    expect(wonBookedTieOutGap(exp.wonBookedTotal, exp.wonBookedByType)).toBe(0);
  });

  it("ties out exactly even on sub-cent deal values (no per-subtotal rounding drift)", () => {
    // Values that each carry a third decimal: independently rounding each subtotal AND a
    // separately-rounded grand total would drift a cent — the headline is defined as the
    // sum of the rounded parts, so the tie is exact by construction.
    const deals = [
      deal({ dealId: 50, value: 10.005, status: "won", closeDate: "2026-06-15", revenueType: "recurring" }),
      deal({ dealId: 51, value: 10.005, status: "won", closeDate: "2026-06-16", revenueType: "one_time" }),
      deal({ dealId: 52, value: 10.005, status: "won", closeDate: "2026-06-17" }), // unknown
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF });
    const { recurring, oneTime, unknown } = exp.wonBookedByType;
    expect(recurring + oneTime + unknown).toBe(exp.wonBookedTotal);
    expect(wonBookedTieOutGap(exp.wonBookedTotal, exp.wonBookedByType)).toBe(0);
  });

  it("carries monthlyValue on recurring rows, honest-null otherwise (PSG-468 tightening B)", () => {
    const deals = [
      // recurring with a derived monthly basis → carried onto the row
      deal({ dealId: 60, value: 12_000, status: "won", closeDate: "2026-06-10", revenueType: "recurring", monthlyValue: 1_000 }),
      // recurring but the upstream basis was underivable → null + flagged for manual reconcile
      deal({ dealId: 61, value: 9_000, status: "won", closeDate: "2026-06-11", revenueType: "recurring", monthlyValue: null }),
      // one_time is never an MRR figure → null even if a stray monthlyValue is present
      deal({ dealId: 62, value: 5_000, status: "won", closeDate: "2026-06-12", revenueType: "one_time", monthlyValue: 999 }),
      // unknown → null
      deal({ dealId: 63, value: 4_000, status: "won", closeDate: "2026-06-13" }),
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF });
    const byId = new Map(exp.wonBooked.map((d) => [d.dealId, d.monthlyValue]));
    expect(byId.get(60)).toBe(1_000);
    expect(byId.get(61)).toBeNull(); // honest-null, never a silent annual→monthly guess
    expect(byId.get(62)).toBeNull(); // one_time additive at face value, never an MRR figure
    expect(byId.get(63)).toBeNull();
    // Netting-ready summary: Σ over recurring rows WITH a non-null basis; the underivable
    // recurring row is counted, not folded in.
    expect(exp.wonBookedRecurringMonthlyTotal).toBe(1_000);
    expect(exp.wonBookedRecurringMonthlyNullCount).toBe(1);
  });

  it("a custom-field key can reclassify a deal to recurring and gate monthlyValue (PSG-468)", () => {
    const deals = [
      // mirror says recurring + has a monthly basis; custom-field override agrees → kept
      deal({ dealId: 70, value: 24_000, status: "won", closeDate: "2026-06-10", revenueType: "recurring", monthlyValue: 2_000, customFields: { rt: "recurring" } }),
      // mirror recurring w/ basis, but the override reclassifies to one_time → monthlyValue dropped to null
      deal({ dealId: 71, value: 12_000, status: "won", closeDate: "2026-06-11", revenueType: "recurring", monthlyValue: 1_000, customFields: { rt: "one-time" } }),
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF, revenueTypeFieldKey: "rt" });
    const byId = new Map(exp.wonBooked.map((d) => [d.dealId, d]));
    expect(byId.get(70)!.revenueType).toBe("recurring");
    expect(byId.get(70)!.monthlyValue).toBe(2_000);
    expect(byId.get(71)!.revenueType).toBe("one_time");
    expect(byId.get(71)!.monthlyValue).toBeNull(); // gated on the RESOLVED revenue_type
    expect(exp.wonBookedRecurringMonthlyTotal).toBe(2_000);
    expect(exp.wonBookedRecurringMonthlyNullCount).toBe(0);
  });

  it("preserves monthlyValue null through the raw mirror → mapRawDeal → export round-trip (PSG-446 #4 / John invariant)", () => {
    // John's hard correctness constraint: a recurring deal with no derivable basis must
    // surface as monthlyValue=null verbatim — NEVER coerced to 0, annualized, or folded into
    // wonBookedRecurringMonthlyTotal — and must increment the caveat denominator. Drive it
    // from RAW mirror rows through the real read surface, not pre-mapped fixtures.
    const raw = [
      // recurring w/ a native monthly figure → derivable basis survives
      { id: 90, status: "won", close_time: "2026-06-10", recurring: true, mrr: 1_500, value: 18_000 },
      // recurring but basis underivable upstream → honest-null (the row John caveats)
      { id: 91, status: "won", close_time: "2026-06-11", recurring: true, value: 9_000 },
      // recurring w/ amount but no interval → still null (can't normalize to monthly)
      { id: 92, status: "won", close_time: "2026-06-12", recurring: true, recurring_amount: 12_000, value: 12_000 },
    ];
    const deals: PipedriveDeal[] = raw.map(mapRawDeal);
    const exp = buildDealsExport(deals, { asOf: ASOF });
    const byId = new Map(exp.wonBooked.map((d) => [d.dealId, d.monthlyValue]));
    expect(byId.get(90)).toBe(1_500);
    expect(byId.get(91)).toBeNull(); // never 0 — that would read the MRR floor too high
    expect(byId.get(92)).toBeNull();
    // the un-nettable recurring rows are counted, not summed; only the derivable basis nets
    expect(exp.wonBookedRecurringMonthlyTotal).toBe(1_500);
    expect(exp.wonBookedRecurringMonthlyNullCount).toBe(2);
    // and the face-$ partition still ties out exactly (no row dropped by the null handling)
    expect(wonBookedTieOutGap(exp.wonBookedTotal, exp.wonBookedByType)).toBe(0);
    expect(exp.wonBookedByType.recurring).toBe(39_000); // all 3 are recurring at face value
  });

  it("bounds won/booked to an explicit half-open calendar range [from, to) (PSG-471 / John C1)", () => {
    const deals = [
      deal({ dealId: 60, value: 1_000, status: "won", closeDate: "2026-05-31" }), // day before — out
      deal({ dealId: 61, value: 1_000, status: "won", closeDate: "2026-06-01" }), // start inclusive — in
      deal({ dealId: 62, value: 1_000, status: "won", closeDate: "2026-06-30" }), // last day of June — in
      deal({ dealId: 63, value: 1_000, status: "won", closeDate: "2026-07-01" }), // end exclusive — OUT (lands in July, not June)
    ];
    const exp = buildDealsExport(deals, {
      asOf: ASOF,
      closedAfter: "2026-06-01",
      closedBefore: "2026-07-01",
    });
    // boundary-day deals land in exactly one period: no double-count, no gap
    expect(exp.wonBooked.map((d) => d.dealId).sort()).toEqual([61, 62]);
    expect(exp.wonBookedTotal).toBe(2_000);
    expect(exp.wonBookedWindow).toEqual({
      days: 30,
      start: "2026-06-01",
      end: "2026-07-01",
      endExclusive: true,
      timeZone: "America/Chicago",
    });
  });

  it("explicit calendar bounds WIN over the rolling closedWithinDays fallback (PSG-471)", () => {
    const deals = [
      deal({ dealId: 70, value: 5_000, status: "won", closeDate: "2026-06-10" }), // in June
      deal({ dealId: 71, value: 5_000, status: "won", closeDate: "2026-05-20" }), // in rolling 90d, NOT in June
    ];
    const exp = buildDealsExport(deals, {
      asOf: ASOF,
      closedWithinDays: 90, // would include both…
      closedAfter: "2026-06-01",
      closedBefore: "2026-07-01", // …but explicit June window wins
    });
    expect(exp.wonBooked.map((d) => d.dealId)).toEqual([70]);
    expect(exp.wonBookedWindow.endExclusive).toBe(true);
  });

  it("accepts Date bounds and an MTD default via monthBounds() (PSG-471)", () => {
    const { closedAfter, closedBefore } = monthBounds(ASOF); // America/Chicago default
    expect(closedAfter).toBe("2026-06-01");
    expect(closedBefore).toBe("2026-07-01");
    const deals = [
      deal({ dealId: 80, value: 3_000, status: "won", closeDate: "2026-06-15" }),
      deal({ dealId: 81, value: 3_000, status: "won", closeDate: "2026-07-02" }), // next month — out
    ];
    const exp = buildDealsExport(deals, {
      asOf: ASOF,
      closedAfter: new Date("2026-06-01T05:00:00.000Z"), // 00:00 America/Chicago
      closedBefore: new Date("2026-07-01T05:00:00.000Z"),
      boundaryTimeZone: "America/Chicago",
    });
    expect(exp.wonBooked.map((d) => d.dealId)).toEqual([80]);
    expect(exp.wonBookedWindow.timeZone).toBe("America/Chicago");
  });

  it("derives the MTD month from asOf in the boundary tz, not UTC (PSG-471)", () => {
    // 2026-07-01T02:00Z is still 2026-06-30 in America/Chicago → MTD is still June.
    const lateNightUtc = new Date("2026-07-01T02:00:00.000Z");
    expect(monthBounds(lateNightUtc, "America/Chicago")).toEqual({
      closedAfter: "2026-06-01",
      closedBefore: "2026-07-01",
    });
    // Same instant in UTC rolls into July.
    expect(monthBounds(lateNightUtc, "UTC")).toEqual({
      closedAfter: "2026-07-01",
      closedBefore: "2026-08-01",
    });
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
    expect(exp.wonBookedWindow).toEqual({
      days: 90,
      start: "2026-04-01",
      end: "2026-06-30",
      endExclusive: false,
      timeZone: "America/Chicago",
    });
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
    // PSG-468 — monthly MRR basis + unresolved-basis count in the summary
    expect(json.summary.wonBookedRecurringMonthlyTotal).toBe(0);
    expect(json.summary.wonBookedRecurringMonthlyNullCount).toBe(0);
    expect(json.perStage.length).toBeGreaterThan(0);
  });

  it("JSON summary + rows surface the monthly MRR basis John nets vs Invoiced (PSG-468)", () => {
    const deals = [
      deal({ dealId: 80, value: 24_000, status: "won", closeDate: "2026-06-10", revenueType: "recurring", monthlyValue: 2_000 }),
      deal({ dealId: 81, value: 9_000, status: "won", closeDate: "2026-06-11", revenueType: "recurring", monthlyValue: null }),
    ];
    const json = dealsExportToJSON(buildDealsExport(deals, { asOf: ASOF })) as {
      summary: Record<string, number>;
      wonBooked: Array<{ dealId: number; monthlyValue: number | null }>;
    };
    expect(json.summary.wonBookedRecurringMonthlyTotal).toBe(2_000);
    expect(json.summary.wonBookedRecurringMonthlyNullCount).toBe(1);
    const rowById = new Map(json.wonBooked.map((r) => [r.dealId, r.monthlyValue]));
    expect(rowById.get(80)).toBe(2_000);
    expect(rowById.get(81)).toBeNull();
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

  it("CSV surfaces the monthly MRR basis column + summary/subtotal rows (PSG-468)", () => {
    const deals = [
      deal({ dealId: 90, value: 24_000, status: "won", orgName: "Bodyshop B", closeDate: "2026-06-10", revenueType: "recurring", monthlyValue: 2_000 }),
      deal({ dealId: 91, value: 9_000, status: "won", closeDate: "2026-06-11", revenueType: "recurring", monthlyValue: null }),
    ];
    const csv = dealsExportToCSV(buildDealsExport(deals, { asOf: ASOF }));
    // SUMMARY rows
    expect(csv).toContain("won_booked_recurring_monthly_total");
    expect(csv).toContain("won_booked_recurring_monthly_null_count");
    // WON-BOOKED block: the new monthly_value column + the dedicated MRR-basis subtotal row
    expect(csv).toContain("monthly_value");
    expect(csv).toContain("RECURRING MONTHLY (Σ vs Invoiced MRR; 1 unresolved/manual)");
  });

  it("PSG-622: default live stage weighting is active (blank win% → weighted by stage)", () => {
    // Deals mirror the live pipeline-8 shape: real stage_ids, win_probability all blank.
    // With Reese's name-corrected PIPELINE_8_STAGE_CODES (PSG-631), buildDealsExport weights
    // by stage automatically — no explicit stageProbability needed by the caller.
    const deals = [
      deal({ dealId: 1, value: 35_800, stageId: 59, stageName: null, winProbability: null }), // S4 0.70
      deal({ dealId: 2, value: 25_230, stageId: 61, stageName: null, winProbability: null }), // S5 0.85 (Won, open)
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF });
    expect(exp.forecast.bestCaseValue).toBe(61_030); // raw open-pipeline-$ still correct
    // weighted by stage: 35800*0.70 + 25230*0.85 = 25060 + 21445.5 = 46505.5
    expect(exp.forecast.weightedValue).toBe(46_505.5);
    expect(exp.forecast.committedValue).toBe(0); // no stage is ≥ S6 → committed stays $0
  });

  it("PSG-622/631: reproduces Reese's name-corrected live forecast oracle to the penny", () => {
    // The exact 2026-07-07 08:57 UTC live pipeline (per-stage totals as one deal each),
    // weighted by the name-corrected map with NO explicit options — the production path.
    // Ties to Reese's PSG-631 sign-off: raw $65,562.25 · weighted $49,115.01 · committed $0.00.
    const deals = [
      deal({ dealId: 56, value: 0.0, stageId: 56, stageName: null, winProbability: null }), // New Lead              S0 0.10
      deal({ dealId: 57, value: 2_762.0, stageId: 57, stageName: null, winProbability: null }), // Contacted/Discovery   S2 0.40
      deal({ dealId: 58, value: 0.0, stageId: 58, stageName: null, winProbability: null }), // Qualified             S3 0.60
      deal({ dealId: 59, value: 35_800.0, stageId: 59, stageName: null, winProbability: null }), // Proposal Sent         S4 0.70
      deal({ dealId: 60, value: 1_770.0, stageId: 60, stageName: null, winProbability: null }), // Verbal/Negotiation    S5 0.85
      deal({ dealId: 61, value: 25_230.25, stageId: 61, stageName: null, winProbability: null }), // Won (open, unclosed)  S5 0.85
    ];
    const exp = buildDealsExport(deals, { asOf: ASOF });
    expect(exp.forecast.bestCaseValue).toBe(65_562.25);
    // 2762*0.40 + 35800*0.70 + 1770*0.85 + 25230.25*0.85 = 1104.80 + 25060 + 1504.50 + 21445.7125
    expect(exp.forecast.weightedValue).toBe(49_115.01);
    expect(exp.forecast.committedValue).toBe(0); // 'Won' stage capped at S5 → not committed
  });
});
