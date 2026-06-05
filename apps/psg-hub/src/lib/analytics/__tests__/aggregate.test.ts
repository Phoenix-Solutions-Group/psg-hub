import { describe, it, expect } from "vitest";
import {
  aggregateByDate,
  latestSnapshot,
  latestSyncedAt,
  toSeries,
  formatShortDate,
  formatSyncedAt,
  formatNumber,
  trailingWindow,
  type DatedMetrics,
} from "../aggregate";

const row = (
  date: string,
  metrics: Record<string, unknown>
): DatedMetrics => ({ date, metrics });

describe("aggregateByDate", () => {
  it("sums numeric metric keys across shops per date, sorted ascending", () => {
    const out = aggregateByDate([
      row("2026-06-02", { organic_traffic: 100, backlinks: 10 }),
      row("2026-06-01", { organic_traffic: 50 }),
      row("2026-06-02", { organic_traffic: 40, backlinks: 5 }),
    ]);
    expect(out).toEqual([
      { date: "2026-06-01", metrics: { organic_traffic: 50 } },
      { date: "2026-06-02", metrics: { organic_traffic: 140, backlinks: 15 } },
    ]);
  });

  it("treats a key missing from one shop as 0 (no NaN propagation)", () => {
    const out = aggregateByDate([
      row("2026-06-01", { organic_traffic: 10, backlinks: 3 }),
      row("2026-06-01", { organic_traffic: 7 }),
    ]);
    expect(out[0].metrics).toEqual({ organic_traffic: 17, backlinks: 3 });
  });

  it("drops non-numeric and non-finite metric values", () => {
    const out = aggregateByDate([
      row("2026-06-01", {
        organic_traffic: 5,
        position_distribution: { top3: 1 },
        note: "text",
        bad: NaN,
        worse: Infinity,
      }),
    ]);
    expect(out[0].metrics).toEqual({ organic_traffic: 5 });
  });

  it("single shop passes through (sum of one)", () => {
    const out = aggregateByDate([row("2026-06-01", { organic_traffic: 9 })]);
    expect(out).toEqual([
      { date: "2026-06-01", metrics: { organic_traffic: 9 } },
    ]);
  });

  it("empty input -> []", () => {
    expect(aggregateByDate([])).toEqual([]);
  });
});

describe("latestSnapshot", () => {
  it("returns the newest row by date regardless of input order", () => {
    const rows = [
      { date: "2026-06-03" },
      { date: "2026-06-05" },
      { date: "2026-06-01" },
    ];
    expect(latestSnapshot(rows)).toEqual({ date: "2026-06-05" });
  });

  it("null on empty", () => {
    expect(latestSnapshot([])).toBeNull();
  });
});

describe("latestSyncedAt", () => {
  it("returns the max synced_at across rows", () => {
    expect(
      latestSyncedAt([
        { synced_at: "2026-06-04T10:00:00Z" },
        { synced_at: "2026-06-04T18:30:00Z" },
        { synced_at: "2026-06-03T01:00:00Z" },
      ])
    ).toBe("2026-06-04T18:30:00Z");
  });

  it("null on empty / empty strings", () => {
    expect(latestSyncedAt([])).toBeNull();
    expect(latestSyncedAt([{ synced_at: "" }])).toBeNull();
  });
});

describe("toSeries", () => {
  it("maps a metric key into { date, value } points", () => {
    const out = toSeries(
      [row("2026-06-01", { organic_traffic: 12 }), row("2026-06-02", { organic_traffic: 15 })],
      "organic_traffic"
    );
    expect(out).toEqual([
      { date: "2026-06-01", value: 12 },
      { date: "2026-06-02", value: 15 },
    ]);
  });

  it("missing / non-numeric values become 0 (never crash a chart)", () => {
    const out = toSeries(
      [row("2026-06-01", {}), row("2026-06-02", { organic_traffic: "n/a" })],
      "organic_traffic"
    );
    expect(out).toEqual([
      { date: "2026-06-01", value: 0 },
      { date: "2026-06-02", value: 0 },
    ]);
  });
});

describe("formatters (fixed locale + UTC — deterministic)", () => {
  it("formatShortDate", () => {
    expect(formatShortDate("2026-06-04")).toBe("Jun 4");
    expect(formatShortDate("not-a-date")).toBe("not-a-date");
  });

  it("formatSyncedAt", () => {
    expect(formatSyncedAt("2026-06-04T15:30:00Z")).toMatch(
      /Jun 4, 2026, 3:30 PM/
    );
    expect(formatSyncedAt("garbage")).toBe("");
  });

  it("formatNumber groups thousands", () => {
    expect(formatNumber(12345)).toBe("12,345");
  });
});

describe("trailingWindow", () => {
  it("returns inclusive ISO from/to for the trailing N days (injectable clock)", () => {
    const now = new Date("2026-06-05T12:00:00Z");
    expect(trailingWindow(30, now)).toEqual({
      from: "2026-05-06",
      to: "2026-06-05",
    });
  });
});
