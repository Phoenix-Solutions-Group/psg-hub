import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GenerateResult, Provider } from "../../types";
import type { CompetitorReportSummary, RankedCompetitor } from "../types";
import type { NarrativeInput } from "../report-data";

// Mock the two server-only seams research.ts / server.ts pull in, so the REAL router runs
// against an injected fake `generate` and a test-controlled provider allowlist. The router,
// catalog, and budget modules are exercised for real.
vi.mock("../../gateway", () => ({ gatewayGenerate: vi.fn() }));
vi.mock("../../server", () => ({
  resolveEnabledProviders: vi.fn((): readonly Provider[] => ["anthropic"]),
  makeRouterLogger: () => () => {},
}));

import { makeGroundedResearcher } from "../research";
import { makeNarrativeGenerator } from "../server";
import { gatewayGenerate } from "../../gateway";
import { resolveEnabledProviders } from "../../server";
import { resetBreakers } from "../../router";

const mockGenerate = vi.mocked(gatewayGenerate);
const mockEnabled = vi.mocked(resolveEnabledProviders);

function gen(output: unknown): GenerateResult {
  return { output, usage: { inputTokens: 100, outputTokens: 20 } };
}

const SUMMARY: CompetitorReportSummary = {
  totalCompetitors: 2,
  consolidatorCount: 1,
  independentCount: 1,
  consolidatorShare: 0.5,
  topThreatScore: 80,
  averageTopThreat: 65,
  medianDistanceMiles: 3,
  tierCounts: { critical: 1, elevated: 1, moderate: 0, low: 0 },
};

const TOP: RankedCompetitor[] = [
  {
    rank: 1,
    competitorId: "c1",
    name: "Caliber Collision Lincoln",
    type: "consolidator",
    consolidatorGroup: "Caliber",
    distanceMiles: 2,
    rating: 4.5,
    reviewCount: 300,
    threatScore: 80,
    tier: "critical",
    rationale: "national MSO, close, well-rated",
  },
  {
    rank: 2,
    competitorId: "c2",
    name: "Joe's Body Shop",
    type: "independent",
    consolidatorGroup: null,
    distanceMiles: 4,
    rating: 4.2,
    reviewCount: 90,
    threatScore: 50,
    tier: "elevated",
    rationale: "independent, moderate distance",
  },
];

const INPUT: NarrativeInput = { shopId: "shop-1", summary: SUMMARY, topCompetitors: TOP };

const RESEARCH_OUT = { signals: ["Caliber opened a 3rd location", "Joe's added OEM cert"], sources: ["https://example.com/a"] };
const NARRATIVE_OUT = { summary: "Caliber is the dominant threat.", keyMoves: ["Push OEM certifications"] };

beforeEach(() => {
  resetBreakers();
  mockGenerate.mockReset();
  mockEnabled.mockReset();
  mockEnabled.mockReturnValue(["anthropic"]);
});

describe("makeGroundedResearcher", () => {
  it("dispatches a non-Anthropic (perplexity) grounded candidate when it is enabled", async () => {
    mockEnabled.mockReturnValue(["anthropic", "perplexity"]);
    mockGenerate.mockResolvedValue(gen(RESEARCH_OUT));

    const out = await makeGroundedResearcher({ shopId: "shop-1" })(INPUT);

    expect(out).toEqual({
      signals: RESEARCH_OUT.signals,
      sources: RESEARCH_OUT.sources,
      provider: "perplexity",
      model: "perplexity/sonar-pro",
    });
    expect(mockGenerate.mock.calls[0][0].model).toBe("perplexity/sonar-pro");
  });

  it("grounds the prompt on competitor names only (no PII / internal fields)", async () => {
    mockEnabled.mockReturnValue(["anthropic", "perplexity"]);
    mockGenerate.mockResolvedValue(gen(RESEARCH_OUT));

    await makeGroundedResearcher({ shopId: "shop-1" })(INPUT);

    const prompt = mockGenerate.mock.calls[0][0].prompt;
    expect(prompt).toContain("Caliber Collision Lincoln");
    expect(prompt).toContain("Joe's Body Shop");
    // No derived/internal numbers leak into the metered query.
    expect(prompt).not.toContain("threat");
    expect(prompt).not.toContain("4.5");
  });

  it("falls to the Anthropic SONNET tail when metered providers are gated", async () => {
    mockEnabled.mockReturnValue(["anthropic"]);
    mockGenerate.mockResolvedValue(gen(RESEARCH_OUT));

    const out = await makeGroundedResearcher({ shopId: "shop-1" })(INPUT);

    expect(out?.provider).toBe("anthropic");
    expect(out?.model).toBe("anthropic/claude-sonnet-4.6");
    expect(mockGenerate.mock.calls[0][0].model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("returns null when the route throws (no enabled provider for the profile)", async () => {
    // openai is not in the web_grounded chain → usableCandidates throws NoEnabledProviderError.
    mockEnabled.mockReturnValue(["openai"]);
    const out = await makeGroundedResearcher({ shopId: "shop-1" })(INPUT);
    expect(out).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe("spend-cap wiring", () => {
  it("researcher: over the cap, narrows the grounded route to the in-budget Anthropic path", async () => {
    mockEnabled.mockReturnValue(["anthropic", "perplexity"]);
    mockGenerate.mockResolvedValue(gen(RESEARCH_OUT));
    const mtd = vi.fn(async () => 250); // over the $200 cap

    const out = await makeGroundedResearcher({
      shopId: "shop-1",
      spendCapUsd: 200,
      monthToDateSpendUsd: mtd,
    })(INPUT);

    expect(mtd).toHaveBeenCalledTimes(1);
    expect(out?.provider).toBe("anthropic");
    expect(mockGenerate.mock.calls[0][0].model).toBe("anthropic/claude-sonnet-4.6");
  });

  it("researcher: SpendCapExceededError (metered-only profile) propagates to the null degrade", async () => {
    // Only perplexity enabled → over cap, applySpendCap finds no in-budget fallback → throws.
    mockEnabled.mockReturnValue(["perplexity"]);
    mockGenerate.mockResolvedValue(gen(RESEARCH_OUT));
    const mtd = vi.fn(async () => 250);

    const out = await makeGroundedResearcher({
      shopId: "shop-1",
      spendCapUsd: 200,
      monthToDateSpendUsd: mtd,
    })(INPUT);

    expect(out).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("writer: the cap is live — makeNarrativeGenerator threads it into the writer route", async () => {
    mockEnabled.mockReturnValue(["anthropic", "perplexity"]);
    mockGenerate.mockResolvedValue(gen(NARRATIVE_OUT));
    const mtd = vi.fn(async () => 250); // over cap

    const out = await makeNarrativeGenerator({
      shopId: "shop-1",
      spendCapUsd: 200,
      monthToDateSpendUsd: mtd,
    })(INPUT);

    // The writer route consulted the live spend reader and stayed on the in-budget path.
    expect(mtd).toHaveBeenCalledTimes(1);
    expect(out?.provider).toBe("anthropic");
  });
});

describe("makeNarrativeGenerator researchNotes", () => {
  it("appends a grounded market-signals block to the writer prompt when notes are supplied", async () => {
    mockGenerate.mockResolvedValue(gen(NARRATIVE_OUT));

    await makeNarrativeGenerator({
      shopId: "shop-1",
      researchNotes: ["Caliber opened a 3rd location", "Joe's added OEM cert"],
    })(INPUT);

    const prompt = mockGenerate.mock.calls[0][0].prompt;
    expect(prompt).toContain("Recent market signals (grounded):");
    expect(prompt).toContain("- Caliber opened a 3rd location");
    expect(prompt).toContain("- Joe's added OEM cert");
  });

  it("leaves the writer prompt unchanged when no notes are supplied", async () => {
    mockGenerate.mockResolvedValue(gen(NARRATIVE_OUT));

    await makeNarrativeGenerator({ shopId: "shop-1" })(INPUT);

    expect(mockGenerate.mock.calls[0][0].prompt).not.toContain("Recent market signals (grounded):");
  });
});
