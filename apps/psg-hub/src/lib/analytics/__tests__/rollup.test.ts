import { describe, it, expect } from "vitest";
import {
  rollupMonth,
  monthWindow,
  priorMonth,
  momDelta,
  METRIC_REGISTRY,
} from "../rollup";
import type { DatedMetrics } from "../aggregate";

const row = (date: string, metrics: Record<string, number>): DatedMetrics => ({
  date,
  metrics,
});

describe("rollupMonth — FLOW / STOCK / DERIVED classification", () => {
  it("returns null for an empty month (no data, not zeros)", () => {
    expect(rollupMonth("ga4", [])).toBeNull();
    expect(rollupMonth("semrush", [])).toBeNull();
  });

  it("SEMrush metrics are STOCK: latest-dated value, never a sum", () => {
    // Rows intentionally out of date order; the latest DATE must win, not last-in-array.
    const rows = [
      row("2026-05-10", { organic_traffic: 1000, authority_score: 40, organic_keywords: 100 }),
      row("2026-05-31", { organic_traffic: 1500, authority_score: 45, organic_keywords: 130 }),
      row("2026-05-20", { organic_traffic: 2000, authority_score: 50, organic_keywords: 120 }),
    ];
    const out = rollupMonth("semrush", rows)!;
    // latest date is 05-31 -> its values, NOT the sum (which would be 4500 / 350).
    expect(out.organic_traffic).toBe(1500);
    expect(out.authority_score).toBe(45);
    expect(out.organic_keywords).toBe(130);
  });

  it("Google Ads: FLOW sums, cpl recomputed from summed components", () => {
    const rows = [
      row("2026-05-01", { spend: 50, clicks: 10, impressions: 200, conversions: 2, cost_micros: 50_000_000 }),
      row("2026-05-02", { spend: 150, clicks: 30, impressions: 600, conversions: 2, cost_micros: 150_000_000 }),
    ];
    const out = rollupMonth("google_ads", rows)!;
    expect(out.spend).toBe(200); // FLOW sum
    expect(out.clicks).toBe(40);
    expect(out.conversions).toBe(4);
    expect(out.cpl).toBe(50); // sum(spend) 200 / sum(conversions) 4 — NOT a daily-cpl average (both days = 25)
  });

  it("Google Ads: cpl is null when summed conversions are 0 (true no-data, not 0)", () => {
    const rows = [
      row("2026-05-01", { spend: 80, clicks: 5, impressions: 100, conversions: 0, cost_micros: 80_000_000 }),
    ];
    const out = rollupMonth("google_ads", rows)!;
    expect(out.cpl).toBeNull();
    expect(out.spend).toBe(80);
  });

  it("GSC: position is IMPRESSION-WEIGHTED, not a simple daily mean", () => {
    const rows = [
      row("2026-05-01", { clicks: 5, impressions: 100, position: 10, ctr: 0.05 }),
      row("2026-05-02", { clicks: 15, impressions: 300, position: 20, ctr: 0.05 }),
    ];
    const out = rollupMonth("gsc", rows)!;
    // weighted = (10*100 + 20*300) / 400 = 7000/400 = 17.5. Simple mean would be 15.
    expect(out.position).toBe(17.5);
    // ctr = sum(clicks) 20 / sum(impressions) 400 = 0.05 (recomputed, not averaged).
    expect(out.ctr).toBe(0.05);
    expect(out.clicks).toBe(20);
    expect(out.impressions).toBe(400);
  });

  it("GSC: ctr and position are null when summed impressions are 0", () => {
    const rows = [row("2026-05-01", { clicks: 0, impressions: 0, position: 0, ctr: 0 })];
    const out = rollupMonth("gsc", rows)!;
    expect(out.ctr).toBeNull();
    expect(out.position).toBeNull();
  });

  it("GA4: counts sum, engagement_rate recomputed from summed components", () => {
    const rows = [
      row("2026-05-01", { sessions: 20, engaged_sessions: 10, key_events: 1, total_users: 18 }),
      row("2026-05-02", { sessions: 60, engaged_sessions: 30, key_events: 3, total_users: 24 }),
    ];
    const out = rollupMonth("ga4", rows)!;
    expect(out.sessions).toBe(80); // FLOW
    expect(out.key_events).toBe(4);
    expect(out.engagement_rate).toBe(0.5); // 40 / 80, NOT mean of daily (0.5, 0.5)
  });

  it("GA4: engagement_rate null when summed sessions are 0", () => {
    const rows = [row("2026-05-01", { sessions: 0, engaged_sessions: 0, key_events: 0 })];
    const out = rollupMonth("ga4", rows)!;
    expect(out.engagement_rate).toBeNull();
  });

  it("registry partitions every documented metric key into exactly one class", () => {
    for (const src of Object.keys(METRIC_REGISTRY) as Array<keyof typeof METRIC_REGISTRY>) {
      const { flow, stock, derived } = METRIC_REGISTRY[src];
      const all = [...flow, ...stock, ...derived];
      expect(new Set(all).size).toBe(all.length); // no key in two classes
    }
  });
});

describe("monthWindow / priorMonth", () => {
  it("bounds a 31-day month", () => {
    expect(monthWindow("2026-05")).toEqual({ start: "2026-05-01", end: "2026-05-31" });
  });
  it("bounds a 30-day month", () => {
    expect(monthWindow("2026-06")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });
  it("bounds February (non-leap) and a leap February", () => {
    expect(monthWindow("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthWindow("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
  });
  it("priorMonth handles the January -> prior December rollover", () => {
    expect(priorMonth("2026-01")).toBe("2025-12");
    expect(priorMonth("2026-06")).toBe("2026-05");
  });
});

describe("momDelta", () => {
  it("returns a signed ratio for valid current/prior", () => {
    expect(momDelta(120, 100)).toBeCloseTo(0.2);
    expect(momDelta(80, 100)).toBeCloseTo(-0.2);
  });
  it("is null when either side is null or prior is 0", () => {
    expect(momDelta(100, null)).toBeNull();
    expect(momDelta(null, 100)).toBeNull();
    expect(momDelta(100, 0)).toBeNull();
  });
});
