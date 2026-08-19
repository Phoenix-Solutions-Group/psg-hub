import { describe, expect, it } from "vitest";
import { callTrackingSummaryRun } from "../live/call-tracking";
import type { ReportContext, ReportParams } from "../types";

type Row = {
  shop_id: string;
  call_started_at: string;
  source: string | null;
  campaign: string | null;
  qualified: boolean | null;
  shops: { name: string | null } | null;
};

class Query {
  private filters: ((row: Row) => boolean)[] = [];

  constructor(private rows: Row[]) {}

  select() {
    return this;
  }

  gte(column: keyof Row, value: string) {
    this.filters.push((row) => String(row[column]) >= value);
    return this;
  }

  lte(column: keyof Row, value: string) {
    this.filters.push((row) => String(row[column]) <= value);
    return this;
  }

  in(column: keyof Row, values: string[]) {
    this.filters.push((row) => values.includes(String(row[column])));
    return this;
  }

  async range(from: number, to: number) {
    const data = this.rows.filter((row) => this.filters.every((fn) => fn(row)));
    return { data: data.slice(from, to + 1), error: null };
  }
}

function ctx(rows: Row[], shopIds: string[] | null = null): ReportContext {
  return {
    db: {
      from(table: string) {
        expect(table).toBe("call_tracking_calls");
        return new Query(rows);
      },
    },
    shopIds,
    generatedAt: "2026-07-10T00:00:00Z",
  };
}

const params: ReportParams = {
  start: "2026-07-01",
  end: "2026-07-31",
  filters: {},
};

describe("callTrackingSummaryRun", () => {
  it("groups calls by shop, date, source, and campaign", async () => {
    const rows: Row[] = [
      {
        shop_id: "shop-1",
        call_started_at: "2026-07-02T08:00:00Z",
        source: "Google Ads",
        campaign: "Collision",
        qualified: true,
        shops: { name: "Wallace Collision Center" },
      },
      {
        shop_id: "shop-1",
        call_started_at: "2026-07-02T09:00:00Z",
        source: "Google Ads",
        campaign: "Collision",
        qualified: false,
        shops: { name: "Wallace Collision Center" },
      },
      {
        shop_id: "shop-1",
        call_started_at: "2026-08-01T09:00:00Z",
        source: "Google Ads",
        campaign: "Collision",
        qualified: true,
        shops: { name: "Wallace Collision Center" },
      },
    ];

    await expect(callTrackingSummaryRun(params, ctx(rows))).resolves.toEqual([
      {
        shop: "Wallace Collision Center",
        date: "2026-07-02",
        source: "Google Ads",
        campaign: "Collision",
        totalCalls: 2,
        qualifiedCalls: 1,
      },
    ]);
  });

  it("honors shop scope and shop-name filtering", async () => {
    const rows: Row[] = [
      {
        shop_id: "shop-1",
        call_started_at: "2026-07-02T08:00:00Z",
        source: null,
        campaign: null,
        qualified: true,
        shops: { name: "Wallace Collision Center" },
      },
      {
        shop_id: "shop-2",
        call_started_at: "2026-07-02T08:00:00Z",
        source: "Google Ads",
        campaign: "Brand",
        qualified: true,
        shops: { name: "Tedesco Auto Body" },
      },
    ];

    await expect(
      callTrackingSummaryRun(
        { ...params, filters: { shopId: "Wallace" } },
        ctx(rows, ["shop-1"]),
      ),
    ).resolves.toEqual([
      {
        shop: "Wallace Collision Center",
        date: "2026-07-02",
        source: "Unknown",
        campaign: "Unknown",
        totalCalls: 1,
        qualifiedCalls: 1,
      },
    ]);
  });
});
