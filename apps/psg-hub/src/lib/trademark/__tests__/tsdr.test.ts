import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "@/lib/resilience";
import {
  buildTsdrStatusUrl,
  fetchTsdrStatus,
  isRetryableTsdrError,
  normalizeTsdrCaseId,
  resolveTsdrConfig,
  TsdrConfigError,
  TsdrHttpError,
  tsdrConfigured,
  type TsdrFetch,
} from "@/lib/trademark/tsdr";

function freshBreaker() {
  return new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    isFailure: isRetryableTsdrError,
  });
}

describe("USPTO TSDR trademark status client", () => {
  it("resolves the registered TSDR key from the dedicated env var first", () => {
    const env = {
      USPTO_TSDR_API_KEY: " tsdr-key ",
      USPTO_API_KEY: "generic-key",
    } as NodeJS.ProcessEnv;

    expect(resolveTsdrConfig(env)).toEqual({
      apiKey: "tsdr-key",
      keySource: "USPTO_TSDR_API_KEY",
    });
    expect(tsdrConfigured(env)).toBe(true);
  });

  it("keeps USPTO_API_KEY as a backward-compatible alias", () => {
    const env = { USPTO_API_KEY: "generic-key" } as NodeJS.ProcessEnv;

    expect(resolveTsdrConfig(env)).toEqual({
      apiKey: "generic-key",
      keySource: "USPTO_API_KEY",
    });
  });

  it("normalizes serial and registration case ids", () => {
    expect(normalizeTsdrCaseId("SN 78787878")).toBe("sn78787878");
    expect(normalizeTsdrCaseId("rn-1234567")).toBe("rn1234567");
    expect(normalizeTsdrCaseId("78787878")).toBe("sn78787878");
    expect(normalizeTsdrCaseId({ type: "rn", value: "7654321" })).toBe(
      "rn7654321"
    );
  });

  it("builds the official TSDR status JSON endpoint", () => {
    expect(buildTsdrStatusUrl("sn78787878")).toBe(
      "https://tsdrapi.uspto.gov/ts/cd/casestatus/sn78787878/info.json"
    );
  });

  it("sends the USPTO-API-KEY header and returns the JSON body", async () => {
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl: TsdrFetch = async (url, init) => {
      capturedUrl = url;
      capturedHeaders = init.headers;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ status: "ok" }),
      };
    };

    const out = await fetchTsdrStatus("sn78787878", {
      apiKey: "registered-key",
      fetchImpl,
      breaker: freshBreaker(),
      retry: { retries: 0 },
    });

    expect(capturedUrl).toContain("/casestatus/sn78787878/info.json");
    expect(capturedHeaders).toMatchObject({
      Accept: "application/json",
      "USPTO-API-KEY": "registered-key",
    });
    expect(out).toEqual({ status: "ok" });
  });

  it("fails closed when no key is configured", async () => {
    const priorTsdr = process.env.USPTO_TSDR_API_KEY;
    const priorGeneric = process.env.USPTO_API_KEY;
    try {
      delete process.env.USPTO_TSDR_API_KEY;
      delete process.env.USPTO_API_KEY;

      await expect(
        fetchTsdrStatus("sn78787878", {
          fetchImpl: vi.fn(),
          breaker: freshBreaker(),
          retry: { retries: 0 },
        })
      ).rejects.toThrow(TsdrConfigError);
    } finally {
      if (priorTsdr === undefined) delete process.env.USPTO_TSDR_API_KEY;
      else process.env.USPTO_TSDR_API_KEY = priorTsdr;
      if (priorGeneric === undefined) delete process.env.USPTO_API_KEY;
      else process.env.USPTO_API_KEY = priorGeneric;
    }
  });

  it("does not retry permanent 401 auth failures", async () => {
    const fetchImpl = vi.fn<TsdrFetch>().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "missing key",
      json: async () => ({}),
    });

    await expect(
      fetchTsdrStatus("sn78787878", {
        apiKey: "bad-key",
        fetchImpl,
        breaker: freshBreaker(),
        retry: { retries: 3, baseDelayMs: 1, sleep: async () => {} },
      })
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transient USPTO outages", async () => {
    const fetchImpl = vi
      .fn<TsdrFetch>()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "temporary outage",
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({ ok: true }),
      });

    await expect(
      fetchTsdrStatus("sn78787878", {
        apiKey: "registered-key",
        fetchImpl,
        breaker: freshBreaker(),
        retry: { retries: 3, baseDelayMs: 1, sleep: async () => {} },
      })
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("classifies retryable TSDR errors by HTTP status", () => {
    expect(isRetryableTsdrError(new TsdrHttpError(401, "bad auth"))).toBe(false);
    expect(isRetryableTsdrError(new TsdrHttpError(429, "rate limited"))).toBe(
      true
    );
    expect(isRetryableTsdrError(new TsdrHttpError(503, "down"))).toBe(true);
  });
});
