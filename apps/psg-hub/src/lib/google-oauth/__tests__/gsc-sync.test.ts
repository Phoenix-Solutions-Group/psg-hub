import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GscMetrics } from "@/lib/analytics/types";
import { GoogleApiError } from "../client";

// markAccountError is the only accounts import sync uses at runtime; stub it
// (it would otherwise build a real service client).
const markErrorMock = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../accounts", () => ({
  markAccountError: (...a: unknown[]) => markErrorMock(...a),
}));
// gsc-metrics pulls in the server-only googleapis client; we always inject
// fetchMetrics, but the module is still imported, so stub it light.
vi.mock("../gsc-metrics", () => ({
  fetchGscDailyMetrics: vi.fn(),
}));

import { syncGscSnapshots, windowBounds } from "../gsc-sync";

function metrics(clicks: number): GscMetrics {
  return {
    clicks,
    impressions: clicks * 12,
    ctr: 0.08,
    position: 9.5,
  };
}

type AcctRow = { id: string; shop_id: string; external_account_id: string };

function makeService(opts: {
  accounts?: AcctRow[];
  accountsError?: { message: string };
  ledgerInsertError?: { message: string };
}) {
  const calls = {
    ledgerInserts: [] as unknown[],
    ledgerUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
    upserts: [] as { rows: unknown[] }[],
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
      if (table === "google_oauth_accounts") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.order = async () =>
          opts.accountsError
            ? { data: null, error: opts.accountsError }
            : { data: opts.accounts ?? [], error: null };
        return b;
      }
      if (table === "analytics_snapshots") {
        return {
          upsert: async (rows: unknown[]) => {
            calls.upserts.push({ rows });
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(() => {
  markErrorMock.mockReset();
});

describe("windowBounds (GSC default 7-wide)", () => {
  it("returns a resyncDays-wide trailing range ending yesterday (UTC)", () => {
    expect(windowBounds("2026-06-10", 7)).toEqual({
      startDate: "2026-06-03",
      endDate: "2026-06-09",
    });
  });
});

describe("syncGscSnapshots", () => {
  it("ingests linked gsc shops, ONE fetch per shop over the window, fans the date-map into source='gsc' rows", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "sc-domain:a.com" },
      ],
    });
    const fetchMetrics = vi.fn(async () =>
      new Map<string, GscMetrics>([
        ["2026-06-07", metrics(10)],
        ["2026-06-08", metrics(20)],
        ["2026-06-09", metrics(30)],
      ])
    );
    const res = await syncGscSnapshots(client, {
      today: "2026-06-10",
      resyncDays: 7,
      fetchMetrics: fetchMetrics as never,
    });

    expect(fetchMetrics).toHaveBeenCalledTimes(1);
    expect(fetchMetrics).toHaveBeenCalledWith(
      "shop-1",
      { startDate: "2026-06-03", endDate: "2026-06-09" },
      undefined
    );
    expect(res).toEqual({ synced: 3, skipped: 0, failed: 0 });
    expect(calls.upserts[0].rows).toHaveLength(3);
    expect(calls.upserts[0].rows[0]).toMatchObject({
      shop_id: "shop-1",
      source: "gsc",
      period: "daily",
      date: "2026-06-07",
    });
  });

  it("collapses a double-linked shop to ONE account (deterministic, no double-write)", async () => {
    const { client } = makeService({
      accounts: [
        // ordered linked_at desc by the query; first per shop_id wins
        { id: "a-new", shop_id: "shop-1", external_account_id: "https://a.com/" },
        { id: "a-old", shop_id: "shop-1", external_account_id: "sc-domain:a.com" },
        { id: "b", shop_id: "shop-2", external_account_id: "sc-domain:b.com" },
      ],
    });
    const fetchMetrics = vi.fn(async () =>
      new Map<string, GscMetrics>([["2026-06-09", metrics(5)]])
    );
    const res = await syncGscSnapshots(client, {
      today: "2026-06-10",
      resyncDays: 7,
      fetchMetrics: fetchMetrics as never,
    });
    // 2 distinct shops only (shop-1 deduped), 1 row each
    expect(fetchMetrics).toHaveBeenCalledTimes(2);
    expect(res.synced).toBe(2);
  });

  it("contains an auth_failed shop: marks the account error, continues the batch", async () => {
    const { client } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "sc-domain:a.com" },
        { id: "a2", shop_id: "shop-2", external_account_id: "sc-domain:b.com" },
      ],
    });
    const fetchMetrics = vi.fn(async (shopId: string) => {
      if (shopId === "shop-1") {
        throw new GoogleApiError("auth_failed", "invalid_grant");
      }
      return new Map<string, GscMetrics>([["2026-06-09", metrics(7)]]);
    });
    const res = await syncGscSnapshots(client, {
      today: "2026-06-10",
      resyncDays: 7,
      fetchMetrics: fetchMetrics as never,
    });
    expect(res).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(markErrorMock).toHaveBeenCalledWith("a1", "invalid_grant");
  });

  it("does NOT flip the account on a non-auth (rate_limited) failure", async () => {
    const { client } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "sc-domain:a.com" },
      ],
    });
    const fetchMetrics = vi.fn(async () => {
      throw new GoogleApiError("rate_limited", "429");
    });
    const res = await syncGscSnapshots(client, {
      today: "2026-06-10",
      resyncDays: 7,
      fetchMetrics: fetchMetrics as never,
    });
    expect(res.failed).toBe(1);
    expect(markErrorMock).not.toHaveBeenCalled();
  });

  it("on an accounts-read error: closes the ledger error and rethrows", async () => {
    const { client, calls } = makeService({
      accountsError: { message: "db down" },
    });
    await expect(
      syncGscSnapshots(client, { today: "2026-06-10", resyncDays: 7 })
    ).rejects.toThrow(/db down/);
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("error");
  });

  it("ledger-open failure is non-blocking (run still completes)", async () => {
    const { client } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "sc-domain:a.com" },
      ],
      ledgerInsertError: { message: "ledger insert failed" },
    });
    const fetchMetrics = vi.fn(async () =>
      new Map<string, GscMetrics>([["2026-06-09", metrics(3)]])
    );
    const res = await syncGscSnapshots(client, {
      today: "2026-06-10",
      resyncDays: 7,
      fetchMetrics: fetchMetrics as never,
    });
    expect(res.synced).toBe(1);
  });
});
