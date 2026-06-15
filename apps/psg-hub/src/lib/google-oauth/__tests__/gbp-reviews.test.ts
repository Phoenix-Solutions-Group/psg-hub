import { describe, it, expect, vi } from "vitest";
import {
  fetchGbpReviewsAggregate,
  type GbpV4RequestFn,
} from "@/lib/google-oauth/gbp-reviews";
import { GoogleApiError } from "@/lib/google-oauth/client";
import type { LinkedAccount } from "@/lib/google-oauth/accounts";

// The deps.getLinkedAccount + deps.request seams inject the account + the raw v4
// response; buildOAuth2Client / the real network never run.

const ACCT: LinkedAccount = {
  accountId: "row-1",
  externalAccountId: "locations/555",
  externalParentId: "accounts/111",
  refreshToken: "rt",
};

describe("fetchGbpReviewsAggregate", () => {
  it("renames the top-level averageRating/totalReviewCount to snake_case", async () => {
    const request = vi.fn(async () => ({
      data: { averageRating: 4.6, totalReviewCount: 87, reviews: [{}] },
    }));
    const out = await fetchGbpReviewsAggregate("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpV4RequestFn,
    });
    expect(out).toEqual({ average_rating: 4.6, total_review_count: 87 });
  });

  it("issues ONE GET with pageSize:1 to the plain slash-join parent (no double prefix)", async () => {
    const request = vi.fn(
      async (_opts: Parameters<GbpV4RequestFn>[0]) => ({
        data: { averageRating: 5, totalReviewCount: 2 },
      })
    );
    await fetchGbpReviewsAggregate("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpV4RequestFn,
    });
    expect(request).toHaveBeenCalledTimes(1);
    const opts = request.mock.calls[0][0];
    expect(opts.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/555/reviews"
    );
    expect(opts.url).not.toContain("accounts//");
    expect(opts.url).not.toContain("locations/accounts/");
    expect(opts.method).toBe("GET");
    expect(opts.params).toEqual({ pageSize: 1 });
  });

  it("returns a null pair when the 200 response omits the aggregate (never ?? 0)", async () => {
    const request = vi.fn(async () => ({ data: { reviews: [] } }));
    const out = await fetchGbpReviewsAggregate("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpV4RequestFn,
    });
    expect(out).toEqual({ average_rating: null, total_review_count: null });
  });

  it("returns a null pair WITHOUT a request when externalParentId is null (pre-13-01 row)", async () => {
    const request = vi.fn();
    const out = await fetchGbpReviewsAggregate("shop-1", {
      getLinkedAccount: async () => ({ ...ACCT, externalParentId: null }),
      request: request as unknown as GbpV4RequestFn,
    });
    expect(out).toEqual({ average_rating: null, total_review_count: null });
    expect(request).not.toHaveBeenCalled();
  });

  it("returns a null pair WITHOUT a request when no gbp account is linked", async () => {
    const request = vi.fn();
    const out = await fetchGbpReviewsAggregate("shop-1", {
      getLinkedAccount: async () => null,
      request: request as unknown as GbpV4RequestFn,
    });
    expect(out).toEqual({ average_rating: null, total_review_count: null });
    expect(request).not.toHaveBeenCalled();
  });

  it("maps a thrown non-2xx (403) to a GoogleApiError and rethrows (the orchestrator swallows)", async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), { response: { status: 403 } });
    });
    const err = await fetchGbpReviewsAggregate("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpV4RequestFn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "auth_failed" });
  });
});
