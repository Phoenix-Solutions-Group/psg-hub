import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const genMock = vi.fn();
vi.mock("@/lib/agents/orchestrator", () => ({
  runDraftGeneration: (...args: unknown[]) => genMock(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));

import { GET, POST } from "../route";

function req(auth?: string): Request {
  return new Request("http://localhost/api/cron/orchestrator-generate", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  genMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("cron/orchestrator-generate gate", () => {
  it("401 without Authorization — generation never called (zero spend)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret", async () => {
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset (unconfigured = locked)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    expect(genMock).not.toHaveBeenCalled();
  });

  it("runs the generation pass and returns its summary on the correct secret", async () => {
    genMock.mockResolvedValue({ paused: false, queued: 3, shopsProcessed: 3 });
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: 3, paused: false });
    expect(genMock).toHaveBeenCalledTimes(1);
  });
});
