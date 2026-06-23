import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pubMock = vi.fn();
vi.mock("@/lib/agents/orchestrator", () => ({
  runPublishApproved: (...args: unknown[]) => pubMock(...args),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));

import { GET, POST } from "../route";

function req(auth?: string): Request {
  return new Request("http://localhost/api/cron/orchestrator-publish", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  pubMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("cron/orchestrator-publish gate", () => {
  it("401 without Authorization — publish never called (zero spend)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(pubMock).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret", async () => {
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(pubMock).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is unset (unconfigured = locked)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("Bearer anything"));
    expect(res.status).toBe(401);
    expect(pubMock).not.toHaveBeenCalled();
  });

  it("runs the publish pass and returns its summary on the correct secret", async () => {
    pubMock.mockResolvedValue({ paused: false, published: 2, approvedFound: 2 });
    const res = await POST(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ published: 2, paused: false });
    expect(pubMock).toHaveBeenCalledTimes(1);
  });
});
