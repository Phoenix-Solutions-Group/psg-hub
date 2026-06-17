import { describe, it, expect, vi } from "vitest";
import {
  publishReply,
  deleteReply,
  type GbpReplyRequestFn,
} from "@/lib/google-oauth/gbp-reviews-reply";
import { GoogleApiError } from "@/lib/google-oauth/client";

const REVIEW_NAME = "accounts/111/locations/555/reviews/abc";

describe("publishReply", () => {
  it("PUTs {reviewName}/reply with body { comment } ONLY (no double-prefix)", async () => {
    const request = vi.fn().mockResolvedValue({ data: { reviewReplyState: "APPROVED" } });
    await publishReply("shop-1", REVIEW_NAME, "Thank you!", {
      request: request as unknown as GbpReplyRequestFn,
    });
    const opts = request.mock.calls[0][0];
    expect(opts.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/555/reviews/abc/reply"
    );
    expect(opts.url).not.toContain("accounts//");
    expect(opts.url).not.toContain("/reply/reply");
    expect(opts.method).toBe("PUT");
    expect(opts.data).toEqual({ comment: "Thank you!" });
  });

  it("rejects a comment over 4096 BYTES PSG-side BEFORE any request (bytes, not .length)", async () => {
    const request = vi.fn();
    // 1100 emoji = 4400 UTF-8 bytes but .length 2200 (< 4096) — a string-length check would WRONGLY allow.
    const big = "😀".repeat(1100);
    expect(big.length).toBeLessThan(4096);
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(4096);
    const err = await publishReply("shop-1", REVIEW_NAME, big, {
      request: request as unknown as GbpReplyRequestFn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "bad_request" });
    expect(request).not.toHaveBeenCalled();
  });

  it("allows a comment of exactly 4096 bytes (boundary)", async () => {
    const request = vi.fn().mockResolvedValue({ data: { reviewReplyState: "PENDING" } });
    const exact = "a".repeat(4096);
    await publishReply("shop-1", REVIEW_NAME, exact, {
      request: request as unknown as GbpReplyRequestFn,
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("returns the output-only reviewReplyState (PENDING is reflected, not coerced to published)", async () => {
    const request = vi.fn().mockResolvedValue({ data: { reviewReplyState: "PENDING" } });
    const out = await publishReply("shop-1", REVIEW_NAME, "ok", {
      request: request as unknown as GbpReplyRequestFn,
    });
    expect(out).toEqual({ reviewReplyState: "PENDING" });
  });

  it("returns reviewReplyState null when the response omits it", async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    const out = await publishReply("shop-1", REVIEW_NAME, "ok", {
      request: request as unknown as GbpReplyRequestFn,
    });
    expect(out).toEqual({ reviewReplyState: null });
  });

  it("maps a thrown non-2xx (403) to a GoogleApiError and rethrows", async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), { response: { status: 403 } });
    });
    const err = await publishReply("shop-1", REVIEW_NAME, "ok", {
      request: request as unknown as GbpReplyRequestFn,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "auth_failed" });
  });

  it("throws bad_request when the shop has no linked gbp account (no request issued)", async () => {
    const request = vi.fn();
    const err = await publishReply("shop-1", REVIEW_NAME, "ok", {
      getLinkedAccount: async () => null,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "bad_request" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("deleteReply", () => {
  it("issues DELETE {reviewName}/reply with no body", async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    await deleteReply("shop-1", REVIEW_NAME, {
      request: request as unknown as GbpReplyRequestFn,
    });
    const opts = request.mock.calls[0][0];
    expect(opts.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/555/reviews/abc/reply"
    );
    expect(opts.method).toBe("DELETE");
    expect(opts.data).toBeUndefined();
  });
});
