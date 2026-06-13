import { describe, it, expect, vi, beforeEach } from "vitest";
import { priorMonth } from "@/lib/analytics/rollup";

// 12-05c thin auth/wiring test for the GA4 dimensional MONTHLY cron route. The ingest
// logic is covered by ga4-dims-sync.test.ts; here we prove the CRON_SECRET gate (401
// before any work), the not-configured 503 guard, and that an authorized+configured
// call invokes the orchestrator with the JUST-COMPLETED prior month.

const { syncGa4Dimensions } = vi.hoisted(() => ({ syncGa4Dimensions: vi.fn() }));
vi.mock("@/lib/google-oauth/ga4-dims-sync", () => ({ syncGa4Dimensions }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

import { GET, POST } from "@/app/api/cron/ga4-dims-sync/route";

const CREDS = {
  GOOGLE_OAUTH_CLIENT_ID: "id",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI: "https://hub.psgweb.me/api/analytics/google/callback",
};

function req(headers: Record<string, string> = {}) {
  return new Request("https://hub.psgweb.me/api/cron/ga4-dims-sync", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  syncGa4Dimensions.mockResolvedValue({ synced: 1, skipped: 0, failed: 0 });
  process.env.CRON_SECRET = "cron-secret";
  Object.assign(process.env, CREDS);
});

describe("ga4-dims-sync cron route", () => {
  it("401 with no Authorization (before any work)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(syncGa4Dimensions).not.toHaveBeenCalled();
  });

  it("401 with a wrong secret", async () => {
    const res = await GET(req({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
    expect(syncGa4Dimensions).not.toHaveBeenCalled();
  });

  it("503 when the Google OAuth creds are absent", async () => {
    delete process.env.GOOGLE_ANALYTICS_OAUTH_REDIRECT_URI;
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(503);
    expect(syncGa4Dimensions).not.toHaveBeenCalled();
  });

  it("200 invokes the orchestrator with the prior month (GET + POST)", async () => {
    const expectedMonth = priorMonth(new Date().toISOString().slice(0, 7));

    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    expect(syncGa4Dimensions).toHaveBeenCalledTimes(1);
    expect(syncGa4Dimensions.mock.calls[0][1]).toEqual({ month: expectedMonth });
    const body = await res.json();
    expect(body.month).toBe(expectedMonth);

    await POST(req({ authorization: "Bearer cron-secret" }));
    expect(syncGa4Dimensions).toHaveBeenCalledTimes(2);
  });
});
