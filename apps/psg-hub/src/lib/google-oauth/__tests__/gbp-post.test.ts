import { describe, it, expect, vi } from "vitest";
import {
  createLocalPost,
  deleteLocalPost,
  buildLocalPostBody,
  localPostInputSchema,
  MAX_SUMMARY_CHARS,
  type GbpPostRequestFn
} from "@/lib/google-oauth/gbp-post";
import { GoogleApiError } from "@/lib/google-oauth/client";
import type { LinkedAccount } from "@/lib/google-oauth/accounts";

const RESOURCE = "accounts/111/locations/555";

const linked = (over: Partial<LinkedAccount> = {}): LinkedAccount => ({
  accountId: "acc-row-1",
  externalAccountId: "locations/555",
  externalParentId: "accounts/111",
  refreshToken: "rt",
  ...over,
});

describe("localPostInputSchema", () => {
  it("accepts a minimal summary-only post and defaults languageCode", () => {
    const r = localPostInputSchema.safeParse({ summary: "We now offer free estimates!" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.languageCode).toBe("en-US");
  });

  it("rejects an empty summary and one over the 1500-char limit", () => {
    expect(localPostInputSchema.safeParse({ summary: "" }).success).toBe(false);
    expect(
      localPostInputSchema.safeParse({ summary: "x".repeat(MAX_SUMMARY_CHARS + 1) }).success
    ).toBe(false);
    // boundary: exactly 1500 is allowed.
    expect(
      localPostInputSchema.safeParse({ summary: "x".repeat(MAX_SUMMARY_CHARS) }).success
    ).toBe(true);
  });

  it("requires a url for a non-CALL CTA and forbids one for CALL", () => {
    expect(
      localPostInputSchema.safeParse({
        summary: "Book today",
        callToAction: { actionType: "BOOK" },
      }).success
    ).toBe(false);
    expect(
      localPostInputSchema.safeParse({
        summary: "Call us",
        callToAction: { actionType: "CALL", url: "https://x.test" },
      }).success
    ).toBe(false);
    expect(
      localPostInputSchema.safeParse({
        summary: "Call us",
        callToAction: { actionType: "CALL" },
      }).success
    ).toBe(true);
  });
});

describe("buildLocalPostBody", () => {
  it("emits a STANDARD topic with summary + languageCode and no CTA when omitted", () => {
    const body = buildLocalPostBody(localPostInputSchema.parse({ summary: "hi" }));
    expect(body).toEqual({ languageCode: "en-US", summary: "hi", topicType: "STANDARD" });
    expect(body).not.toHaveProperty("callToAction");
  });

  it("includes the CTA with its url for a non-CALL action", () => {
    const body = buildLocalPostBody(
      localPostInputSchema.parse({
        summary: "Shop now",
        callToAction: { actionType: "SHOP", url: "https://shop.test" },
      })
    );
    expect(body.callToAction).toEqual({ actionType: "SHOP", url: "https://shop.test" });
  });

  it("omits the url for a CALL CTA", () => {
    const body = buildLocalPostBody(
      localPostInputSchema.parse({ summary: "Call", callToAction: { actionType: "CALL" } })
    );
    expect(body.callToAction).toEqual({ actionType: "CALL" });
  });
});

describe("createLocalPost", () => {
  it("POSTs accounts/{aid}/locations/{lid}/localPosts with the built body", async () => {
    const request = vi.fn().mockResolvedValue({
      data: { name: `${RESOURCE}/localPosts/abc`, state: "LIVE" },
    });
    const out = await createLocalPost(
      "shop-1",
      { summary: "Free estimates this week", languageCode: "en-US" },
      { request: request as unknown as GbpPostRequestFn, resourcePath: RESOURCE }
    );
    const opts = request.mock.calls[0][0];
    expect(opts.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/555/localPosts"
    );
    expect(opts.url).not.toContain("locations//");
    expect(opts.method).toBe("POST");
    expect(opts.data).toMatchObject({ summary: "Free estimates this week", topicType: "STANDARD" });
    expect(out).toEqual({ name: `${RESOURCE}/localPosts/abc`, state: "LIVE", searchUrl: null });
  });

  it("reflects an output-only PROCESSING/REJECTED state (never coerces to LIVE)", async () => {
    const request = vi.fn().mockResolvedValue({ data: { name: "n", state: "REJECTED" } });
    const out = await createLocalPost(
      "shop-1",
      { summary: "x" },
      { request: request as unknown as GbpPostRequestFn, resourcePath: RESOURCE }
    );
    expect(out.state).toBe("REJECTED");
  });

  it("rejects an invalid post PSG-side BEFORE any request (over-limit summary)", async () => {
    const request = vi.fn();
    const err = await createLocalPost(
      "shop-1",
      { summary: "x".repeat(MAX_SUMMARY_CHARS + 1) } as never,
      { request: request as unknown as GbpPostRequestFn, resourcePath: RESOURCE }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "bad_request" });
    expect(request).not.toHaveBeenCalled();
  });

  it("derives the resource path from the linked account's parent + location", async () => {
    const request = vi.fn().mockResolvedValue({ data: { name: "n", state: "LIVE" } });
    await createLocalPost(
      "shop-1",
      { summary: "hi" },
      {
        request: request as unknown as GbpPostRequestFn,
        getLinkedAccount: async () => linked(),
      }
    );
    expect(request.mock.calls[0][0].url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/555/localPosts"
    );
  });

  it("throws bad_request when no gbp account is linked (no request issued)", async () => {
    const request = vi.fn();
    const err = await createLocalPost(
      "shop-1",
      { summary: "hi" },
      {
        request: request as unknown as GbpPostRequestFn,
        getLinkedAccount: async () => null,
      }
    ).catch((e) => e);
    expect(err).toMatchObject({ code: "bad_request" });
    expect(request).not.toHaveBeenCalled();
  });

  it("throws bad_request when the linked account has no parent account id", async () => {
    const request = vi.fn();
    const err = await createLocalPost(
      "shop-1",
      { summary: "hi" },
      {
        request: request as unknown as GbpPostRequestFn,
        getLinkedAccount: async () => linked({ externalParentId: null }),
      }
    ).catch((e) => e);
    expect(err).toMatchObject({ code: "bad_request" });
    expect(request).not.toHaveBeenCalled();
  });

  it("maps a thrown non-2xx (403) to a GoogleApiError and rethrows", async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), { response: { status: 403 } });
    });
    const err = await createLocalPost(
      "shop-1",
      { summary: "hi" },
      { request: request as unknown as GbpPostRequestFn, resourcePath: RESOURCE }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).toMatchObject({ code: "auth_failed" });
  });
});

describe("deleteLocalPost", () => {
  it("DELETEs the full post resource name (self-contained url)", async () => {
    const request = vi.fn().mockResolvedValue({ data: {} });
    await deleteLocalPost("shop-1", `${RESOURCE}/localPosts/abc`, {
      request: request as unknown as GbpPostRequestFn,
      getLinkedAccount: async () => linked(),
    });
    const opts = request.mock.calls[0][0];
    expect(opts.url).toBe(
      "https://mybusiness.googleapis.com/v4/accounts/111/locations/555/localPosts/abc"
    );
    expect(opts.method).toBe("DELETE");
  });
});
