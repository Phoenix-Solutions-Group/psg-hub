import { describe, it, expect } from "vitest";
import {
  rateFor,
  estimateCallCostUsd,
  totalSpendUsd,
  applySpendCap,
  SpendCapExceededError,
  MODEL_COST_RATES,
} from "../budget";
import type { ModelSpec } from "../types";

describe("rateFor", () => {
  it("returns the published rate for a known model", () => {
    expect(rateFor("anthropic/claude-sonnet-4.6")).toEqual(
      MODEL_COST_RATES["anthropic/claude-sonnet-4.6"],
    );
  });

  it("falls back to the most-expensive rate for an unknown/renamed slug", () => {
    // Conservative: an unrecognised model must never UNDER-count spend.
    expect(rateFor("openai/gpt-9-mystery")).toEqual({ inputPerMTok: 15, outputPerMTok: 75 });
    expect(rateFor(null)).toEqual({ inputPerMTok: 15, outputPerMTok: 75 });
  });
});

describe("estimateCallCostUsd", () => {
  it("prices input + output tokens at the model's per-MTok rate", () => {
    // sonnet: $3/MTok in, $15/MTok out. 1M in + 1M out => $18.
    expect(estimateCallCostUsd("anthropic/claude-sonnet-4.6", 1_000_000, 1_000_000)).toBeCloseTo(
      18,
      6,
    );
  });

  it("treats null/undefined token counts as zero", () => {
    expect(estimateCallCostUsd("anthropic/claude-opus-4.8", null, null)).toBe(0);
    expect(estimateCallCostUsd("anthropic/claude-opus-4.8", 1_000_000, undefined)).toBeCloseTo(
      15,
      6,
    );
  });

  it("prices an unknown model at the conservative fallback rate", () => {
    // fallback $15 in: 500k in => $7.50.
    expect(estimateCallCostUsd("who/knows", 500_000, 0)).toBeCloseTo(7.5, 6);
  });
});

describe("totalSpendUsd", () => {
  it("sums estimated cost across logged rows, tolerating nulls", () => {
    const rows = [
      { modelId: "anthropic/claude-haiku-4.5", inputTokens: 1_000_000, outputTokens: 0 }, // $1
      { modelId: "openai/gpt-5.1", inputTokens: 0, outputTokens: 1_000_000 }, // $30
      { modelId: null, inputTokens: null, outputTokens: null }, // $0
    ];
    expect(totalSpendUsd(rows)).toBeCloseTo(31, 6);
  });

  it("is zero for an empty log", () => {
    expect(totalSpendUsd([])).toBe(0);
  });
});

describe("applySpendCap", () => {
  const reasoning: ModelSpec[] = [
    { provider: "openai", model: "openai/gpt-5.1", costTier: 4 },
    { provider: "google", model: "google/gemini-3-pro", costTier: 3 },
    { provider: "anthropic", model: "anthropic/claude-sonnet-4.6", costTier: 2 },
  ];

  it("returns the full candidate list unchanged while under the cap", () => {
    expect(applySpendCap(reasoning, 50, 200, "reasoning")).toEqual(reasoning);
  });

  it("narrows to the in-budget Anthropic path at/over the cap", () => {
    const out = applySpendCap(reasoning, 200, 200, "reasoning");
    expect(out.map((m) => m.provider)).toEqual(["anthropic"]);
  });

  it("throws SpendCapExceededError when the profile has no in-budget fallback", () => {
    const meteredOnly: ModelSpec[] = [
      { provider: "perplexity", model: "perplexity/sonar-pro", costTier: 3, grounded: true },
      { provider: "google", model: "google/gemini-3-pro", costTier: 3, grounded: true },
    ];
    expect(() => applySpendCap(meteredOnly, 250, 200, "web_grounded")).toThrow(
      SpendCapExceededError,
    );
  });
});
