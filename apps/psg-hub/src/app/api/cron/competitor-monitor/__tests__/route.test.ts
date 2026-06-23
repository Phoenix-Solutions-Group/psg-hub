import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const monitorMock = vi.fn();
vi.mock("@/lib/intel/monitor/run-monitor", () => ({
  runCompetitorMonitor: (...args: unknown[]) => monitorMock(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));

import { GET, POST } from "../route";

function req(auth?: string): Request {
  return new Request("http://localhost/api/cron/competitor-monitor", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  monitorMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron/competitor-monitor gate", () => {
  it("401 without Authorization header — monitor never called", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(monitorMock).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret", async () => {
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(monitorMock).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset (unconfigured = locked)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    expect(monitorMock).not.toHaveBeenCalled();
  });

  it("GET with the correct secret runs the monitor pass and returns its summary", async () => {
    monitorMock.mockResolvedValue({
      shopsProcessed: 2,
      reportsGenerated: 1,
      degraded: 1,
      skipped: 0,
      failed: 0,
      outcomes: [],
    });
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ shopsProcessed: 2, reportsGenerated: 1 });
    expect(monitorMock).toHaveBeenCalledTimes(1);
  });
});
