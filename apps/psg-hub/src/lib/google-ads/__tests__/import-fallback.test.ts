import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGoogleAdsImportRows,
  importGoogleAdsMetricsFallback,
} from "../import-fallback";

const SHOP_ID = "00000000-0000-4000-8000-000000000001";

function makeService(opts: {
  existingBatch?: Record<string, unknown> | null;
  upsertError?: { message: string };
  snapshotError?: { message: string };
} = {}) {
  const calls = {
    batchReads: [] as string[],
    batchUpserts: [] as unknown[],
    batchUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
    snapshotUpserts: [] as { rows: unknown[]; options: unknown }[],
  };

  const client = {
    from: vi.fn((table: string) => {
      if (table === "google_ads_import_batches") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((_column: string, value: string) => ({
              maybeSingle: async () => {
                calls.batchReads.push(value);
                return { data: opts.existingBatch ?? null, error: null };
              },
            })),
          })),
          upsert: vi.fn((row: unknown) => {
            calls.batchUpserts.push(row);
            return {
              select: () => ({
                single: async () =>
                  opts.upsertError
                    ? { data: null, error: opts.upsertError }
                    : { data: { id: "batch-1" }, error: null },
              }),
            };
          }),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: async (_column: string, id: unknown) => {
              calls.batchUpdates.push({ patch, id });
              return { error: null };
            },
          })),
        };
      }

      if (table === "analytics_snapshots") {
        return {
          upsert: vi.fn(async (rows: unknown[], options: unknown) => {
            calls.snapshotUpserts.push({ rows, options });
            return { error: opts.snapshotError ?? null };
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { client: client as unknown as SupabaseClient, calls };
}

describe("buildGoogleAdsImportRows", () => {
  it("parses Google Ads export rows into the dashboard snapshot shape", () => {
    const out = buildGoogleAdsImportRows({
      idempotency_key: "google-ads-july-2026",
      rows: [
        {
          shop_id: SHOP_ID,
          date: "07/15/2026",
          spend: "$123.45",
          clicks: "1,234",
          impressions: "9,876",
          leads: "5",
          data_freshness: "2026-07-16T12:00:00.000Z",
        },
      ],
    });

    expect(out.rowsSkipped).toBe(0);
    expect(out.snapshots).toEqual([
      {
        shop_id: SHOP_ID,
        source: "google_ads",
        period: "daily",
        date: "2026-07-15",
        metrics: {
          spend: 123.45,
          clicks: 1234,
          impressions: 9876,
          conversions: 5,
          leads: 5,
          cpl: 24.69,
          cost_micros: 123_450_000,
          data_freshness_at: "2026-07-16T12:00:00.000Z",
          import_source: "google_ads_import",
        },
      },
    ]);
  });

  it("skips empty or incomplete metric rows without writing false zeroes", () => {
    const out = buildGoogleAdsImportRows({
      idempotency_key: "google-ads-empty-rows",
      rows: [
        {
          shop_id: SHOP_ID,
          date: "2026-07-15",
          spend: "",
          clicks: "",
          impressions: "",
          conversions: "",
        },
        {
          shop_id: SHOP_ID,
          date: "2026-07-16",
          spend: "10",
          clicks: "2",
          impressions: "20",
          conversions: "1",
        },
      ],
    });

    expect(out.rowsSkipped).toBe(1);
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0]).toMatchObject({ date: "2026-07-16" });
  });
});

describe("importGoogleAdsMetricsFallback", () => {
  it("writes a batch ledger and upserts snapshots on the existing idempotency key", async () => {
    const { client, calls } = makeService();

    const result = await importGoogleAdsMetricsFallback(
      client,
      {
        idempotency_key: "google-ads-batch-2026-07-15",
        rows: [
          {
            shop_id: SHOP_ID,
            date: "2026-07-15",
            spend: 100,
            clicks: 10,
            impressions: 1000,
            conversions: 4,
          },
        ],
      },
      { importedByProfileId: "profile-1" }
    );

    expect(result).toEqual({
      idempotencyKey: "google-ads-batch-2026-07-15",
      duplicate: false,
      rowsReceived: 1,
      rowsWritten: 1,
      rowsSkipped: 0,
    });
    expect(calls.batchUpserts[0]).toMatchObject({
      idempotency_key: "google-ads-batch-2026-07-15",
      imported_by_profile_id: "profile-1",
      status: "running",
      rows_received: 1,
    });
    expect(calls.snapshotUpserts[0].options).toMatchObject({
      onConflict: "shop_id,source,date,period",
    });
    expect(calls.batchUpdates[0].patch).toMatchObject({
      status: "success",
      rows_written: 1,
      rows_skipped: 0,
    });
  });

  it("treats a successful existing idempotency key as a duplicate replay", async () => {
    const { client, calls } = makeService({
      existingBatch: { id: "batch-1", status: "success", rows_written: 3 },
    });

    const result = await importGoogleAdsMetricsFallback(client, {
      idempotency_key: "google-ads-replayed-batch",
      rows: [
        {
          shop_id: SHOP_ID,
          date: "2026-07-15",
          spend: 100,
          clicks: 10,
          impressions: 1000,
          conversions: 4,
        },
      ],
    });

    expect(result).toEqual({
      idempotencyKey: "google-ads-replayed-batch",
      duplicate: true,
      rowsReceived: 1,
      rowsWritten: 3,
      rowsSkipped: 1,
    });
    expect(calls.batchUpserts).toHaveLength(0);
    expect(calls.snapshotUpserts).toHaveLength(0);
  });

  it("marks the ledger error with a sanitized message when snapshot upsert fails", async () => {
    const { client, calls } = makeService({
      snapshotError: { message: "bad customer 1234567890 user test@example.com" },
    });

    await expect(
      importGoogleAdsMetricsFallback(client, {
        idempotency_key: "google-ads-failed-batch",
        rows: [
          {
            shop_id: SHOP_ID,
            date: "2026-07-15",
            spend: 100,
            clicks: 10,
            impressions: 1000,
            conversions: 4,
          },
        ],
      })
    ).rejects.toThrow(/upsertSnapshots failed/);

    expect(calls.batchUpdates[0].patch).toMatchObject({
      status: "error",
      rows_written: 0,
      error: expect.stringContaining("[REDACTED_ID]"),
    });
    expect(calls.batchUpdates[0].patch.error).toContain("[REDACTED_EMAIL]");
  });
});
