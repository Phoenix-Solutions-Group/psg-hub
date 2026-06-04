import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertSnapshots, getSnapshots } from "../snapshots";
import type { AnalyticsSnapshotInsert } from "../types";

/** Minimal chainable supabase client mock. */
function makeClient(opts: {
  upsertResult?: { error: { message: string } | null };
  selectResult?: { data: unknown[] | null; error: { message: string } | null };
}) {
  const calls = {
    from: [] as string[],
    upsert: [] as [unknown, unknown][],
    eq: [] as [string, unknown][],
    gte: [] as [string, unknown][],
    lte: [] as [string, unknown][],
    order: [] as [string, unknown][],
  };

  const selectBuilder: Record<string, unknown> = {
    eq: vi.fn((c: string, v: unknown) => {
      calls.eq.push([c, v]);
      return selectBuilder;
    }),
    gte: vi.fn((c: string, v: unknown) => {
      calls.gte.push([c, v]);
      return selectBuilder;
    }),
    lte: vi.fn((c: string, v: unknown) => {
      calls.lte.push([c, v]);
      return selectBuilder;
    }),
    order: vi.fn((c: string, o: unknown) => {
      calls.order.push([c, o]);
      return Promise.resolve(opts.selectResult ?? { data: [], error: null });
    }),
  };

  const fromObj = {
    upsert: vi.fn((rows: unknown, o: unknown) => {
      calls.upsert.push([rows, o]);
      return Promise.resolve(opts.upsertResult ?? { error: null });
    }),
    select: vi.fn(() => selectBuilder),
  };

  const client = { from: vi.fn((t: string) => { calls.from.push(t); return fromObj; }) };
  return { client: client as unknown as SupabaseClient, calls, fromObj };
}

const ROW: AnalyticsSnapshotInsert = {
  shop_id: "shop-1",
  source: "semrush",
  date: "2026-06-01",
  period: "monthly",
  metrics: { organic_keywords: 10 },
};

describe("upsertSnapshots", () => {
  it("upserts on the idempotency key and returns the row count", async () => {
    const { client, calls } = makeClient({ upsertResult: { error: null } });
    const n = await upsertSnapshots(client, [ROW, { ...ROW, date: "2026-07-01" }]);
    expect(n).toBe(2);
    expect(calls.from).toEqual(["analytics_snapshots"]);
    const [, opts] = calls.upsert[0];
    expect(opts).toMatchObject({
      onConflict: "shop_id,source,date,period",
      ignoreDuplicates: false,
    });
  });

  it("no-ops on empty input (zero rows, no db call)", async () => {
    const { client, calls } = makeClient({});
    const n = await upsertSnapshots(client, []);
    expect(n).toBe(0);
    expect(calls.upsert).toHaveLength(0);
  });

  it("throws on upsert error", async () => {
    const { client } = makeClient({ upsertResult: { error: { message: "boom" } } });
    await expect(upsertSnapshots(client, [ROW])).rejects.toThrow(/upsertSnapshots failed: boom/);
  });
});

describe("getSnapshots", () => {
  const args = {
    shopId: "shop-1",
    source: "semrush" as const,
    period: "monthly" as const,
    from: "2026-01-01",
    to: "2026-06-30",
  };

  it("filters by shop+source+period+date range and returns typed rows", async () => {
    const data = [{ id: "a", shop_id: "shop-1", location_id: null, source: "semrush", date: "2026-06-01", period: "monthly", metrics: {}, synced_at: "", created_at: "" }];
    const { client, calls } = makeClient({ selectResult: { data, error: null } });
    const res = await getSnapshots(client, args);
    expect(res).toEqual(data);
    expect(calls.eq).toEqual([
      ["shop_id", "shop-1"],
      ["source", "semrush"],
      ["period", "monthly"],
    ]);
    expect(calls.gte).toEqual([["date", "2026-01-01"]]);
    expect(calls.lte).toEqual([["date", "2026-06-30"]]);
    expect(calls.order).toEqual([["date", { ascending: true }]]);
  });

  it("returns [] for a no-data shop (null data, no throw)", async () => {
    const { client } = makeClient({ selectResult: { data: null, error: null } });
    await expect(getSnapshots(client, args)).resolves.toEqual([]);
  });

  it("throws on read error", async () => {
    const { client } = makeClient({ selectResult: { data: null, error: { message: "nope" } } });
    await expect(getSnapshots(client, args)).rejects.toThrow(/getSnapshots failed: nope/);
  });
});
