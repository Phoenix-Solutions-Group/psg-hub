import { describe, it, expect, vi, beforeEach } from "vitest";
import { priorMonth } from "@/lib/analytics/rollup";

// 12-05c thin auth/wiring test for the performance MONTHLY cron route. The ingest logic
// is covered by perf-sync.test.ts; here we prove the CRON_SECRET gate (401 before any
// work), the PSI not-configured 503 guard, prior-month injection, and the GTMetrix
// pilot-scope env (GTMETRIX_SHOP_IDS → gtmetrixShopIds, else a safe limit of 1).

const { syncPerformance } = vi.hoisted(() => ({ syncPerformance: vi.fn() }));
vi.mock("@/lib/perf/perf-sync", () => ({ syncPerformance }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

import { GET, POST } from "@/app/api/cron/perf-sync/route";

function req(headers: Record<string, string> = {}) {
  return new Request("https://hub.psgweb.me/api/cron/perf-sync", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  syncPerformance.mockResolvedValue({ synced: 1, skipped: 0, failed: 0 });
  process.env.CRON_SECRET = "cron-secret";
  process.env.PAGESPEED_API_KEY = "psi-key";
  delete process.env.GTMETRIX_SHOP_IDS;
});

describe("perf-sync cron route", () => {
  it("401 with no Authorization (before any work)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(syncPerformance).not.toHaveBeenCalled();
  });

  it("401 with a wrong secret", async () => {
    const res = await GET(req({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
    expect(syncPerformance).not.toHaveBeenCalled();
  });

  it("503 when PAGESPEED_API_KEY is unset (PSI floor unconfigured)", async () => {
    delete process.env.PAGESPEED_API_KEY;
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(503);
    expect(syncPerformance).not.toHaveBeenCalled();
  });

  it("200 injects the prior month + falls back to gtmetrixShopLimit 1 when unscoped", async () => {
    const expectedMonth = priorMonth(new Date().toISOString().slice(0, 7));
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    expect(syncPerformance).toHaveBeenCalledTimes(1);
    expect(syncPerformance.mock.calls[0][1]).toEqual({
      month: expectedMonth,
      gtmetrixShopLimit: 1,
    });
  });

  it("passes GTMETRIX_SHOP_IDS as gtmetrixShopIds (comma-split, trimmed)", async () => {
    process.env.GTMETRIX_SHOP_IDS = "shop-a, shop-b ,";
    await POST(req({ authorization: "Bearer cron-secret" }));
    expect(syncPerformance.mock.calls[0][1]).toMatchObject({
      gtmetrixShopIds: ["shop-a", "shop-b"],
    });
    expect(syncPerformance.mock.calls[0][1]).not.toHaveProperty("gtmetrixShopLimit");
  });
});
