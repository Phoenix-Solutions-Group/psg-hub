import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contentBriefSchema as synthesizedBriefSchema } from "@/lib/agent-engine";
import {
  toPersistedBrief,
  parseContentBrief,
  writeContentBrief,
  fetchMarketResearchBrief,
} from "@/lib/bsm/content-briefs";

const SHOP = "11111111-1111-1111-1111-111111111111";

// A valid Market Researcher synthesis output (the rich agent-engine ContentBrief
// the writer consumes). Built + schema-validated directly rather than calling
// `synthesizeContentBrief` so these unit tests don't depend on PSG-156's impl
// being landed — the live `synthesizeContentBrief → writeContentBrief` wiring is
// Ada's integration on PSG-153 / the cross-module E2E. `targetKeywords` carry the
// full KeywordTarget objects (top priority first); the writer flattens to phrases.
function synthesize() {
  return synthesizedBriefSchema.parse({
    id: "brief_1",
    shopId: SHOP,
    topic: 'Content targeting "collision repair lincoln ne"',
    targetKeywords: [
      { keyword: "collision repair lincoln ne", intent: "local", priority: 90 },
      { keyword: "bumper repair cost", intent: "service", priority: 60 },
    ],
    competitorGap: "Publish a local collision-repair guide",
    audiencePersona:
      "Local driver searching for a nearby, trustworthy collision shop",
    priorityScore: 81,
    status: "draft",
    sources: { auditReportId: "audit_1", sentimentReportIds: ["sent_1"] },
    createdAt: "2026-06-20T12:00:00.000Z",
  });
}

describe("toPersistedBrief", () => {
  it("flattens the agent-engine synthesis output into the persisted DTO", () => {
    const dto = toPersistedBrief(synthesize());
    expect(dto.id).toBe("brief_1");
    expect(dto.shop_id).toBe(SHOP);
    // Keyword targets survive the handoff as bare phrases (top priority first).
    expect(dto.target_keywords).toContain("collision repair lincoln ne");
    expect(dto.competitor_gap).toBe("Publish a local collision-repair guide");
    expect(dto.priority_score).toBeGreaterThan(0);
    expect(dto.status).toBe("draft");
    expect(dto.created_at).toBe("2026-06-20T12:00:00.000Z");
  });

  it("maps non-draft synthesis statuses to 'active'", () => {
    const brief = { ...synthesize(), status: "published" as const };
    expect(toPersistedBrief(brief).status).toBe("active");
  });
});

describe("parseContentBrief", () => {
  it("validates and returns a well-formed payload", () => {
    const dto = toPersistedBrief(synthesize());
    expect(parseContentBrief(dto)).toEqual(dto);
  });

  it("throws on a malformed payload (missing shop_id)", () => {
    const bad = { ...toPersistedBrief(synthesize()), shop_id: "" };
    expect(() => parseContentBrief(bad)).toThrow();
  });
});

describe("writeContentBrief", () => {
  it("persists a content_brief artifact row from synthesis output (AC#1)", async () => {
    let inserted: Record<string, unknown> | null = null;
    const client = {
      from: (table: string) => {
        expect(table).toBe("research_artifacts");
        return {
          insert: (row: Record<string, unknown>) => {
            inserted = row;
            return { error: null };
          },
        };
      },
    } as unknown as SupabaseClient;

    const dto = await writeContentBrief(client, synthesize(), { campaignId: null });

    expect(inserted).not.toBeNull();
    const row = inserted as unknown as Record<string, unknown>;
    expect(row.artifact_type).toBe("content_brief");
    expect(row.source_skill).toBe("market-researcher");
    expect(row.campaign_id).toBeNull();
    // The stored jsonb is the validated DTO — round-trips through the parser.
    expect(parseContentBrief(row.data)).toEqual(dto);
  });

  it("throws when the insert errors", async () => {
    const client = {
      from: () => ({ insert: () => ({ error: { message: "db down" } }) }),
    } as unknown as SupabaseClient;
    await expect(writeContentBrief(client, synthesize())).rejects.toThrow(/db down/);
  });
});

describe("fetchMarketResearchBrief", () => {
  function loaderClient(result: { data: unknown; error: unknown }) {
    const captured: { eqs: Array<[string, string]> } = { eqs: [] };
    const client = {
      from: (table: string) => {
        expect(table).toBe("research_artifacts");
        return {
          select: () => ({
            eq: (col: string, val: string) => {
              captured.eqs.push([col, val]);
              return {
                eq: (col2: string, val2: string) => {
                  captured.eqs.push([col2, val2]);
                  return {
                    order: () => ({
                      limit: () => ({ maybeSingle: async () => result }),
                    }),
                  };
                },
              };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;
    return { client, captured };
  }

  it("returns the newest brief for the shop, scoped by type + shop_id", async () => {
    const dto = toPersistedBrief(synthesize());
    const { client, captured } = loaderClient({ data: { data: dto }, error: null });

    const brief = await fetchMarketResearchBrief(client, SHOP);

    expect(brief).toEqual(dto);
    expect(captured.eqs).toContainEqual(["artifact_type", "content_brief"]);
    expect(captured.eqs).toContainEqual(["data->>shop_id", SHOP]);
  });

  it("returns null when the shop has no brief", async () => {
    const { client } = loaderClient({ data: null, error: null });
    expect(await fetchMarketResearchBrief(client, SHOP)).toBeNull();
  });

  it("throws when the query errors", async () => {
    const { client } = loaderClient({ data: null, error: { message: "boom" } });
    await expect(fetchMarketResearchBrief(client, SHOP)).rejects.toThrow(/boom/);
  });
});
