import { describe, it, expect, beforeEach } from "vitest";
import { GET, parsePrintSlug } from "@/app/reports/[slug]/print/route";

// AC-1 auth + slug clauses for the INTERNAL print route. The route renders ANY
// shop's data via the service client (RLS-bypass), so the RENDER_TOKEN bearer is the
// only tenant boundary. 401/400 both return BEFORE any IO, so no mocks are needed.
// (Beyond the planned file list — added at APPLY to cover AC-1's "401 without
// RENDER_TOKEN" clause, which had no allocated test. See 12-03-SUMMARY.)

const SLUG = "11111111-1111-1111-1111-111111111111__2026-05";

function call(headers: Record<string, string>, slug = SLUG) {
  return GET(new Request("https://hub.psgweb.me/reports/x/print", { headers }), {
    params: Promise.resolve({ slug }),
  });
}

beforeEach(() => {
  process.env.RENDER_TOKEN = "test-render-token";
});

describe("print route auth", () => {
  it("401 when no Authorization header is present", async () => {
    const res = await call({});
    expect(res.status).toBe(401);
  });

  it("401 when the bearer token is wrong", async () => {
    const res = await call({ authorization: "Bearer wrong-token" });
    expect(res.status).toBe(401);
  });

  it("401 when RENDER_TOKEN is unconfigured (locked by default)", async () => {
    delete process.env.RENDER_TOKEN;
    const res = await call({ authorization: "Bearer anything" });
    expect(res.status).toBe(401);
  });

  it("400 on a malformed slug (valid token, gate passed)", async () => {
    const res = await call({ authorization: "Bearer test-render-token" }, "not-a-valid-slug");
    expect(res.status).toBe(400);
  });
});

describe("parsePrintSlug", () => {
  it("splits {shopId}__{period}", () => {
    expect(parsePrintSlug(SLUG)).toEqual({
      shopId: "11111111-1111-1111-1111-111111111111",
      period: "2026-05",
    });
  });

  it("rejects a malformed slug", () => {
    expect(parsePrintSlug("nope")).toBeNull();
    expect(parsePrintSlug("11111111-1111-1111-1111-111111111111__2026-5")).toBeNull();
  });
});
