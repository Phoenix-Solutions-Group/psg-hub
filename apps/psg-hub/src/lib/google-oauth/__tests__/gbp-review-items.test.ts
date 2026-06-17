import { describe, it, expect, vi } from "vitest";
import {
  fetchGbpReviews,
  type GbpReviewsRequestFn,
} from "@/lib/google-oauth/gbp-review-items";
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

function review(overrides: Record<string, unknown> = {}) {
  return {
    name: "accounts/111/locations/555/reviews/abc",
    starRating: "FIVE",
    comment: "Great work",
    createTime: "2026-06-01T10:00:00Z",
    updateTime: "2026-06-02T10:00:00Z",
    reviewer: { displayName: "Jane D", isAnonymous: false },
    ...overrides,
  };
}

describe("fetchGbpReviews", () => {
  it("maps every field on a single page", async () => {
    const request = vi.fn(async () => ({ data: { reviews: [review()] } }));
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out).toEqual([
      {
        external_review_id: "accounts/111/locations/555/reviews/abc",
        platform: "google",
        rating: 5,
        text: "Great work",
        author: "Jane D",
        reviewed_at: "2026-06-01T10:00:00Z",
        updated_at: "2026-06-02T10:00:00Z",
      },
    ]);
  });

  it("issues the FIRST GET with pageSize:50 + orderBy to the plain slash-join parent", async () => {
    const request = vi.fn().mockResolvedValue({ data: { reviews: [review()] } });
    await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    const opts = request.mock.calls[0][0];
    expect(opts.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/555/reviews"
    );
    expect(opts.url).not.toContain("accounts//");
    expect(opts.url).not.toContain("locations/accounts/");
    expect(opts.method).toBe("GET");
    expect(opts.params).toEqual({ pageSize: 50, orderBy: "updateTime desc" });
  });

  it("loops nextPageToken to completion and concatenates pages", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          reviews: [review({ name: "r/1" })],
          nextPageToken: "tok-2",
        },
      })
      .mockResolvedValueOnce({
        data: { reviews: [review({ name: "r/2" })] },
      });
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out.map((r) => r.external_review_id)).toEqual(["r/1", "r/2"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].params).toMatchObject({ pageToken: "tok-2" });
  });

  it("nulls the author when the reviewer is anonymous", async () => {
    const request = vi.fn(async () => ({
      data: {
        reviews: [
          review({ reviewer: { displayName: "Hidden", isAnonymous: true } }),
        ],
      },
    }));
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out[0].author).toBeNull();
  });

  it("maps STAR_RATING_UNSPECIFIED (and unknown) to a null rating, never 0", async () => {
    const request = vi.fn(async () => ({
      data: {
        reviews: [
          review({ name: "r/1", starRating: "STAR_RATING_UNSPECIFIED" }),
          review({ name: "r/2", starRating: undefined }),
        ],
      },
    }));
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out.map((r) => r.rating)).toEqual([null, null]);
  });

  it("nulls text on a rating-only review (no comment)", async () => {
    const request = vi.fn(async () => ({
      data: { reviews: [review({ comment: undefined })] },
    }));
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out[0].text).toBeNull();
  });

  it("returns [] (never throws) when the 200 omits the reviews array (unverified/non-VoM)", async () => {
    const request = vi.fn(async () => ({ data: { averageRating: 0 } }));
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out).toEqual([]);
  });

  it("skips a review with no resource name (no fabricated dedupe key)", async () => {
    const request = vi.fn(async () => ({
      data: { reviews: [review({ name: undefined }), review({ name: "r/keep" })] },
    }));
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out.map((r) => r.external_review_id)).toEqual(["r/keep"]);
  });

  it("returns [] WITHOUT a request when externalParentId is null (pre-13-01 row)", async () => {
    const request = vi.fn();
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ({ ...ACCT, externalParentId: null }),
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns [] WITHOUT a request when no gbp account is linked", async () => {
    const request = vi.fn();
    const out = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => null,
      request: request as unknown as GbpReviewsRequestFn,
    });
    expect(out).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("maps a thrown non-2xx (403) to a GoogleApiError and rethrows (orchestrator contains)", async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), { response: { status: 403 } });
    });
    const err = await fetchGbpReviews("shop-1", {
      getLinkedAccount: async () => ACCT,
      request: request as unknown as GbpReviewsRequestFn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "auth_failed" });
  });
});
