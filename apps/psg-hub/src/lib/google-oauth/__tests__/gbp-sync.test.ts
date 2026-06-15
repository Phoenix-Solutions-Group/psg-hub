import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GbpMetrics } from "@/lib/analytics/types";
import { GoogleApiError } from "../client";

// markAccountError is the only accounts import sync uses at runtime; stub it
// (it would otherwise build a real service client).
// Rest param (not zero-arg) so the wrapper's spread typechecks; the wrapper arrow keeps
// the reference lazy so the hoisted vi.mock factory does not touch markErrorMock before init
// (matches the shipped gsc-sync.test pattern exactly).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const markErrorMock = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../accounts", () => ({
  markAccountError: (...a: unknown[]) => markErrorMock(...a),
}));
// gbp-metrics pulls in the server-only googleapis client; we always inject
// fetchMetrics, but the module is still imported, so stub it light.
vi.mock("../gbp-metrics", () => ({
  fetchGbpDailyMetrics: vi.fn(),
}));

import { syncGbpSnapshots, windowBounds } from "../gbp-sync";

function metrics(calls: number): GbpMetrics {
  return {
    impressions_desktop_maps: calls * 2,
    impressions_desktop_search: calls * 3,
    impressions_mobile_maps: calls * 4,
    impressions_mobile_search: calls * 5,
    impressions_total: calls * 14,
    website_clicks: calls + 1,
    call_clicks: calls,
    direction_requests: calls + 2,
    conversations: calls,
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

describe("windowBounds (GBP default 7-wide)", () => {
  it("returns a resyncDays-wide trailing range ending yesterday (UTC)", () => {
    expect(windowBounds("2026-06-10", 7)).toEqual({
      startDate: "2026-06-03",
      endDate: "2026-06-09",
    });
  });
});

describe("syncGbpSnapshots", () => {
  it("ingests linked gbp shops, ONE fetch per shop over the window, fans the date-map into source='gbp' rows", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "locations/111" },
      ],
    });
    const fetchMetrics = vi.fn(async () =>
      new Map<string, GbpMetrics>([
        ["2026-06-07", metrics(10)],
        ["2026-06-08", metrics(20)],
        ["2026-06-09", metrics(30)],
      ])
    );
    const res = await syncGbpSnapshots(client, {
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
      source: "gbp",
      period: "daily",
      date: "2026-06-07",
    });
  });

  it("collapses a double-linked shop to ONE account (deterministic, no double-write)", async () => {
    const { client } = makeService({
      accounts: [
        // ordered linked_at desc by the query; first per shop_id wins
        { id: "a-new", shop_id: "shop-1", external_account_id: "locations/999" },
        { id: "a-old", shop_id: "shop-1", external_account_id: "locations/111" },
        { id: "b", shop_id: "shop-2", external_account_id: "locations/222" },
      ],
    });
    const fetchMetrics = vi.fn(async () =>
      new Map<string, GbpMetrics>([["2026-06-09", metrics(5)]])
    );
    const res = await syncGbpSnapshots(client, {
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
        { id: "a1", shop_id: "shop-1", external_account_id: "locations/111" },
        { id: "a2", shop_id: "shop-2", external_account_id: "locations/222" },
      ],
    });
    const fetchMetrics = vi.fn(async (shopId: string) => {
      if (shopId === "shop-1") {
        throw new GoogleApiError("auth_failed", "invalid_grant");
      }
      return new Map<string, GbpMetrics>([["2026-06-09", metrics(7)]]);
    });
    const res = await syncGbpSnapshots(client, {
      today: "2026-06-10",
      resyncDays: 7,
      fetchMetrics: fetchMetrics as never,
    });
    expect(res).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(markErrorMock).toHaveBeenCalledWith("a1", "invalid_grant");
  });

  it("does NOT flip the account on a non-auth (bad_request 404 / rate_limited) failure", async () => {
    const { client } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "locations/111" },
      ],
    });
    const fetchMetrics = vi.fn(async () => {
      throw new GoogleApiError("bad_request", "not accessible");
    });
    const res = await syncGbpSnapshots(client, {
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
      syncGbpSnapshots(client, { today: "2026-06-10", resyncDays: 7 })
    ).rejects.toThrow(/db down/);
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("error");
  });

  it("ledger-open failure is non-blocking (run still completes)", async () => {
    const { client } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "locations/111" },
      ],
      ledgerInsertError: { message: "ledger insert failed" },
    });
    const fetchMetrics = vi.fn(async () =>
      new Map<string, GbpMetrics>([["2026-06-09", metrics(3)]])
    );
    const res = await syncGbpSnapshots(client, {
      today: "2026-06-10",
      resyncDays: 7,
      fetchMetrics: fetchMetrics as never,
    });
    expect(res.synced).toBe(1);
  });
});
