import { describe, it, expect } from "vitest";
import { generateNarrative, renderTemplateNarrative } from "../generate";
import { evaluateReport } from "../evaluate";
import type { GenerateFn } from "../narrative";
import type { ReportData } from "../types";
import type { ReportNarrative } from "../schema";

function reportData(): ReportData {
  return {
    shopId: "shop-1",
    periodMonth: "2026-06",
    window: { start: "2026-06-01", end: "2026-06-30" },
    sources: {
      ga4: { source: "ga4", current: { sessions: 1500 }, prior: { sessions: 1250 }, momDelta: { sessions: 0.2 }, trend: {} },
      gsc: { source: "gsc", current: { clicks: 4, impressions: 372 }, prior: { clicks: 5, impressions: 300 }, momDelta: { clicks: -0.2, impressions: 0.24 }, trend: {} },
    },
    linkedSources: ["ga4", "gsc"],
    sourcesWithPriorMonth: ["ga4", "gsc"],
    generatedAt: "2026-07-01T00:00:00Z",
  };
}

/** Writer output uses {{placeholders}} (the orchestrator substitutes). This is clean. */
const goodRaw: ReportNarrative = {
  headline: "Traffic and search update.",
  executiveSummary: "Sessions reached {{ga4_sessions}}, {{ga4_sessions_mom}} versus last month.",
  sourceSummaries: {
    ga4: "Sessions were {{ga4_sessions}} ({{ga4_sessions_mom}}).",
    gsc: "Clicks were {{gsc_clicks}} and impressions {{gsc_impressions}}.",
  },
  recommendations: ["Keep investing in the channels driving {{ga4_sessions}} sessions."],
};

/** Writer that hallucinates a literal number (survives substitution -> F1). */
const badRaw: ReportNarrative = {
  ...goodRaw,
  executiveSummary: "Website sessions reached 1,800 this month.",
};

const usage = { inputTokens: 1, outputTokens: 1 };
const mockGen = (sequence: ReportNarrative[]): GenerateFn => {
  let i = 0;
  return async () => ({ output: sequence[Math.min(i++, sequence.length - 1)], usage });
};

describe("generateNarrative", () => {
  it("returns a model narrative when the first draft passes", async () => {
    const out = await generateNarrative(reportData(), { generate: mockGen([goodRaw]) });
    expect(out.verdict).toBe("pass");
    expect(out.source).toBe("model");
    expect(out.narrative?.executiveSummary).toContain("1,500"); // substituted, not a placeholder
    expect(out.narrative?.executiveSummary).not.toContain("{{");
  });

  it("regenerates with violations and passes on a later attempt", async () => {
    // bad, bad, then good -> passes on the 3rd attempt (maxRetries 2).
    const out = await generateNarrative(reportData(), { generate: mockGen([badRaw, badRaw, goodRaw]) });
    expect(out.verdict).toBe("pass");
    expect(out.source).toBe("model");
  });

  it("falls back to the deterministic template when the model never passes", async () => {
    const out = await generateNarrative(reportData(), { generate: mockGen([badRaw]) }); // always bad
    expect(out.verdict).toBe("pass");
    expect(out.source).toBe("template");
    // The template itself must clear the real eval gate.
    expect(evaluateReport(out.narrative!, reportData()).verdict).toBe("pass");
  });

  it("falls back to the deterministic template when the writer provider is unavailable", async () => {
    const out = await generateNarrative(reportData(), {
      generate: async () => {
        throw new Error("Bring Your Own Key (BYOK) is available only with paid credits");
      },
    });

    expect(out.verdict).toBe("pass");
    expect(out.source).toBe("template");
    expect(out.violations[0]).toMatchObject({
      code: "schema",
      detail: expect.stringContaining("writer unavailable"),
    });
    expect(evaluateReport(out.narrative!, reportData()).verdict).toBe("pass");
  });

  it("holds for human when there are no linked sources", async () => {
    const empty: ReportData = {
      ...reportData(),
      sources: {},
      linkedSources: [],
      sourcesWithPriorMonth: [],
    };
    const out = await generateNarrative(empty, { generate: mockGen([goodRaw]) });
    expect(out.verdict).toBe("hold");
    expect(out.source).toBe("hold");
    expect(out.narrative).toBeNull();
  });

  it("renderTemplateNarrative passes the eval gate by construction", () => {
    const template = renderTemplateNarrative(reportData());
    expect(evaluateReport(template, reportData()).verdict).toBe("pass");
  });
});
