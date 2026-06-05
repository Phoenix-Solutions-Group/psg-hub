import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const syncMock = vi.fn();
vi.mock("@/lib/semrush/sync", () => ({
  syncSemrushSnapshots: (...args: unknown[]) => syncMock(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));

import { GET, POST } from "../route";

function req(auth?: string): Request {
  return new Request("http://localhost/api/cron/semrush-sync", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  syncMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("SEMRUSH_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron/semrush-sync gate", () => {
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

  it("503 semrush_not_configured when SEMRUSH_API_KEY is missing", async () => {
    vi.stubEnv("SEMRUSH_API_KEY", "");
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "semrush_not_configured" });
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("cron/semrush-sync happy path", () => {
  it("GET with the correct secret runs the sync and returns counts", async () => {
    syncMock.mockResolvedValue({ synced: 4, skipped: 3, failed: 0 });
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 4, skipped: 3, failed: 0 });
    expect(syncMock).toHaveBeenCalledWith(
      { __service: true },
      { apiKey: "test-key" }
    );
  });

  it("POST works identically (manual operator trigger)", async () => {
    syncMock.mockResolvedValue({ synced: 1, skipped: 0, failed: 1 });
    const res = await POST(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ synced: 1, skipped: 0, failed: 1 });
  });
});
