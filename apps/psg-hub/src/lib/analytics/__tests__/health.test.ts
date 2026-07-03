import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkAnalyticsHealth,
  isStalled,
  MONITORED_SOURCES,
} from "../health";

type Run = { status: "success" | "error"; rows_written: number };

/**
 * Minimal service double covering the three tables the health check reads:
 *  - analytics_sync_runs: select().eq(source).in().order().limit() -> {data}
 *  - google_oauth_accounts: select().eq(status) -> {data}
 *  - google_ads_accounts:   select().eq(status) -> {data}
 * runsBySource is keyed on the `.eq("source", <v>)` value; rows are newest-first.
 */
function makeService(config: {
  runsBySource?: Record<string, Run[]>;
  runsError?: { message: string };
  oauthErrors?: { id: string; shop_id: string | null; source: string }[];
  adsErrors?: { id: string; shop_id: string | null }[];
}) {
  const client = {
    from: (table: string) => {
      if (table === "analytics_sync_runs") {
        let src = "";
        const builder = {
          select: () => builder,
          eq: (_c: string, v: string) => {
            src = v;
            return builder;
          },
          in: () => builder,
          order: () => builder,
          limit: async () =>
            config.runsError
              ? { data: null, error: config.runsError }
              : { data: config.runsBySource?.[src] ?? [], error: null },
        };
        return builder;
      }
      if (table === "google_oauth_accounts") {
        const builder = {
          select: () => builder,
          eq: async () => ({ data: config.oauthErrors ?? [], error: null }),
        };
        return builder;
      }
      if (table === "google_ads_accounts") {
        const builder = {
          select: () => builder,
          eq: async () => ({ data: config.adsErrors ?? [], error: null }),
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return client as unknown as SupabaseClient;
}

const HEALTHY: Run[] = [
  { status: "success", rows_written: 42 },
  { status: "success", rows_written: 40 },
];

/** A service where every monitored source has a healthy last run. */
function allHealthyRuns(): Record<string, Run[]> {
  return Object.fromEntries(MONITORED_SOURCES.map((s) => [s, HEALTHY]));
}

describe("isStalled", () => {
  it("trips when the last `threshold` runs are ALL success with 0 rows", () => {
    expect(
      isStalled(
        [
          { status: "success", rows_written: 0 },
          { status: "success", rows_written: 0 },
        ],
        2
      )
    ).toBe(true);
  });

  it("does NOT trip with fewer than `threshold` runs (insufficient evidence)", () => {
    expect(isStalled([{ status: "success", rows_written: 0 }], 2)).toBe(false);
  });

  it("does NOT trip if any run in the window wrote rows", () => {
    expect(
      isStalled(
        [
          { status: "success", rows_written: 0 },
          { status: "success", rows_written: 12 },
        ],
        2
      )
    ).toBe(false);
  });

  it("only inspects the newest `threshold` runs", () => {
    // newest two are 0-row -> stall, even though an older run wrote rows
    expect(
      isStalled(
        [
          { status: "success", rows_written: 0 },
          { status: "success", rows_written: 0 },
          { status: "success", rows_written: 99 },
        ],
        2
      )
    ).toBe(true);
  });
});

describe("checkAnalyticsHealth", () => {
  it("reports ok when every source has a recent non-empty success", async () => {
    const service = makeService({ runsBySource: allHealthyRuns() });
    const report = await checkAnalyticsHealth(service);
    expect(report.ok).toBe(true);
    expect(report.alerts).toEqual([]);
  });

  it("flags a source stuck at 0 rows for 2 consecutive runs (the PSG-532 stall)", async () => {
    const runs = allHealthyRuns();
    runs.ga4 = [
      { status: "success", rows_written: 0 },
      { status: "success", rows_written: 0 },
    ];
    const report = await checkAnalyticsHealth(service_(runs));
    expect(report.ok).toBe(false);
    const stall = report.alerts.find((a) => a.kind === "stall");
    expect(stall).toBeDefined();
    expect(stall?.source).toBe("ga4");
  });

  it("does not flag a single 0-row run (threshold not yet met)", async () => {
    const runs = allHealthyRuns();
    runs.gsc = [
      { status: "success", rows_written: 0 },
      { status: "success", rows_written: 15 },
    ];
    const report = await checkAnalyticsHealth(service_(runs));
    expect(report.alerts.find((a) => a.kind === "stall")).toBeUndefined();
    expect(report.ok).toBe(true);
  });

  it("flags a source whose most recent run errored", async () => {
    const runs = allHealthyRuns();
    runs.semrush = [
      { status: "error", rows_written: 0 },
      { status: "success", rows_written: 10 },
    ];
    const report = await checkAnalyticsHealth(service_(runs));
    const err = report.alerts.find((a) => a.kind === "error_run");
    expect(err?.source).toBe("semrush");
  });

  it("flags a google_ads account sitting in error (needs re-link)", async () => {
    const report = await checkAnalyticsHealth(
      makeService({
        runsBySource: allHealthyRuns(),
        adsErrors: [{ id: "acc-1", shop_id: "shop-1" }],
      })
    );
    expect(report.ok).toBe(false);
    expect(report.alerts.some((a) => a.kind === "ads_account_error")).toBe(true);
  });

  it("flags a google_oauth account sitting in error (needs re-link)", async () => {
    const report = await checkAnalyticsHealth(
      makeService({
        runsBySource: allHealthyRuns(),
        oauthErrors: [{ id: "o-1", shop_id: "shop-1", source: "ga4" }],
      })
    );
    expect(report.alerts.some((a) => a.kind === "oauth_account_error")).toBe(
      true
    );
  });

  it("never-run sources are ignored (not this check's job)", async () => {
    // no runs for any source, no account errors -> healthy
    const report = await checkAnalyticsHealth(makeService({}));
    expect(report.ok).toBe(true);
    expect(report.alerts).toEqual([]);
  });

  it("surfaces a ledger read failure as an alert per source", async () => {
    const report = await checkAnalyticsHealth(
      makeService({ runsError: { message: "ledger down" } })
    );
    expect(report.ok).toBe(false);
    // one error_run alert per monitored source
    expect(report.alerts.filter((a) => a.kind === "error_run").length).toBe(
      MONITORED_SOURCES.length
    );
  });

  it("stamps checkedAt from the injected clock", async () => {
    const report = await checkAnalyticsHealth(
      makeService({ runsBySource: allHealthyRuns() }),
      { now: () => new Date("2026-07-03T08:30:00.000Z") }
    );
    expect(report.checkedAt).toBe("2026-07-03T08:30:00.000Z");
  });
});

// small helper: build a service from a runsBySource map
function service_(runsBySource: Record<string, Run[]>): SupabaseClient {
  return makeService({ runsBySource });
}
