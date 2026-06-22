import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerateResult, Provider } from "../../types";

// Mirror research.test.ts: mock the two server-only seams (gateway + the intel server module)
// so the REAL router/assembler/renderer run against an injected fake `generate` and a
// test-controlled provider allowlist. The Supabase client is injected directly into
// runCompetitorReport, so the DB reads are faked per-table below.
vi.mock("../../gateway", () => ({ gatewayGenerate: vi.fn() }));
vi.mock("../../server", () => ({
  resolveEnabledProviders: vi.fn((): readonly Provider[] => ["anthropic"]),
  makeRouterLogger: () => () => {},
}));

import { runCompetitorReport } from "../run";
import { gatewayGenerate } from "../../gateway";
import { resolveEnabledProviders } from "../../server";
import { resetBreakers } from "../../router";

const mockGenerate = vi.mocked(gatewayGenerate);
const mockEnabled = vi.mocked(resolveEnabledProviders);

function gen(output: unknown): GenerateResult {
  return { output, usage: { inputTokens: 100, outputTokens: 20 } };
}

// One output object that satisfies BOTH the research schema (signals/sources) and the writer
// schema (summary/keyMoves); zod strips the extra keys, so a single mock serves both router calls.
const GROUNDED_OUTPUT = {
  signals: ["Caliber opened a new downtown location in Q1."],
  sources: ["https://example.com/caliber-downtown"],
  summary: "Two rivals dominate, one consolidator-owned. Defend on speed and proximity.",
  keyMoves: ["Lean into rapid-estimate messaging", "Target the consolidator's review gaps"],
};

const COMPETITOR_ROWS = [
  {
    id: "c1",
    shop_id: "shop-1",
    name: "Caliber Collision Downtown",
    type: "consolidator",
    consolidator_group: "Caliber Collision",
    latitude: 33.4,
    longitude: -112.0,
    distance_miles: 2.1,
    rating: 4.3,
    review_count: 420,
    website: "https://caliber.example",
    source: "manual",
  },
  {
    id: "c2",
    shop_id: "shop-1",
    name: "Joe's Body Shop",
    type: "independent",
    consolidator_group: null,
    latitude: 33.5,
    longitude: -112.1,
    distance_miles: 4.8,
    rating: 4.6,
    review_count: 90,
    website: null,
    source: "manual",
  },
];

const SCORE_ROWS = [
  {
    competitor_id: "c1",
    shop_id: "shop-1",
    threat_score: 82,
    proximity_score: 0.8,
    presence_score: 0.7,
    consolidator_weight: 1.35,
    rank: 1,
    rationale: "Consolidator-owned, close, high review volume.",
  },
  {
    competitor_id: "c2",
    shop_id: "shop-1",
    threat_score: 55,
    proximity_score: 0.5,
    presence_score: 0.4,
    consolidator_weight: 1,
    rank: 2,
    rationale: "Independent, farther out, fewer reviews.",
  },
];

/** Per-table fake Supabase client: chainable builders that resolve to the configured rows. */
function makeService(rowsByTable: Record<string, unknown[]>): SupabaseClient {
  return {
    from(table: string) {
      const result = { data: rowsByTable[table] ?? [], error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "ilike"]) {
        builder[m] = () => builder;
      }
      (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  resetBreakers();
  mockGenerate.mockReset();
  mockEnabled.mockReturnValue(["anthropic"]);
});

describe("runCompetitorReport", () => {
  it("returns a grounded report + HTML with the threat table from injected rows", async () => {
    mockGenerate.mockResolvedValue(gen(GROUNDED_OUTPUT));
    const service = makeService({
      competitors: COMPETITOR_ROWS,
      competitor_scores: SCORE_ROWS,
      llm_call_log: [],
    });

    const { report, html } = await runCompetitorReport({
      service,
      shopId: "shop-1",
      now: "2026-06-22T00:00:00.000Z",
    });

    expect(report.summary.totalCompetitors).toBe(2);
    expect(report.rankedCompetitors[0].competitorId).toBe("c1");
    expect(report.narrative.status).toBe("grounded");
    // threat table rendered
    expect(html).toContain("Threat ranking");
    expect(html).toContain("Caliber Collision Downtown");
    expect(html).toContain("Joe's Body Shop");
    // grounded executive summary rendered
    expect(html).toContain("Defend on speed and proximity");
  });

  it("degrades to the pending-activation notice when research + narrate both return null", async () => {
    // No enabled provider → the router throws for both seams → both degrade to null.
    mockEnabled.mockReturnValue([]);
    const service = makeService({
      competitors: COMPETITOR_ROWS,
      competitor_scores: SCORE_ROWS,
      llm_call_log: [],
    });

    const { report, html } = await runCompetitorReport({ service, shopId: "shop-1" });

    expect(report.narrative.status).toBe("pending_activation");
    expect(mockGenerate).not.toHaveBeenCalled();
    // deterministic threat table still renders
    expect(html).toContain("Threat ranking");
    expect(html).toContain("Caliber Collision Downtown");
  });

  it("skips all metered calls and reports zero competitors when the shop has no scores", async () => {
    const service = makeService({
      competitors: COMPETITOR_ROWS,
      competitor_scores: [],
      llm_call_log: [],
    });

    const { report } = await runCompetitorReport({ service, shopId: "shop-1" });

    expect(report.summary.totalCompetitors).toBe(0);
    expect(report.narrative.status).toBe("pending_activation");
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
