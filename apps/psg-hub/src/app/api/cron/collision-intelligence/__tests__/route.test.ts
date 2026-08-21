import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, feedEq, stormEq, forecastEq, syncSpcReports } = vi.hoisted(
  () => ({
    rpc: vi.fn(),
    from: vi.fn(),
    feedEq: vi.fn(),
    stormEq: vi.fn(),
    forecastEq: vi.fn(),
    syncSpcReports: vi.fn(),
  }),
);

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc, from }),
}));
vi.mock("@/lib/collision-intelligence/spc-sync", () => ({ syncSpcReports }));

import { GET, POST } from "../route";

function request(authorization?: string) {
  return new Request("https://hub.psgweb.me/api/cron/collision-intelligence", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  syncSpcReports.mockResolvedValue({
    refreshedDays: 3,
    skippedDays: 0,
    imported: 10,
  });
  rpc.mockResolvedValue({ data: { published: 1 }, error: null });
  feedEq.mockResolvedValue({ data: [], error: null });
  stormEq.mockResolvedValue({ data: [], error: null });
  forecastEq.mockResolvedValue({ data: [], error: null });
  from.mockImplementation((relation: string) => ({
    select: () => ({
      eq:
        relation === "v_collision_repair_feed_status"
          ? feedEq
          : relation === "v_collision_storm_source_reconciliation"
            ? stormEq
            : forecastEq,
    }),
  }));
});

describe("collision intelligence cron", () => {
  it("rejects unauthorized calls before network or database work", async () => {
    expect((await GET(request())).status).toBe(401);
    expect(syncSpcReports).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("refreshes weather and forecasts through GET or POST", async () => {
    const response = await POST(request("Bearer cron-secret"));
    expect(response.status).toBe(200);
    expect(syncSpcReports).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("run_collision_weekly_forecasts");
    expect(from).toHaveBeenCalledWith("v_collision_repair_feed_status");
    expect(from).toHaveBeenCalledWith(
      "v_collision_storm_source_reconciliation",
    );
    expect(from).toHaveBeenCalledWith("v_collision_forecast_readiness");
  });

  it("runs forecast scoring even when the weather refresh fails", async () => {
    syncSpcReports.mockRejectedValue(new Error("SPC unavailable"));
    const response = await GET(request("Bearer cron-secret"));
    expect(response.status).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      weather: "failed",
      forecasts: "success",
    });
  });

  it("fails cron health when a mapped repair feed is stale", async () => {
    feedEq.mockResolvedValue({
      data: [{ shop_id: "shop-1", source_age_hours: 48 }],
      error: null,
    });

    const response = await GET(request("Bearer cron-secret"));

    expect(response.status).toBe(500);
    expect(syncSpcReports).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      repairFeed: "stale",
      weather: "success",
      forecasts: "success",
    });
  });

  it("fails cron health when a storm event batch is unreconciled", async () => {
    stormEq.mockResolvedValue({
      data: [
        {
          source_key: "noaa_spc_preliminary_reports",
          import_batch_id: "spc_missing",
          event_rows: 10,
          reported_rows: null,
          reconciliation_status: "missing_source_ledger",
        },
      ],
      error: null,
    });

    const response = await GET(request("Bearer cron-secret"));

    expect(response.status).toBe(500);
    expect(syncSpcReports).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({
      stormSources: "unreconciled",
      weather: "success",
      forecasts: "success",
    });
  });

  it("fails cron health when a mapped shop horizon is not ready", async () => {
    forecastEq.mockResolvedValue({
      data: [
        {
          shop_id: "shop-1",
          forecast_horizon_weeks: 2,
          readiness_status: "model_not_approved",
        },
      ],
      error: null,
    });

    const response = await GET(request("Bearer cron-secret"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      forecastReadiness: "gated",
      forecasts: "success",
    });
  });
});
