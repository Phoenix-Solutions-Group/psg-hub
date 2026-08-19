import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGoogleAdsDashboard,
  getRecentGoogleAdsChanges,
} from "../google-ads-dashboard";
import type { DatedMetrics } from "../aggregate";

const row = (
  date: string,
  metrics: Record<string, unknown>,
  synced_at = `${date}T12:00:00.000Z`
): DatedMetrics & { synced_at: string } => ({ date, metrics, synced_at });

describe("buildGoogleAdsDashboard", () => {
  it("returns an empty state with no fake metrics", () => {
    const out = buildGoogleAdsDashboard({ currentRows: [], priorRows: [] });

    expect(out.status).toBe("empty");
    expect(out.lastSyncedAt).toBeNull();
    expect(out.tiles.find((tile) => tile.key === "spend")?.display).toBe("$0");
    expect(out.recentChanges).toEqual([]);
  });

  it("sums spend, leads, clicks, impressions, and recomputes cost per lead", () => {
    const out = buildGoogleAdsDashboard({
      currentRows: [
        row("2026-07-01", {
          spend: 100,
          conversions: 2,
          clicks: 20,
          impressions: 200,
          conversion_tracking_verified: true,
        }),
        row("2026-07-02", {
          spend: 200,
          conversions: 1,
          clicks: 30,
          impressions: 300,
          conversion_tracking_verified: true,
        }),
      ],
      priorRows: [
        row("2026-06-01", {
          spend: 150,
          conversions: 3,
          clicks: 25,
          impressions: 250,
        }),
      ],
    });

    expect(out.status).toBe("ready");
    expect(out.conversionTrackingConfirmed).toBe(true);
    expect(out.tiles.find((tile) => tile.key === "spend")?.value).toBe(300);
    expect(out.tiles.find((tile) => tile.key === "conversions")?.value).toBe(3);
    expect(out.tiles.find((tile) => tile.key === "clicks")?.value).toBe(50);
    expect(out.tiles.find((tile) => tile.key === "impressions")?.value).toBe(500);
    expect(out.tiles.find((tile) => tile.key === "cpl")?.value).toBe(100);
    expect(out.tiles.find((tile) => tile.key === "spend")?.trend).toBe(1);
    expect(out.lastSyncedAt).toBe("2026-07-02T12:00:00.000Z");
  });

  it("marks lead and cost-per-lead tiles unconfirmed when conversions are not verified", () => {
    const out = buildGoogleAdsDashboard({
      currentRows: [
        row("2026-07-01", {
          spend: 120,
          conversions: 0,
          clicks: 12,
          impressions: 1200,
          conversion_tracking_verified: false,
        }),
      ],
      priorRows: [],
    });

    const leads = out.tiles.find((tile) => tile.key === "conversions");
    const cpl = out.tiles.find((tile) => tile.key === "cpl");

    expect(out.conversionTrackingConfirmed).toBe(false);
    expect(leads).toMatchObject({
      value: null,
      display: "Unconfirmed",
      unconfirmed: true,
      trend: null,
    });
    expect(cpl).toMatchObject({
      value: null,
      display: "Unconfirmed",
      unconfirmed: true,
      trend: null,
    });
    expect(out.leadsSeries).toEqual([{ date: "Jul 1", value: 0 }]);
  });

  it("treats missing verification with zero conversions as unconfirmed", () => {
    const out = buildGoogleAdsDashboard({
      currentRows: [
        row("2026-07-01", {
          spend: 120,
          conversions: 0,
          clicks: 12,
          impressions: 1200,
        }),
      ],
      priorRows: [],
    });

    expect(out.conversionTrackingConfirmed).toBe(false);
    expect(out.tiles.find((tile) => tile.key === "conversions")?.display).toBe(
      "Unconfirmed"
    );
  });
});

describe("getRecentGoogleAdsChanges", () => {
  function makeClient(result: {
    data: unknown[] | null;
    error: { message: string } | null;
  }) {
    const calls = {
      from: [] as string[],
      eq: [] as [string, unknown][],
      in: [] as [string, unknown][],
      order: [] as [string, unknown][],
      limit: [] as number[],
    };
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, value: unknown) => {
        calls.eq.push([col, value]);
        return builder;
      }),
      in: vi.fn((col: string, value: unknown) => {
        calls.in.push([col, value]);
        return builder;
      }),
      order: vi.fn((col: string, value: unknown) => {
        calls.order.push([col, value]);
        return builder;
      }),
      limit: vi.fn((value: number) => {
        calls.limit.push(value);
        return Promise.resolve(result);
      }),
    };
    const client = {
      from: vi.fn((table: string) => {
        calls.from.push(table);
        return builder;
      }),
    };
    return { client: client as unknown as SupabaseClient, calls };
  }

  it("clamps recent changes to authorized shops and Google Ads executes", async () => {
    const { client, calls } = makeClient({
      data: [
        {
          id: "audit-1",
          mutation_key: "google_ads.negative_keywords",
          op_name: "apply_negative_keywords",
          created_at: "2026-07-10T12:00:00.000Z",
        },
      ],
      error: null,
    });

    const out = await getRecentGoogleAdsChanges(client, {
      authorizedShopIds: ["shop-1", "shop-2"],
      limit: 3,
    });

    expect(calls.from).toEqual(["ads_audit_logs"]);
    expect(calls.eq).toEqual([
      ["platform", "google_ads"],
      ["mode", "execute"],
    ]);
    expect(calls.in).toEqual([["shop_id", ["shop-1", "shop-2"]]]);
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
    expect(calls.limit).toEqual([3]);
    expect(out).toEqual([
      {
        id: "audit-1",
        title: "google_ads.negative_keywords",
        occurredAt: "2026-07-10T12:00:00.000Z",
      },
    ]);
  });

  it("does not query when there are no authorized shops", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await expect(
      getRecentGoogleAdsChanges(client, { authorizedShopIds: [] })
    ).resolves.toEqual([]);
    expect(calls.from).toEqual([]);
  });
});
