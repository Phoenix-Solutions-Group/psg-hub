import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GET,
  parsePrintSlug,
  defaultLoader,
} from "@/app/reports/[slug]/print/route";
import { getMonthlySnapshot, getSnapshots } from "@/lib/analytics/snapshots";
import { loadReportNarrative } from "@/lib/report/storage";
import { getReviewSentimentSummary } from "@/lib/reviews/sentiment-summary";

// 12-05c wiring guard — the print (PDF) path must bind BOTH monthly readers so the
// GA4 dimensional sections + the Website-performance block reach the report. These
// mocks let defaultLoader run without a DB/storage; the assertion fails loudly if the
// reader binding is ever removed (the advisor's silent-un-wiring regression).
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({}),
}));
vi.mock("@/lib/analytics/snapshots", () => ({
  getSnapshots: vi.fn(async () => []),
  getMonthlySnapshot: vi.fn(async () => null),
}));
vi.mock("@/lib/report/storage", () => ({
  loadReportNarrative: vi.fn(async () => ({ headline: "h" })),
}));
// 14-03b: the print path also binds the review-sentiment reader; stub it (zeroed -> no block)
// so defaultLoader runs without a DB, and guard the binding the same way as the monthly readers.
vi.mock("@/lib/reviews/sentiment-summary", () => ({
  getReviewSentimentSummary: vi.fn(async () => ({
    total: 0,
    positive: 0,
    neutral: 0,
    negative: 0,
    actionableOpen: 0,
    avgConfidence: null,
    topThemes: [],
  })),
}));

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

  it("accepts normalized token values (trim + outer quotes)", async () => {
    process.env.RENDER_TOKEN = ' "test-render-token" ';
    const res = await call({ authorization: "Bearer test-render-token" }, "not-a-valid-slug");
    expect(res.status).toBe(400);
  });

  it("400 on a malformed slug (valid token, gate passed)", async () => {
    const res = await call({ authorization: "Bearer test-render-token" }, "not-a-valid-slug");
    expect(res.status).toBe(400);
  });
});

describe("print defaultLoader wires the monthly readers (12-05c)", () => {
  beforeEach(() => {
    vi.mocked(getMonthlySnapshot).mockClear();
    vi.mocked(getSnapshots).mockClear();
    vi.mocked(loadReportNarrative).mockResolvedValue({ headline: "h" } as never);
  });

  it("reads BOTH ga4_dimensions and performance monthly rows for the report month", async () => {
    const shopId = "11111111-1111-1111-1111-111111111111";
    const payload = await defaultLoader(shopId, "2026-05");

    expect(payload).not.toBeNull();
    // the binding ran for each extended monthly source
    const sources = vi
      .mocked(getMonthlySnapshot)
      .mock.calls.map((c) => c[1].source);
    expect(sources).toContain("ga4_dimensions");
    expect(sources).toContain("performance");
    // 14-03b reader is wired too (silent un-wiring guard)
    expect(getReviewSentimentSummary).toHaveBeenCalledWith(expect.anything(), {
      shopId,
      month: "2026-05",
    });
    // and for the correct month (date = {month}-01 happens inside the reader)
    for (const call of vi.mocked(getMonthlySnapshot).mock.calls) {
      expect(call[1]).toMatchObject({ shopId, month: "2026-05" });
    }
  });

  it("returns null (no render) when no eval-passed narrative is persisted", async () => {
    vi.mocked(loadReportNarrative).mockResolvedValueOnce(null as never);
    const payload = await defaultLoader(
      "11111111-1111-1111-1111-111111111111",
      "2026-05"
    );
    expect(payload).toBeNull();
    expect(getMonthlySnapshot).not.toHaveBeenCalled();
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
