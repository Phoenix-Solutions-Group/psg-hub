import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runCompetitorMonitor,
  DEFAULT_MONITOR_SPEND_CAP_USD,
  type MonitorDeps,
} from "../run-monitor";
import type { CompetitorReport } from "../../report/types";

/** Minimal CompetitorReport carrying only the fields the monitor reads. */
function fakeReport(opts: {
  total: number;
  top?: number;
  status?: "grounded" | "pending_activation";
}): CompetitorReport {
  const status = opts.status ?? "grounded";
  return {
    shopId: "ignored",
    generatedAt: "2026-06-23T00:00:00.000Z",
    weights: {} as never,
    summary: { totalCompetitors: opts.total, topThreatScore: opts.top ?? 0 } as never,
    rankedCompetitors: [],
    narrative:
      status === "grounded"
        ? { status: "grounded", summary: "", keyMoves: [], provider: "anthropic" as never, model: "m" }
        : { status: "pending_activation", notice: "pending" },
  } as CompetitorReport;
}

/** Fake service: only `shops.select("id")` and `competitor_monitor_runs.insert(row)` are used
 *  (scoring + report are injected deps), so those are the only two tables modelled. */
function makeService(
  shops: { id: string }[],
  insertSpy: (row: unknown) => unknown,
  shopsError?: { message: string } | null,
): SupabaseClient {
  return {
    from(table: string) {
      if (table === "shops") {
        return { select: () => Promise.resolve({ data: shops, error: shopsError ?? null }) };
      }
      if (table === "competitor_monitor_runs") {
        return { insert: (row: unknown) => insertSpy(row) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("runCompetitorMonitor", () => {
  it("scores + reports each shop, logs a run row, and tallies the summary", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const scoreShop = vi.fn().mockResolvedValue({ competitorsScored: 3 });
    const runReport = vi
      .fn()
      .mockResolvedValueOnce({ report: fakeReport({ total: 3, top: 82, status: "grounded" }), html: "" })
      .mockResolvedValueOnce({ report: fakeReport({ total: 2, top: 40, status: "pending_activation" }), html: "" });

    const service = makeService([{ id: "shop-1" }, { id: "shop-2" }], insertSpy);
    const result = await runCompetitorMonitor(
      service,
      { now: "2026-06-23T00:00:00.000Z" },
      { scoreShop, runReport } as MonitorDeps,
    );

    expect(result.shopsProcessed).toBe(2);
    expect(result.reportsGenerated).toBe(2); // grounded + degraded both produce a report
    expect(result.degraded).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.outcomes.map((o) => o.status)).toEqual(["succeeded", "degraded"]);

    expect(scoreShop).toHaveBeenCalledTimes(2);
    expect(runReport).toHaveBeenCalledTimes(2);
    expect(insertSpy).toHaveBeenCalledTimes(2);

    // Run rows carry the right shop + the read-out summary fields.
    expect(insertSpy.mock.calls[0][0]).toMatchObject({
      shop_id: "shop-1",
      status: "succeeded",
      competitors_tracked: 3,
      top_threat_score: 82,
      narrative_status: "grounded",
      ran_at: "2026-06-23T00:00:00.000Z",
    });
    expect(insertSpy.mock.calls[1][0]).toMatchObject({
      shop_id: "shop-2",
      status: "degraded",
      narrative_status: "pending_activation",
    });
  });

  it("TENANT ISOLATION: every scoring/report/log call is scoped to that shop's own id", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const scoreShop = vi.fn().mockResolvedValue({ competitorsScored: 1 });
    const runReport = vi.fn().mockResolvedValue({ report: fakeReport({ total: 1, top: 10 }), html: "" });

    const service = makeService([{ id: "shop-a" }, { id: "shop-b" }], insertSpy);
    await runCompetitorMonitor(service, {}, { scoreShop, runReport } as MonitorDeps);

    // scoreShop(service, shopId, ...) — second arg is the shop id, and it matches per call.
    expect(scoreShop.mock.calls[0][1]).toBe("shop-a");
    expect(scoreShop.mock.calls[1][1]).toBe("shop-b");
    // runReport({ shopId }) — never another tenant's id.
    expect(runReport.mock.calls[0][0].shopId).toBe("shop-a");
    expect(runReport.mock.calls[1][0].shopId).toBe("shop-b");
    // the run-log row is stamped with the same shop, no cross-shop bleed.
    expect(insertSpy.mock.calls[0][0].shop_id).toBe("shop-a");
    expect(insertSpy.mock.calls[1][0].shop_id).toBe("shop-b");
  });

  it("marks a shop with no scored competitors as skipped (no report produced)", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const scoreShop = vi.fn().mockResolvedValue({ competitorsScored: 0 });
    const runReport = vi.fn().mockResolvedValue({ report: fakeReport({ total: 0 }), html: "" });

    const service = makeService([{ id: "shop-1" }], insertSpy);
    const result = await runCompetitorMonitor(service, {}, { scoreShop, runReport } as MonitorDeps);

    expect(result.reportsGenerated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]).toMatchObject({
      status: "skipped",
      competitorsTracked: 0,
      topThreatScore: null,
      narrativeStatus: null,
    });
    expect(insertSpy).toHaveBeenCalledTimes(1); // still logs that it monitored the shop
    expect(insertSpy.mock.calls[0][0].status).toBe("skipped");
  });

  it("contains a single shop's failure and keeps monitoring the rest", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const scoreShop = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom")) // shop-1 scoring throws
      .mockResolvedValueOnce({ competitorsScored: 1 }); // shop-2 ok
    const runReport = vi.fn().mockResolvedValue({ report: fakeReport({ total: 1, top: 9 }), html: "" });

    const service = makeService([{ id: "shop-1" }, { id: "shop-2" }], insertSpy);
    const result = await runCompetitorMonitor(service, {}, { scoreShop, runReport } as MonitorDeps);

    expect(result.failed).toBe(1);
    expect(result.reportsGenerated).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ shopId: "shop-1", status: "failed", error: "boom" });
    expect(result.outcomes[1].status).toBe("succeeded");
    // Both shops still get a run row (the failed one records the error).
    expect(insertSpy).toHaveBeenCalledTimes(2);
    expect(insertSpy.mock.calls[0][0]).toMatchObject({ shop_id: "shop-1", status: "failed", error: "boom" });
  });

  it("passes the default per-shop spend cap into runReport, env-overridable", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const scoreShop = vi.fn().mockResolvedValue({ competitorsScored: 1 });
    const runReport = vi.fn().mockResolvedValue({ report: fakeReport({ total: 1 }), html: "" });
    const service = makeService([{ id: "shop-1" }], insertSpy);

    await runCompetitorMonitor(service, {}, { scoreShop, runReport } as MonitorDeps);
    expect(runReport.mock.calls[0][0].spendCapUsd).toBe(DEFAULT_MONITOR_SPEND_CAP_USD);

    // env override
    runReport.mockClear();
    vi.stubEnv("INTEL_MONITOR_SPEND_CAP_USD", "12.5");
    await runCompetitorMonitor(service, {}, { scoreShop, runReport } as MonitorDeps);
    expect(runReport.mock.calls[0][0].spendCapUsd).toBe(12.5);

    // explicit opt beats env
    runReport.mockClear();
    await runCompetitorMonitor(service, { spendCapUsd: 0 }, { scoreShop, runReport } as MonitorDeps);
    expect(runReport.mock.calls[0][0].spendCapUsd).toBe(0);
  });

  it("does not lose a shop's outcome when the run-log insert fails", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: { message: "log down" } });
    const scoreShop = vi.fn().mockResolvedValue({ competitorsScored: 1 });
    const runReport = vi.fn().mockResolvedValue({ report: fakeReport({ total: 1, top: 7 }), html: "" });

    const service = makeService([{ id: "shop-1" }], insertSpy);
    const result = await runCompetitorMonitor(service, {}, { scoreShop, runReport } as MonitorDeps);

    expect(result.shopsProcessed).toBe(1);
    expect(result.reportsGenerated).toBe(1);
    expect(result.outcomes[0].status).toBe("succeeded");
  });

  it("throws (fail-closed) when the initial shop-list load fails", async () => {
    const service = makeService([], vi.fn(), { message: "db down" });
    await expect(
      runCompetitorMonitor(service, {}, { scoreShop: vi.fn(), runReport: vi.fn() } as MonitorDeps),
    ).rejects.toThrow(/shop load failed/);
  });
});
