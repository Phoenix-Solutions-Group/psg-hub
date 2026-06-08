import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AdsApiError } from "../types";
import type { GoogleAdsMetrics } from "@/lib/analytics/types";

// markAccountAuthFailed is the only client import sync.ts uses at runtime here;
// stub it (it would otherwise build a real service client).
const markAuthFailedMock = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../client", () => ({
  markAccountAuthFailed: (...a: unknown[]) => markAuthFailedMock(...a),
}));
// metrics.ts pulls in server-only google-ads plumbing — we always inject
// fetchMetrics, but the module is still imported, so stub it light.
vi.mock("../metrics", () => ({
  fetchAccountDailyMetrics: vi.fn(),
}));

import { syncGoogleAdsSnapshots, targetDates } from "../sync";

const METRICS: GoogleAdsMetrics = {
  spend: 124.5,
  clicks: 312,
  impressions: 8044,
  conversions: 7,
  cpl: 17.79,
  cost_micros: 124_500_000,
};

/**
 * Mock service client covering the three tables sync touches:
 * analytics_sync_runs (insert/update), google_ads_accounts (select.eq),
 * analytics_snapshots (upsert).
 */
function makeService(opts: {
  accounts?: { id: string; shop_id: string }[];
  accountsError?: { message: string };
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
      if (table === "google_ads_accounts") {
        return {
          select: vi.fn(() => ({
            eq: async () =>
              opts.accountsError
                ? { data: null, error: opts.accountsError }
                : { data: opts.accounts ?? [], error: null },
          })),
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

beforeEach(() => {
  markAuthFailedMock.mockReset();
});

describe("targetDates", () => {
  it("returns yesterday back resyncDays from the UTC anchor (not today)", () => {
    expect(targetDates("2026-06-08", 1)).toEqual(["2026-06-07"]);
    expect(targetDates("2026-06-08", 3)).toEqual(["2026-06-07", "2026-06-06", "2026-06-05"]);
    // never includes the anchor day itself (partial)
    expect(targetDates("2026-06-08", 7)).not.toContain("2026-06-08");
  });
});

describe("syncGoogleAdsSnapshots", () => {
  it("ingests only linked accounts: one daily row per shop per target date", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "acc-1", shop_id: "s1" },
        { id: "acc-2", shop_id: "s2" },
      ],
    });
    const fetchMetrics = vi.fn(async () => METRICS);

    const result = await syncGoogleAdsSnapshots(client, {
      today: "2026-06-08",
      resyncDays: 1,
      fetchMetrics,
    });

    expect(result).toEqual({ synced: 2, skipped: 0, failed: 0 });
    expect(fetchMetrics).toHaveBeenCalledWith("s1", "2026-06-07", undefined);
    expect(fetchMetrics).toHaveBeenCalledWith("s2", "2026-06-07", undefined);

    const { rows, options } = calls.upserts[0];
    expect(rows).toEqual([
      { shop_id: "s1", source: "google_ads", period: "daily", date: "2026-06-07", metrics: METRICS },
      { shop_id: "s2", source: "google_ads", period: "daily", date: "2026-06-07", metrics: METRICS },
    ]);
    expect(options).toMatchObject({ onConflict: "shop_id,source,date,period" });
    expect(calls.ledgerInserts[0]).toMatchObject({ source: "google_ads", status: "running" });
    expect(calls.ledgerUpdates[0].patch).toMatchObject({ status: "success", rows_written: 2 });
  });

  it("re-sync window produces one row per date (idempotency key passes through)", async () => {
    const { client, calls } = makeService({ accounts: [{ id: "acc-1", shop_id: "s1" }] });
    const fetchMetrics = vi.fn(async () => METRICS);

    const result = await syncGoogleAdsSnapshots(client, {
      today: "2026-06-08",
      resyncDays: 3,
      fetchMetrics,
    });

    expect(result.synced).toBe(3);
    expect(fetchMetrics).toHaveBeenCalledTimes(3);
    const dates = (calls.upserts[0].rows as { date: string }[]).map((r) => r.date);
    expect(dates).toEqual(["2026-06-07", "2026-06-06", "2026-06-05"]);
  });

  it("contains a per-shop auth_failed: counts failed, flips the account, continues the batch", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "acc-bad", shop_id: "s-bad" },
        { id: "acc-ok", shop_id: "s-ok" },
      ],
    });
    const fetchMetrics = vi.fn(async (shopId: string) => {
      if (shopId === "s-bad") throw new AdsApiError("auth_failed", "revoked");
      return METRICS;
    });

    const result = await syncGoogleAdsSnapshots(client, {
      today: "2026-06-08",
      resyncDays: 1,
      fetchMetrics,
    });

    expect(result).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(markAuthFailedMock).toHaveBeenCalledWith("acc-bad", "revoked");
    // the good shop's row still lands
    expect(calls.upserts[0].rows).toEqual([
      { shop_id: "s-ok", source: "google_ads", period: "daily", date: "2026-06-07", metrics: METRICS },
    ]);
    expect(calls.ledgerUpdates[0].patch).toMatchObject({ status: "success", rows_written: 1 });
  });

  it("a non-auth failure is contained WITHOUT flipping the account", async () => {
    const { client } = makeService({ accounts: [{ id: "acc-1", shop_id: "s1" }] });
    const fetchMetrics = vi.fn(async () => {
      throw new AdsApiError("timeout", "slow");
    });

    const result = await syncGoogleAdsSnapshots(client, {
      today: "2026-06-08",
      resyncDays: 1,
      fetchMetrics,
    });

    expect(result).toEqual({ synced: 0, skipped: 0, failed: 1 });
    expect(markAuthFailedMock).not.toHaveBeenCalled();
  });

  it("a google_ads_accounts read error closes the ledger 'error' and rethrows", async () => {
    const { client, calls } = makeService({ accountsError: { message: "boom" } });
    await expect(
      syncGoogleAdsSnapshots(client, { today: "2026-06-08", resyncDays: 1, fetchMetrics: vi.fn() })
    ).rejects.toThrow(/boom/);
    expect(calls.ledgerUpdates[0].patch).toMatchObject({ status: "error" });
  });

  it("a ledger-open failure does not block the sync", async () => {
    const { client } = makeService({
      accounts: [{ id: "acc-1", shop_id: "s1" }],
      ledgerInsertError: { message: "ledger down" },
    });
    const result = await syncGoogleAdsSnapshots(client, {
      today: "2026-06-08",
      resyncDays: 1,
      fetchMetrics: vi.fn(async () => METRICS),
    });
    expect(result).toEqual({ synced: 1, skipped: 0, failed: 0 });
  });
});
