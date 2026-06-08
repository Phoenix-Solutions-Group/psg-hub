import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const syncMock = vi.fn();
vi.mock("@/lib/google-ads/sync", () => ({
  syncGoogleAdsSnapshots: (...args: unknown[]) => syncMock(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));

import { GET, POST } from "../route";

function req(auth?: string): Request {
  return new Request("http://localhost/api/cron/google-ads-sync", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  syncMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "dev-token");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "csecret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron/google-ads-sync gate", () => {
  it("401 without Authorization header — sync never called, zero spend", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret", async () => {
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset (unconfigured = locked)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("503 google_ads_not_configured when Google creds are missing", async () => {
    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "");
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "google_ads_not_configured" });
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("cron/google-ads-sync happy path", () => {
  it("GET with the correct secret + creds runs the sync and returns counts", async () => {
    syncMock.mockResolvedValue({ synced: 2, skipped: 0, failed: 1 });
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 2, skipped: 0, failed: 1 });
    expect(syncMock).toHaveBeenCalledWith({ __service: true });
  });

  it("POST works identically (manual operator trigger)", async () => {
    syncMock.mockResolvedValue({ synced: 0, skipped: 0, failed: 0 });
    const res = await POST(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 0, skipped: 0, failed: 0 });
  });
});
