import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  route,
  usableCandidates,
  resetBreakers,
  NoEnabledProviderError,
  AllCandidatesFailedError,
} from "../router";
import type { GenerateResult, Provider } from "../types";

const ANTHROPIC_ONLY: readonly Provider[] = ["anthropic"];

function ok(output: unknown = { ok: true }): GenerateResult {
  return { output, usage: { inputTokens: 100, outputTokens: 20 } };
}

beforeEach(() => resetBreakers());

describe("usableCandidates", () => {
  it("filters the catalog chain to enabled providers, preserving capability order", () => {
    const out = usableCandidates("reasoning", ["anthropic", "google"]);
    expect(out.map((m) => m.provider)).toEqual(["anthropic", "google", "anthropic"]);
  });

  it("preferCheapest reorders usable candidates by cost tier ascending", () => {
    const out = usableCandidates("reasoning", ["anthropic", "google"], true);
    expect(out.map((m) => m.costTier)).toEqual([2, 3, 4]);
  });

  it("throws NoEnabledProviderError when no candidate's provider is enabled", () => {
    // web_grounded's top candidates are perplexity/google (both G5-gated, here disabled)…
    expect(() => usableCandidates("web_grounded", [] as Provider[])).toThrow(
      NoEnabledProviderError,
    );
  });
});

describe("route", () => {
  it("dispatches to the first enabled candidate and returns output + a success attempt", async () => {
    const generate = vi.fn().mockResolvedValue(ok({ score: 7 }));
    const res = await route("reasoning", { system: "s", prompt: "p" }, {
      generate,
      enabledProviders: ANTHROPIC_ONLY,
    });

    expect(res.output).toEqual({ score: 7 });
    expect(res.provider).toBe("anthropic");
    expect(res.model).toBe("anthropic/claude-opus-4.8");
    expect(res.attempts).toHaveLength(1);
    expect(res.attempts[0].ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].model).toBe("anthropic/claude-opus-4.8");
  });

  it("forwards a structured-output schema through to the generate adapter", async () => {
    const generate = vi.fn().mockResolvedValue(ok());
    const schema = { _tag: "zod" };
    await route("fast_classify", { system: "s", prompt: "p", schema }, {
      generate,
      enabledProviders: ANTHROPIC_ONLY,
    });
    expect(generate.mock.calls[0][0].schema).toBe(schema);
  });

  it("G5 gate: with only Anthropic enabled, web_grounded skips Perplexity/Gemini and lands on the Anthropic fallback", async () => {
    const generate = vi.fn().mockResolvedValue(ok());
    const res = await route("web_grounded", { system: "s", prompt: "p" }, {
      generate,
      enabledProviders: ANTHROPIC_ONLY,
    });
    expect(res.provider).toBe("anthropic");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("falls through to the next enabled candidate when the first fails (cross-provider fallback)", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom")) // opus fails (after retries)
      .mockResolvedValueOnce(ok({ recovered: true })); // sonnet succeeds
    const res = await route(
      "reasoning",
      { system: "s", prompt: "p" },
      { generate, enabledProviders: ANTHROPIC_ONLY, retries: 0 },
    );
    expect(res.output).toEqual({ recovered: true });
    expect(res.model).toBe("anthropic/claude-sonnet-4.6");
    expect(res.attempts.map((a) => a.ok)).toEqual([false, true]);
  });

  it("throws AllCandidatesFailedError with the full attempt trail when every candidate fails", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("rate limit exceeded"));
    await expect(
      route("reasoning", { system: "s", prompt: "p" }, {
        generate,
        enabledProviders: ANTHROPIC_ONLY,
        retries: 0,
      }),
    ).rejects.toBeInstanceOf(AllCandidatesFailedError);
  });

  it("logs each attempt with purpose=profile, classified result, and latency", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new Error("request timeout"))
      .mockResolvedValueOnce(ok());
    const logCall = vi.fn();
    let clock = 1000;
    const now = () => (clock += 5);

    await route(
      "reasoning",
      { system: "s", prompt: "p" },
      { generate, logCall, enabledProviders: ANTHROPIC_ONLY, retries: 0, now },
    );

    expect(logCall).toHaveBeenCalledTimes(2);
    expect(logCall.mock.calls[0][0]).toMatchObject({
      purpose: "reasoning",
      result: "timeout",
      errorCode: "timeout",
    });
    expect(logCall.mock.calls[1][0]).toMatchObject({
      purpose: "reasoning",
      modelId: "anthropic/claude-sonnet-4.6",
      result: "success",
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(logCall.mock.calls[1][0].latencyMs).toBeGreaterThan(0);
  });

  it("classifies rate-limit errors so the log sink can distinguish them", async () => {
    const generate = vi.fn().mockRejectedValue(new Error("HTTP 429 rate limit"));
    const logCall = vi.fn();
    await expect(
      route("fast_classify", { system: "s", prompt: "p" }, {
        generate,
        logCall,
        enabledProviders: ANTHROPIC_ONLY,
        retries: 0,
      }),
    ).rejects.toBeInstanceOf(AllCandidatesFailedError);
    expect(logCall.mock.calls[0][0].result).toBe("rate_limited");
  });
});
