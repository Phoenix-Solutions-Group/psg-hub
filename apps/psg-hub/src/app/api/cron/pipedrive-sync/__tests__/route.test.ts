import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const syncMock = vi.fn();
vi.mock("@/lib/pipedrive/sync", () => ({
  syncPipedriveDeals: (...args: unknown[]) => syncMock(...args),
}));
vi.mock("@/lib/pipedrive/client", () => ({
  createPipedriveClient: vi.fn(() => ({ __client: true })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ __service: true })),
}));

import { GET, POST, resolveClosedSince } from "../route";

function req(auth?: string, url = "http://localhost/api/cron/pipedrive-sync"): Request {
  return new Request(url, {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  syncMock.mockReset();
  vi.stubEnv("CRON_SECRET", "test-secret");
  vi.stubEnv("PIPEDRIVE_API_TOKEN", "tok");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron/pipedrive-sync gate", () => {
  it("401 without Authorization — sync never called", async () => {
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

  it("503 pipedrive_not_configured when the token is missing — sync never called", async () => {
    vi.stubEnv("PIPEDRIVE_API_TOKEN", "");
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "pipedrive_not_configured" });
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe("cron/pipedrive-sync run", () => {
  it("200 with the result on a successful sync", async () => {
    syncMock.mockResolvedValue({ ok: true, openDeals: 12, totalDeals: 15 });
    const res = await POST(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, openDeals: 12, totalDeals: 15 });
    // PSG-623 — the cron now passes a rolling won/lost window so the won/booked line has data.
    expect(syncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client: { __client: true },
        service: { __service: true },
        closedUpdatedSince: expect.any(String),
      }),
    );
  });

  it("passes a ~90-day rolling closedUpdatedSince window (PSG-623)", async () => {
    syncMock.mockResolvedValue({ ok: true, openDeals: 1, totalDeals: 1 });
    const before = Date.now();
    await POST(req("Bearer test-secret"));
    const after = Date.now();

    const { closedUpdatedSince } = syncMock.mock.calls[0]![0] as {
      closedUpdatedSince: string;
    };
    const since = new Date(closedUpdatedSince).getTime();
    const day = 24 * 60 * 60 * 1000;
    // Bracket the 90-day-ago timestamp against the wall clock either side of the call.
    expect(since).toBeGreaterThanOrEqual(before - 90 * day - day);
    expect(since).toBeLessThanOrEqual(after - 90 * day + day);
  });

  it("closedUpdatedSince is whole-second RFC3339 — no milliseconds (PSG-630)", async () => {
    // Pipedrive v2 /deals rejects fractional-second datetimes with HTTP 400, which
    // aborted the whole sync (open + won + lost). The window MUST end in `SSZ`, not `.SSSZ`.
    syncMock.mockResolvedValue({ ok: true, openDeals: 1, totalDeals: 1 });
    await POST(req("Bearer test-secret"));
    const { closedUpdatedSince } = syncMock.mock.calls[0]![0] as {
      closedUpdatedSince: string;
    };
    expect(closedUpdatedSince).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(closedUpdatedSince).not.toContain(".");
    // Still a valid, parseable instant.
    expect(Number.isNaN(new Date(closedUpdatedSince).getTime())).toBe(false);
  });

  it("502 when the sync captured a failure (so cron alerts)", async () => {
    syncMock.mockResolvedValue({ ok: false, openDeals: 0, totalDeals: 0, error: "HTTP 500" });
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(502);
    expect((await res.json()).ok).toBe(false);
  });

  it("passes the widened window when `?since=` is supplied (PSG-760 backfill)", async () => {
    syncMock.mockResolvedValue({ ok: true, openDeals: 3, totalDeals: 3 });
    const url = "http://localhost/api/cron/pipedrive-sync?since=2010-01-01";
    await POST(req("Bearer test-secret", url));
    const { closedUpdatedSince } = syncMock.mock.calls[0]![0] as {
      closedUpdatedSince: string;
    };
    expect(closedUpdatedSince).toBe("2010-01-01T00:00:00Z");
  });
});

describe("resolveClosedSince (PSG-760)", () => {
  const now = new Date("2026-07-07T12:00:00Z");

  it("defaults to the 90-day rolling window with no `since` param", () => {
    const out = resolveClosedSince("http://x/api/cron/pipedrive-sync", now);
    // 90 days before 2026-07-07 = 2026-04-08, whole-second RFC3339.
    expect(out).toBe("2026-04-08T12:00:00Z");
  });

  it("honours a valid `?since=YYYY-MM-DD` override as whole-second RFC3339", () => {
    const out = resolveClosedSince("http://x/api/cron/pipedrive-sync?since=2010-01-01", now);
    expect(out).toBe("2010-01-01T00:00:00Z");
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(out).not.toContain(".");
  });

  it("falls back to the default for a malformed or invalid `since`", () => {
    const def = resolveClosedSince("http://x/api/cron/pipedrive-sync", now);
    for (const bad of ["not-a-date", "2010/01/01", "2026-13-01", "2026-02-30", "20100101"]) {
      const out = resolveClosedSince(`http://x/api/cron/pipedrive-sync?since=${bad}`, now);
      expect(out).toBe(def);
    }
  });
});
