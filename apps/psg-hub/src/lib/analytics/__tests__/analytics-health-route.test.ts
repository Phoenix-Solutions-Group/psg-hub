import { describe, it, expect, vi, beforeEach } from "vitest";

// PSG-533 thin auth/wiring test for the analytics silent-stall cron route. The
// stall/error/account-error logic is covered by health.test.ts; here we prove
// the CRON_SECRET gate (401 before any DB read), the 200 report path, and that
// a degraded report emits an operator-visible `[analytics-health] ALERT` line.

const { checkAnalyticsHealth } = vi.hoisted(() => ({
  checkAnalyticsHealth: vi.fn(),
}));
vi.mock("@/lib/analytics/health", () => ({ checkAnalyticsHealth }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

import { GET, POST } from "@/app/api/cron/analytics-health/route";

function req(headers: Record<string, string> = {}) {
  return new Request("https://hub.psgweb.me/api/cron/analytics-health", {
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "cron-secret";
  checkAnalyticsHealth.mockResolvedValue({
    ok: true,
    checkedAt: "2026-07-03T08:30:00.000Z",
    alerts: [],
  });
});

describe("analytics-health cron route", () => {
  it("401 with no Authorization (before any DB read)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(checkAnalyticsHealth).not.toHaveBeenCalled();
  });

  it("401 with a wrong secret", async () => {
    const res = await GET(req({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
    expect(checkAnalyticsHealth).not.toHaveBeenCalled();
  });

  it("200 returns the health report (GET + POST)", async () => {
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(checkAnalyticsHealth).toHaveBeenCalledTimes(1);

    await POST(req({ authorization: "Bearer cron-secret" }));
    expect(checkAnalyticsHealth).toHaveBeenCalledTimes(2);
  });

  it("emits an operator-visible ALERT line per alert when degraded", async () => {
    checkAnalyticsHealth.mockResolvedValue({
      ok: false,
      checkedAt: "2026-07-03T08:30:00.000Z",
      alerts: [
        { kind: "stall", source: "ga4", detail: "ga4: 0 rows for 2 runs" },
        {
          kind: "ads_account_error",
          source: null,
          detail: "ads account needs re-link",
        },
      ],
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET(req({ authorization: "Bearer cron-secret" }));
      expect(res.status).toBe(200);
      const lines = spy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("[analytics-health] ALERT stall"))).toBe(
        true
      );
      expect(
        lines.some((l) =>
          l.includes("[analytics-health] ALERT ads_account_error")
        )
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
