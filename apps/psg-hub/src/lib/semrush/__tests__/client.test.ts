import { describe, it, expect, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "@/lib/resilience";
import {
  normalizeDomain,
  parseSemrushCsv,
  fetchShopMetrics,
  isRetryableSemrushError,
  SemrushApiError,
  SemrushHttpError,
  SemrushContractError,
} from "../client";

// ── Contract fixtures (shapes from research/semrush-api.md, verified live) ──
const RANK_CSV = "Organic Keywords;Organic Traffic;Organic Cost\n128;437;1268";
const BACKLINKS_CSV = "total;score\n5421;47";
const ORGANIC_CSV = ["Position", "1", "2", "5", "9", "14", "44", "99"].join("\n");

function mockFetch(bodies: Record<string, string | (() => never)>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [marker, body] of Object.entries(bodies)) {
      if (url.includes(marker)) {
        if (typeof body === "function") body();
        return { ok: true, status: 200, text: async () => body } as Response;
      }
    }
    throw new Error(`unexpected url: ${url}`);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const OPTS = { apiKey: "k", retry: { retries: 0, sleep: async () => {} } };

describe("normalizeDomain", () => {
  it("strips scheme, www, path, query", () => {
    expect(normalizeDomain("https://www.tracysbodyshop.com/contact?x=1")).toBe(
      "tracysbodyshop.com"
    );
  });
  it("accepts bare domains", () => {
    expect(normalizeDomain("Example.COM")).toBe("example.com");
  });
  it("null/empty/garbage -> null", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain("not a url at all")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
  });
});

describe("parseSemrushCsv", () => {
  it("maps rows by the RETURNED header, case-insensitive", () => {
    const records = parseSemrushCsv(RANK_CSV);
    expect(records).toEqual([
      { "organic keywords": "128", "organic traffic": "437", "organic cost": "1268" },
    ]);
  });

  it("throws SemrushApiError on an ERROR body (even though HTTP was 200)", () => {
    expect(() => parseSemrushCsv("ERROR 50 :: NOTHING FOUND")).toThrowError(
      SemrushApiError
    );
    try {
      parseSemrushCsv("ERROR 120 :: WRONG KEY");
    } catch (e) {
      expect((e as SemrushApiError).code).toBe(120);
      expect((e as SemrushApiError).message).toMatch(/WRONG KEY/);
    }
  });

  it("empty / header-only body -> []", () => {
    expect(parseSemrushCsv("")).toEqual([]);
    expect(parseSemrushCsv("total;score")).toEqual([]);
  });
});

describe("redactApiKey", () => {
  it("scrubs key= values from URLs embedded in error text", async () => {
    const { redactApiKey } = await import("../client");
    expect(
      redactApiKey("fetch failed: https://api.semrush.com/?type=x&key=SECRET123&domain=a.com")
    ).toBe("fetch failed: https://api.semrush.com/?type=x&key=[REDACTED]&domain=a.com");
    expect(redactApiKey("no url here")).toBe("no url here");
  });
});

describe("isRetryableSemrushError", () => {
  it("API ERROR lines are permanent; 5xx/429/network are transient", () => {
    expect(isRetryableSemrushError(new SemrushApiError(131, "LIMIT EXCEEDED"))).toBe(false);
    expect(isRetryableSemrushError(new SemrushHttpError(500))).toBe(true);
    expect(isRetryableSemrushError(new SemrushHttpError(429))).toBe(true);
    expect(isRetryableSemrushError(new SemrushHttpError(403))).toBe(false);
    expect(isRetryableSemrushError(new TypeError("fetch failed"))).toBe(true);
  });
});

describe("fetchShopMetrics", () => {
  it("assembles SemrushMetrics from the 3 contract calls (parse-by-header)", async () => {
    const { impl, calls } = mockFetch({
      domain_rank: RANK_CSV,
      backlinks_overview: BACKLINKS_CSV,
      domain_organic: ORGANIC_CSV,
    });
    const metrics = await fetchShopMetrics("tracysbodyshop.com", { ...OPTS, fetchImpl: impl });

    expect(metrics).toEqual({
      organic_keywords: 128,
      organic_traffic: 437,
      organic_traffic_cost: 1268,
      backlinks: 5421,
      authority_score: 47,
      position_distribution: { top3: 2, top10: 2, top20: 1, top100: 2 },
    });

    // Bug-trap #1: Authority Score requested as `score`, never `ascore`.
    const backlinksUrl = calls.find((u) => u.includes("backlinks_overview"))!;
    expect(backlinksUrl).toContain("export_columns=total,score");
    expect(backlinksUrl).not.toContain("ascore");
    // Cost guard: capped sample.
    const organicUrl = calls.find((u) => u.includes("domain_organic"))!;
    expect(organicUrl).toContain("display_limit=100");
  });

  it("ERROR 50 on domain_organic only -> metrics WITHOUT distribution (no throw)", async () => {
    const { impl } = mockFetch({
      domain_rank: RANK_CSV,
      backlinks_overview: BACKLINKS_CSV,
      domain_organic: "ERROR 50 :: NOTHING FOUND",
    });
    const metrics = await fetchShopMetrics("x.com", { ...OPTS, fetchImpl: impl });
    expect(metrics.position_distribution).toBeUndefined();
    expect(metrics.organic_keywords).toBe(128);
  });

  it("ERROR on domain_rank -> throws (the shop fails, no partial metrics)", async () => {
    const { impl } = mockFetch({ domain_rank: "ERROR 50 :: NOTHING FOUND" });
    await expect(fetchShopMetrics("unknown.com", { ...OPTS, fetchImpl: impl })).rejects.toThrow(
      SemrushApiError
    );
  });

  it("retries transient HTTP failures, then succeeds", async () => {
    let attempts = 0;
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("domain_rank") && attempts++ === 0) {
        return { ok: false, status: 503, text: async () => "" } as Response;
      }
      const body = url.includes("domain_rank")
        ? RANK_CSV
        : url.includes("backlinks_overview")
          ? BACKLINKS_CSV
          : ORGANIC_CSV;
      return { ok: true, status: 200, text: async () => body } as Response;
    }) as unknown as typeof fetch;

    const metrics = await fetchShopMetrics("x.com", {
      apiKey: "k",
      fetchImpl: impl,
      retry: { retries: 2, sleep: async () => {} },
    });
    expect(metrics.organic_traffic).toBe(437);
    expect(attempts).toBe(2); // first call 503, retry succeeded
  });

  it("FAILS LOUD on a header-contract mismatch (renamed columns must never read as 0)", async () => {
    const { impl } = mockFetch({
      domain_rank: "Some Renamed Column;Another\n1;2",
      backlinks_overview: BACKLINKS_CSV,
      domain_organic: ORGANIC_CSV,
    });
    await expect(fetchShopMetrics("x.com", { ...OPTS, fetchImpl: impl })).rejects.toThrow(
      SemrushContractError
    );
  });

  it("FAILS LOUD on an empty-but-200 domain_rank body (no silent zero row)", async () => {
    const { impl } = mockFetch({
      domain_rank: "Organic Keywords;Organic Traffic;Organic Cost", // header only
      backlinks_overview: BACKLINKS_CSV,
      domain_organic: ORGANIC_CSV,
    });
    await expect(fetchShopMetrics("x.com", { ...OPTS, fetchImpl: impl })).rejects.toThrow(
      /empty response/
    );
  });

  it("contract errors are permanent (never retried)", () => {
    expect(isRetryableSemrushError(new SemrushContractError("x"))).toBe(false);
  });

  it("breaker opens after threshold and fails fast with CircuitOpenError", async () => {
    const failing = vi.fn(async () => {
      return { ok: false, status: 500, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
      isFailure: isRetryableSemrushError,
    });
    const opts = { apiKey: "k", fetchImpl: failing, breaker, retry: { retries: 0, sleep: async () => {} } };

    await expect(fetchShopMetrics("x.com", opts)).rejects.toThrow(SemrushHttpError);
    await expect(fetchShopMetrics("x.com", opts)).rejects.toThrow(CircuitOpenError);
  });
});
