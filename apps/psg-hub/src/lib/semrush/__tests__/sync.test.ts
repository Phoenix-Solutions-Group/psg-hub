import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncSemrushSnapshots } from "../sync";
import type { SemrushMetrics } from "@/lib/analytics/types";

const METRICS: SemrushMetrics = {
  organic_keywords: 10,
  organic_traffic: 100,
  organic_traffic_cost: 250,
  backlinks: 40,
  authority_score: 33,
};

/**
 * Mock service client covering the three tables sync touches:
 * analytics_sync_runs (insert/update), shops (select), analytics_snapshots (upsert).
 */
function makeService(opts: {
  shops?: { id: string; url: string | null }[];
  shopsError?: { message: string };
  ledgerInsertError?: { message: string };
}) {
  const calls = {
    ledgerInserts: [] as unknown[],
    ledgerUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
    upserts: [] as { rows: unknown[]; options: unknown }[],
  };

  const client = {
    from: vi.fn((table: string) => {
      if (table === "analytics_sync_runs") {
        return {
          insert: vi.fn((row: unknown) => {
            calls.ledgerInserts.push(row);
            return {
              select: () => ({
                single: async () =>
                  opts.ledgerInsertError
                    ? { data: null, error: opts.ledgerInsertError }
                    : { data: { id: "run-1" }, error: null },
              }),
            };
          }),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: unknown) => {
              calls.ledgerUpdates.push({ patch, id });
              return { error: null };
            },
          })),
        };
      }
      if (table === "shops") {
        return {
          select: vi.fn(async () =>
            opts.shopsError
              ? { data: null, error: opts.shopsError }
              : { data: opts.shops ?? [], error: null }
          ),
        };
      }
      if (table === "analytics_snapshots") {
        return {
          upsert: vi.fn(async (rows: unknown[], options: unknown) => {
            calls.upserts.push({ rows, options });
            return { error: null };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const BASE = { apiKey: "k", today: "2026-06-05" };

describe("syncSemrushSnapshots", () => {
  it("happy path: one daily row per url-bearing shop, ledger success", async () => {
    const { client, calls } = makeService({
      shops: [
        { id: "s1", url: "https://www.a.com/x" },
        { id: "s2", url: "b.com" },
      ],
    });
    const fetchMetrics = vi.fn(async () => METRICS);

    const result = await syncSemrushSnapshots(client, { ...BASE, fetchMetrics });

    expect(result).toEqual({ synced: 2, skipped: 0, failed: 0 });
    expect(fetchMetrics).toHaveBeenCalledWith("a.com", expect.anything());
    expect(fetchMetrics).toHaveBeenCalledWith("b.com", expect.anything());

    const { rows, options } = calls.upserts[0];
    expect(rows).toEqual([
      { shop_id: "s1", source: "semrush", period: "daily", date: "2026-06-05", metrics: METRICS },
      { shop_id: "s2", source: "semrush", period: "daily", date: "2026-06-05", metrics: METRICS },
    ]);
    // Idempotency: delegated to the 09-01 conflict key.
    expect(options).toMatchObject({ onConflict: "shop_id,source,date,period" });

    expect(calls.ledgerUpdates[0].patch).toMatchObject({
      status: "success",
      rows_written: 2,
    });
  });

  it("shops without a url are skipped — no fetch, no row", async () => {
    const { client, calls } = makeService({
      shops: [
        { id: "s1", url: "a.com" },
        { id: "s2", url: null },
        { id: "s3", url: "   " },
      ],
    });
    const fetchMetrics = vi.fn(async () => METRICS);

    const result = await syncSemrushSnapshots(client, { ...BASE, fetchMetrics });

    expect(result).toEqual({ synced: 1, skipped: 2, failed: 0 });
    expect(fetchMetrics).toHaveBeenCalledTimes(1);
    expect((calls.upserts[0].rows as unknown[]).length).toBe(1);
  });

  it("one failing shop is contained: others sync, failed counted, ledger success", async () => {
    const { client, calls } = makeService({
      shops: [
        { id: "s1", url: "a.com" },
        { id: "s2", url: "bad.com" },
        { id: "s3", url: "c.com" },
      ],
    });
    const fetchMetrics = vi.fn(async (domain: string) => {
      if (domain === "bad.com") throw new Error("ERROR 50");
      return METRICS;
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncSemrushSnapshots(client, { ...BASE, fetchMetrics });

    expect(result).toEqual({ synced: 2, skipped: 0, failed: 1 });
    expect(calls.ledgerUpdates[0].patch).toMatchObject({ status: "success", rows_written: 2 });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("total failure (shops read) -> ledger error + rethrow", async () => {
    const { client, calls } = makeService({ shopsError: { message: "boom" } });

    await expect(
      syncSemrushSnapshots(client, { ...BASE, fetchMetrics: vi.fn() })
    ).rejects.toThrow(/shops read failed: boom/);

    expect(calls.ledgerUpdates[0].patch).toMatchObject({
      status: "error",
      error: expect.stringMatching(/boom/),
    });
  });

  it("ledger open failure does not block the sync (observability only)", async () => {
    const { client } = makeService({
      shops: [{ id: "s1", url: "a.com" }],
      ledgerInsertError: { message: "no table" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncSemrushSnapshots(client, {
      ...BASE,
      fetchMetrics: vi.fn(async () => METRICS),
    });

    expect(result.synced).toBe(1);
    errSpy.mockRestore();
  });
});
