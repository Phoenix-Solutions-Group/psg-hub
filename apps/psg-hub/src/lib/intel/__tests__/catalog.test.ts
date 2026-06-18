import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG,
  DEFAULT_ENABLED_PROVIDERS,
  ALL_PROVIDERS,
} from "../catalog";
import { G5_GATED_PROVIDERS, type TaskProfile } from "../types";
import { resolveEnabledProviders } from "../server";

const PROFILES = Object.keys(MODEL_CATALOG) as TaskProfile[];

describe("MODEL_CATALOG", () => {
  it("every profile has at least one Anthropic candidate so build-local always has an in-budget path", () => {
    for (const profile of PROFILES) {
      const hasAnthropic = MODEL_CATALOG[profile].some((m) => m.provider === "anthropic");
      expect(hasAnthropic, `profile ${profile} needs an Anthropic fallback`).toBe(true);
    }
  });

  it("uses dot-notation gateway slugs (provider/model)", () => {
    for (const profile of PROFILES) {
      for (const spec of MODEL_CATALOG[profile]) {
        expect(spec.model).toMatch(/^[a-z]+\/[a-z0-9.\-]+$/);
      }
    }
  });
});

describe("provider gating (G5 posture)", () => {
  it("defaults to Anthropic-only — every other provider is behind G5", () => {
    expect(DEFAULT_ENABLED_PROVIDERS).toEqual(["anthropic"]);
    for (const p of ALL_PROVIDERS) {
      if (p !== "anthropic") expect(G5_GATED_PROVIDERS).toContain(p);
    }
  });

  it("resolveEnabledProviders falls back to Anthropic-only when env is unset/empty", () => {
    expect(resolveEnabledProviders(undefined)).toEqual(["anthropic"]);
    expect(resolveEnabledProviders("")).toEqual(["anthropic"]);
    expect(resolveEnabledProviders("   ")).toEqual(["anthropic"]);
  });

  it("resolveEnabledProviders parses a comma list, always keeps Anthropic, drops unknowns", () => {
    const out = resolveEnabledProviders("openai, perplexity, bogus");
    expect(out).toContain("anthropic");
    expect(out).toContain("openai");
    expect(out).toContain("perplexity");
    expect(out).not.toContain("bogus");
  });
});
