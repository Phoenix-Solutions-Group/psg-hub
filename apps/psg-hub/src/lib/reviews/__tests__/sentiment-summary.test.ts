import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  summarizeSentiment,
  getReviewSentimentSummary,
} from "@/lib/reviews/sentiment-summary";

describe("summarizeSentiment", () => {
  it("tallies polarity, actionable, avg confidence, and ranks/caps themes", () => {
    const s = summarizeSentiment([
      { polarity: "positive", confidence: 0.9, themes: ["quality", "speed"], actionable_complaint: false },
      { polarity: "positive", confidence: 0.8, themes: ["quality"], actionable_complaint: false },
      { polarity: "negative", confidence: 0.6, themes: ["price", "quality"], actionable_complaint: true },
      { polarity: "neutral", confidence: null, themes: [], actionable_complaint: false },
    ]);
    expect(s.total).toBe(4);
    expect(s.positive).toBe(2);
    expect(s.neutral).toBe(1);
    expect(s.negative).toBe(1);
    expect(s.actionableOpen).toBe(1);
    // avg over the 3 numeric confidences (null excluded): (0.9+0.8+0.6)/3
    expect(s.avgConfidence).toBeCloseTo(0.7666, 3);
    // quality 3 (rank 1), then price 1 / speed 1 tie broken alphabetically
    expect(s.topThemes[0]).toEqual({ theme: "quality", count: 3 });
    expect(s.topThemes.map((t) => t.theme)).toEqual(["quality", "price", "speed"]);
  });

  it("caps topThemes at 6 and drops blank themes", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      polarity: "neutral",
      confidence: 0.5,
      themes: [`theme${i}`, "  "], // blank filtered out
      actionable_complaint: false,
    }));
    const s = summarizeSentiment(rows);
    expect(s.topThemes).toHaveLength(6);
    expect(s.topThemes.some((t) => t.theme.trim() === "")).toBe(false);
  });

  it("returns a zeroed summary (no throw, null avg) for empty input", () => {
    const s = summarizeSentiment([]);
    expect(s).toEqual({
      total: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      actionableOpen: 0,
      avgConfidence: null,
      topThemes: [],
    });
  });
});

/** A self-returning, thenable query builder that resolves to { data, error } regardless of
 *  which chain methods (.select/.eq/.gte/.lt/.limit) are called or in what order. */
function fakeClient(rows: unknown[], error: { message: string } | null = null) {
  const calls: Record<string, unknown[]> = {};
  const builder: Record<string, unknown> = {};
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return builder;
    };
  for (const m of ["select", "eq", "gte", "lt", "limit"]) builder[m] = record(m);
  builder.then = (resolve: (v: { data: unknown[]; error: unknown }) => unknown) =>
    resolve({ data: rows, error });
  const client = { from: record("from") } as unknown as SupabaseClient;
  return { client, calls };
}

describe("getReviewSentimentSummary", () => {
  it("reads review_sentiment for the shop and summarizes (no month -> no date filter)", async () => {
    const { client, calls } = fakeClient([
      { polarity: "positive", confidence: 0.9, themes: ["quality"], actionable_complaint: false },
      { polarity: "negative", confidence: 0.4, themes: ["price"], actionable_complaint: true },
    ]);
    const s = await getReviewSentimentSummary(client, { shopId: "shop-1" });
    expect(calls.from?.[0]).toEqual(["review_sentiment"]);
    expect(calls.eq?.[0]).toEqual(["shop_id", "shop-1"]);
    expect(calls.gte).toBeUndefined(); // no month -> no reviewed_at window
    expect(s.total).toBe(2);
    expect(s.positive).toBe(1);
    expect(s.negative).toBe(1);
    expect(s.actionableOpen).toBe(1);
  });

  it("applies the reviewed_at month window when month is given", async () => {
    const { client, calls } = fakeClient([]);
    await getReviewSentimentSummary(client, { shopId: "shop-1", month: "2026-06" });
    expect(calls.gte?.[0]).toEqual(["review_items.reviewed_at", "2026-06-01"]);
    expect(calls.lt?.[0]).toEqual(["review_items.reviewed_at", "2026-07-01"]);
  });

  it("rolls the year for a December month window", async () => {
    const { client, calls } = fakeClient([]);
    await getReviewSentimentSummary(client, { shopId: "shop-1", month: "2026-12" });
    expect(calls.lt?.[0]).toEqual(["review_items.reviewed_at", "2027-01-01"]);
  });

  it("throws on a read error", async () => {
    const { client } = fakeClient([], { message: "boom" });
    await expect(
      getReviewSentimentSummary(client, { shopId: "shop-1" })
    ).rejects.toThrow(/review_sentiment read failed: boom/);
  });
});
