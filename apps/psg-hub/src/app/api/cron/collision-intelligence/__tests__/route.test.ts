import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, from, feedEq, syncSpcReports } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  feedEq: vi.fn(),
  syncSpcReports: vi.fn(),
}));

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
  from.mockReturnValue({
    select: () => ({ eq: feedEq }),
  });
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
});
