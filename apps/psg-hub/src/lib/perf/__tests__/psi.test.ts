import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker } from "@/lib/resilience";
import {
  fetchPsi,
  psiConfigured,
  PerfHttpError,
  type PsiApiResponse,
  type PsiHttpGet,
} from "@/lib/perf/psi";

function freshBreaker() {
  return new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
}

const URL = "https://wallacecollisionrepair.com";

/** A full PSI response with lab + a URL-level CrUX field block. */
function fullResponse(): PsiApiResponse {
  return {
    lighthouseResult: {
      categories: { performance: { score: 0.62 } },
      audits: {
        "largest-contentful-paint": { numericValue: 3200 },
        "cumulative-layout-shift": { numericValue: 0.05 },
        "total-blocking-time": { numericValue: 410 },
        "first-contentful-paint": { numericValue: 1800 },
        "speed-index": { numericValue: 4100 },
        "server-response-time": { numericValue: 620 },
      },
    },
    loadingExperience: {
      overall_category: "AVERAGE",
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2900 },
        INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12 }, // ×100 -> 0.12
        FIRST_CONTENTFUL_PAINT_MS: { percentile: 1700 },
        EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 540 },
      },
    },
  };
}

describe("fetchPsi", () => {
  it("parses lab (score×100, named-audit ms, CLS unitless) + CrUX field with exact KEYS and CLS÷100; requests mobile+key", async () => {
    let captured = "";
    const httpGet: PsiHttpGet = async (reqUrl) => {
      captured = reqUrl;
      return fullResponse();
    };
    const out = await fetchPsi(URL, {
      httpGet,
      breaker: freshBreaker(),
      apiKey: "TESTKEY",
    });

    expect(out.perf_score).toBe(62); // 0.62 × 100
    expect(out.lab_lcp_ms).toBe(3200);
    expect(out.lab_cls).toBe(0.05);
    expect(out.lab_tbt_ms).toBe(410);
    expect(out.lab_ttfb_ms).toBe(620); // server-response-time, the real TTFB
    expect(out.field).not.toBeNull();
    expect(out.field!.lcp_ms).toBe(2900);
    expect(out.field!.inp_ms).toBe(180);
    expect(out.field!.cls).toBeCloseTo(0.12); // 12 / 100
    expect(out.field!.overall_category).toBe("AVERAGE");
    expect(out.origin_field).toBe(false);

    // request shape: strategy=mobile + key + encoded url
    expect(captured).toContain("strategy=mobile");
    expect(captured).toContain("key=TESTKEY");
    expect(captured).toContain(encodeURIComponent(URL));
  });

  it("returns field=null as a successful-EMPTY result when no CrUX block exists (no throw, breaker untripped)", async () => {
    const breaker = freshBreaker();
    const httpGet: PsiHttpGet = async () => ({
      lighthouseResult: {
        categories: { performance: { score: 0.4 } },
        audits: { "largest-contentful-paint": { numericValue: 5000 } },
      },
      // no loadingExperience, no originLoadingExperience
    });
    const out = await fetchPsi(URL, { httpGet, breaker, apiKey: "K" });
    expect(out.field).toBeNull();
    expect(out.perf_score).toBe(40);
    expect(out.lab_lcp_ms).toBe(5000);
    expect(breaker.getState()).toBe("closed"); // empty field is NOT a failure
  });

  it("falls back to origin field and sets origin_field=true", async () => {
    const httpGet: PsiHttpGet = async () => ({
      lighthouseResult: { categories: { performance: { score: 0.5 } }, audits: {} },
      originLoadingExperience: {
        overall_category: "SLOW",
        metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4200 } },
      },
    });
    const out = await fetchPsi(URL, { httpGet, breaker: freshBreaker(), apiKey: "K" });
    expect(out.field).not.toBeNull();
    expect(out.field!.lcp_ms).toBe(4200);
    expect(out.field!.overall_category).toBe("SLOW");
    expect(out.origin_field).toBe(true);
  });

  it("retries a transient 503 then succeeds (breaker/retry seam)", async () => {
    const fn = vi
      .fn<PsiHttpGet>()
      .mockRejectedValueOnce(new PerfHttpError(503, "PSI HTTP 503"))
      .mockResolvedValueOnce(fullResponse());
    const out = await fetchPsi(URL, {
      httpGet: fn,
      breaker: freshBreaker(),
      retry: { retries: 3, baseDelayMs: 1 },
      apiKey: "K",
    });
    expect(out.perf_score).toBe(62);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 403 (bad key) — rethrows immediately", async () => {
    const fn = vi
      .fn<PsiHttpGet>()
      .mockRejectedValue(new PerfHttpError(403, "PSI HTTP 403"));
    await expect(
      fetchPsi(URL, {
        httpGet: fn,
        breaker: freshBreaker(),
        retry: { retries: 3, baseDelayMs: 1 },
        apiKey: "K",
      })
    ).rejects.toBeInstanceOf(PerfHttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("psiConfigured() reflects the env key", () => {
    const prior = process.env.PAGESPEED_API_KEY;
    try {
      delete process.env.PAGESPEED_API_KEY;
      expect(psiConfigured()).toBe(false);
      process.env.PAGESPEED_API_KEY = "x";
      expect(psiConfigured()).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.PAGESPEED_API_KEY;
      else process.env.PAGESPEED_API_KEY = prior;
    }
  });

  it("defaultHttpGet surfaces the PSI error body in the thrown message (diagnosability)", async () => {
    // The real fetch path (no httpGet seam) must carry the PSI error reason, not just the status.
    const body =
      '{"error":{"code":400,"message":"Lighthouse returned error: ERRORED_DOCUMENT_REQUEST. Status code: 403"}}';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => body,
      })) as unknown as typeof fetch
    );
    try {
      const err = await fetchPsi(URL, {
        breaker: freshBreaker(),
        retry: { retries: 3, baseDelayMs: 1 },
        apiKey: "K",
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PerfHttpError);
      const perr = err as PerfHttpError;
      expect(perr.status).toBe(400);
      expect(perr.message).toContain("PSI HTTP 400:");
      expect(perr.message).toContain("ERRORED_DOCUMENT_REQUEST");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
