import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  syncCompetitorScores,
  rowToCompetitor,
  scoreToRow,
  MODEL_VERSION,
} from "../sync";
import type { CompetitorScore } from "../types";

type Tables = {
  shops: { data: unknown[]; error?: { message: string } | null };
  competitors: Record<string, { data: unknown[]; error?: { message: string } | null }>;
};

/** Minimal Supabase fake: shops.select(), competitors.select().eq(shop), competitor_scores.upsert(). */
function fakeClient(tables: Tables, upsertSpy: (rows: unknown[], opts: unknown) => unknown) {
  return {
    from(table: string) {
      if (table === "shops") {
        return { select: () => Promise.resolve(tables.shops) };
      }
      if (table === "competitors") {
        return {
          select: () => ({
            eq: (_col: string, shopId: string) =>
              Promise.resolve(tables.competitors[shopId] ?? { data: [], error: null }),
          }),
        };
      }
      if (table === "competitor_scores") {
        return { upsert: (rows: unknown[], opts: unknown) => upsertSpy(rows, opts) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

const SHOP = { id: "shop-1", latitude: 40, longitude: -74, search_radius_miles: 10 };

function compRow(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    shop_id: "shop-1",
    name: "Caliber Collision - Main St",
    type: "consolidator",
    consolidator_group: "Caliber Collision",
    latitude: 40,
    longitude: -74,
    distance_miles: 2,
    rating: 4.5,
    review_count: 200,
    website: null,
    source: "manual",
    ...over,
  };
}

describe("rowToCompetitor", () => {
  it("maps a DB row to the domain model, coercing numerics", () => {
    const c = rowToCompetitor(compRow({ distance_miles: "2.5", rating: "4.2" }) as never);
    expect(c.distanceMiles).toBe(2.5);
    expect(c.rating).toBe(4.2);
    expect(c.type).toBe("consolidator");
  });

  it("defaults type/source when null", () => {
    const c = rowToCompetitor(compRow({ type: null, source: null }) as never);
    expect(c.type).toBe("independent");
    expect(c.source).toBe("manual");
  });
});

describe("scoreToRow", () => {
  it("stamps model_version + scored_at and flattens the score", () => {
    const score: CompetitorScore = {
      competitorId: "c1",
      shopId: "shop-1",
      threatScore: 80,
      proximityScore: 0.8,
      presenceScore: 0.6,
      consolidatorWeight: 1.35,
      rank: 1,
      rationale: "top threat",
    };
    const row = scoreToRow(score, "2026-06-18T00:00:00.000Z");
    expect(row).toMatchObject({
      competitor_id: "c1",
      shop_id: "shop-1",
      threat_score: 80,
      rank: 1,
      model_version: MODEL_VERSION,
      scored_at: "2026-06-18T00:00:00.000Z",
    });
  });
});

describe("syncCompetitorScores", () => {
  it("scores a shop's competitors and upserts onConflict(competitor_id)", async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    const client = fakeClient(
      {
        shops: { data: [SHOP], error: null },
        competitors: { "shop-1": { data: [compRow()], error: null } },
      },
      upsertSpy,
    );

    const result = await syncCompetitorScores(client, { now: "2026-06-18T00:00:00.000Z" });

    expect(result).toEqual({ shopsProcessed: 1, competitorsScored: 1, failed: 0 });
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [rows, opts] = upsertSpy.mock.calls[0];
    expect(opts).toEqual({ onConflict: "competitor_id" });
    expect(rows[0]).toMatchObject({ competitor_id: "c1", rank: 1 });
  });

  it("skips shops with no competitors without upserting", async () => {
    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    const client = fakeClient(
      { shops: { data: [SHOP], error: null }, competitors: {} },
      upsertSpy,
    );
    const result = await syncCompetitorScores(client);
    expect(result).toEqual({ shopsProcessed: 1, competitorsScored: 0, failed: 0 });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("contains a single shop's failure and keeps processing the rest", async () => {
    const upsertSpy = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "boom" } }) // shop-1 upsert fails
      .mockResolvedValueOnce({ error: null }); // shop-2 succeeds
    const client = fakeClient(
      {
        shops: {
          data: [SHOP, { ...SHOP, id: "shop-2" }],
          error: null,
        },
        competitors: {
          "shop-1": { data: [compRow()], error: null },
          "shop-2": { data: [compRow({ id: "c2", shop_id: "shop-2" })], error: null },
        },
      },
      upsertSpy,
    );
    const result = await syncCompetitorScores(client);
    expect(result).toEqual({ shopsProcessed: 1, competitorsScored: 1, failed: 1 });
  });

  it("throws when the shop load itself fails", async () => {
    const client = fakeClient(
      { shops: { data: [], error: { message: "db down" } }, competitors: {} },
      vi.fn(),
    );
    await expect(syncCompetitorScores(client)).rejects.toThrow(/shop load failed/);
  });
});
