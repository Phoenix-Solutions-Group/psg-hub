import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const syncMock = vi.fn();
vi.mock("@/lib/intel/competitor/sync", () => ({
  syncCompetitorScores: (...args: unknown[]) => syncMock(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));

import { GET, POST } from "../route";

function req(auth?: string): Request {
  return new Request("http://localhost/api/cron/competitor-scoring", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  syncMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron/competitor-scoring gate", () => {
  it("401 without Authorization header — sync never called", async () => {
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

  it("GET with the correct secret runs the scoring pass and returns counts", async () => {
    syncMock.mockResolvedValue({ shopsProcessed: 3, competitorsScored: 12, failed: 0 });
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shopsProcessed: 3, competitorsScored: 12, failed: 0 });
    expect(syncMock).toHaveBeenCalledTimes(1);
  });
});
