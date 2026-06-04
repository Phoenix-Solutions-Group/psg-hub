import { describe, it, expect, vi, beforeEach } from "vitest";

// Each call to llm_call_log .gte() consumes the next queued result.
const gteResults: Array<{ count: number | null; error: unknown }> = [];

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn(() => Promise.resolve(gteResults.shift())),
    })),
  })),
}));

const { assertWithinLimits, RateLimitError } = await import(
  "@/lib/reviews/rate-limit"
);

const input = { userId: "u1", shopId: "shopA", reviewId: "r1" };

beforeEach(() => {
  gteResults.length = 0;
});

describe("assertWithinLimits", () => {
  it("resolves when both windows are under limit", async () => {
    gteResults.push({ count: 0, error: null }, { count: 0, error: null });
    await expect(assertWithinLimits(input)).resolves.toBeUndefined();
  });

  it("throws per_review_hour when the review window is at limit", async () => {
    gteResults.push({ count: 10, error: null });
    await expect(assertWithinLimits(input)).rejects.toMatchObject({
      scope: "per_review_hour",
    });
  });

  it("throws per_shop_day when the shop window is at limit", async () => {
    gteResults.push({ count: 0, error: null }, { count: 100, error: null });
    await expect(assertWithinLimits(input)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws when the review-window query errors", async () => {
    gteResults.push({ count: null, error: { message: "boom" } });
    await expect(assertWithinLimits(input)).rejects.toThrow(
      /rate-limit check failed/
    );
  });

  it("throws when the shop-window query errors", async () => {
    gteResults.push(
      { count: 0, error: null },
      { count: null, error: { message: "boom2" } }
    );
    await expect(assertWithinLimits(input)).rejects.toThrow(
      /rate-limit check failed/
    );
  });
});
