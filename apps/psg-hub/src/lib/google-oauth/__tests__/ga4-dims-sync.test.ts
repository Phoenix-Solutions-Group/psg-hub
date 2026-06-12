import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ga4DimensionsMetrics } from "@/lib/analytics/types";
import { GoogleApiError } from "../client";

const markErrorMock = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../accounts", () => ({
  markAccountError: (...a: unknown[]) => markErrorMock(...a),
}));
// ga4-dimensions pulls in the server-only gax client; we always inject fetchDimensions.
vi.mock("../ga4-dimensions", () => ({
  fetchGa4Dimensions: vi.fn(),
}));

import { syncGa4Dimensions, reportMonth } from "../ga4-dims-sync";

function dims(channelSessions: number): Ga4DimensionsMetrics {
  return {
    topChannels: [
      { name: "Organic Search", sessions: channelSessions, users: channelSessions },
      { name: "(other)", sessions: 5, users: 4 },
    ],
    topLandingPages: [{ name: "/", sessions: channelSessions, users: channelSessions }],
    devices: [{ name: "mobile", sessions: channelSessions, users: channelSessions }],
    newVsReturning: [{ name: "new", sessions: channelSessions, users: channelSessions }],
    averageSessionDuration: 120,
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

describe("reportMonth", () => {
  it("prefers the explicit month override", () => {
    expect(reportMonth({ month: "2026-04", today: "2026-06-11" })).toBe("2026-04");
  });
  it("falls back to the month containing today", () => {
    expect(reportMonth({ today: "2026-06-11" })).toBe("2026-06");
  });
});

describe("syncGa4Dimensions", () => {
  it("writes exactly ONE monthly row per shop (date=YYYY-MM-01, source=ga4_dimensions, period=monthly), one fetch per shop over the full month", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1", external_account_id: "properties/1" }],
    });
    const fetchDimensions = vi.fn(async () => dims(100));
    const res = await syncGa4Dimensions(client, {
      month: "2026-06",
      fetchDimensions: fetchDimensions as never,
    });

    expect(fetchDimensions).toHaveBeenCalledTimes(1);
    expect(fetchDimensions).toHaveBeenCalledWith(
      "shop-1",
      { start: "2026-06-01", end: "2026-06-30" },
      undefined
    );
    expect(res).toEqual({ synced: 1, skipped: 0, failed: 0 });
    expect(calls.upserts[0].rows).toHaveLength(1);
    expect(calls.upserts[0].rows[0]).toMatchObject({
      shop_id: "shop-1",
      source: "ga4_dimensions",
      period: "monthly",
      date: "2026-06-01",
    });
    // ledger opened with the dimensional source + closed success
    expect(calls.ledgerInserts[0]).toMatchObject({ source: "ga4_dimensions" });
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("success");
  });

  it("collapses a double-linked shop to ONE row (no double-write)", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "a-new", shop_id: "shop-1", external_account_id: "properties/2" },
        { id: "a-old", shop_id: "shop-1", external_account_id: "properties/1" },
        { id: "b", shop_id: "shop-2", external_account_id: "properties/9" },
      ],
    });
    const fetchDimensions = vi.fn(async () => dims(10));
    const res = await syncGa4Dimensions(client, {
      month: "2026-06",
      fetchDimensions: fetchDimensions as never,
    });
    expect(fetchDimensions).toHaveBeenCalledTimes(2); // shop-1 deduped
    expect(res.synced).toBe(2);
    expect(calls.upserts[0].rows).toHaveLength(2);
  });

  it("contains an auth_failed shop: marks the account error, continues the batch", async () => {
    const { client } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "properties/1" },
        { id: "a2", shop_id: "shop-2", external_account_id: "properties/2" },
      ],
    });
    const fetchDimensions = vi.fn(async (shopId: string) => {
      if (shopId === "shop-1") throw new GoogleApiError("auth_failed", "invalid_grant");
      return dims(7);
    });
    const res = await syncGa4Dimensions(client, {
      month: "2026-06",
      fetchDimensions: fetchDimensions as never,
    });
    expect(res).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(markErrorMock).toHaveBeenCalledWith("a1", "invalid_grant");
  });

  it("on an accounts-read error: closes the ledger error and rethrows", async () => {
    const { client, calls } = makeService({ accountsError: { message: "db down" } });
    await expect(
      syncGa4Dimensions(client, { month: "2026-06" })
    ).rejects.toThrow(/db down/);
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("error");
  });
});
