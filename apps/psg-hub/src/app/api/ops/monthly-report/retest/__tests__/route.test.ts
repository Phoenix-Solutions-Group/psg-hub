import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runMonthlyReports } = vi.hoisted(() => ({ runMonthlyReports: vi.fn() }));
const { serviceStub } = vi.hoisted(() => ({ serviceStub: { rpc: vi.fn() } }));

vi.mock("@/lib/report/monthly", () => ({ runMonthlyReports }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => serviceStub }));

import { POST } from "../route";
import type { MonthlyDeps } from "@/lib/report/monthly";

const SECRET = "monthly-retest-secret";
const CONFIGURED = {
  REPORT_RENDER_URL: "https://render.example.com",
  RENDER_TOKEN: "render-token",
  REPORT_EMAIL_TEMPLATE_ID: "d-template",
  AI_GATEWAY_API_KEY: "gateway-key",
  NEXT_PUBLIC_APP_URL: "https://hub.psgweb.me",
};

function req(token?: string, url = "https://hub.psgweb.me/api/ops/monthly-report/retest") {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request(url, { method: "POST", headers });
}

function lastDeps(): MonthlyDeps {
  return runMonthlyReports.mock.calls.at(-1)![1] as MonthlyDeps;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("MONTHLY_REPORT_RETEST_SECRET", SECRET);
  for (const [key, value] of Object.entries(CONFIGURED)) vi.stubEnv(key, value);
  serviceStub.rpc.mockResolvedValue({ data: true, error: null });
  runMonthlyReports.mockResolvedValue({
    period: "2026-06",
    results: [
      {
        shop: {
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          name: "Tracy's Body Shop",
          ownerEmail: "owner@tracys.example",
        },
        status: "held",
        reason:
          "schema: owner@tracys.example used https://hub.psgweb.me/api/reports/aaaaaaaa-0000-0000-0000-000000000001/2026-06/download?api_token=SECRET123 and customer 1234567890",
      },
      {
        shop: {
          id: "bbbbbbbb-0000-0000-0000-000000000002",
          name: "Wallace Collision",
          ownerEmail: "owner@wallace.example",
        },
        status: "failed",
        error:
          "renderer failed for owner@wallace.example at https://render.example.com/render?api_token=TOKEN456 account 987654321",
      },
    ],
    counts: { sent: 0, skipped: 0, held: 1, failed: 1 },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ops/monthly-report/retest", () => {
  it("404s outside production before doing work", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await POST(req(SECRET));

    expect(res.status).toBe(404);
    expect(runMonthlyReports).not.toHaveBeenCalled();
  });

  it("401s with no bearer token before doing work", async () => {
    const res = await POST(req());

    expect(res.status).toBe(401);
    expect(runMonthlyReports).not.toHaveBeenCalled();
  });

  it("401s with the cron secret or any wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    const res = await POST(req("cron-secret"));

    expect(res.status).toBe(401);
    expect(runMonthlyReports).not.toHaveBeenCalled();
  });

  it("503s after auth when report dependencies are not configured", async () => {
    vi.stubEnv("REPORT_RENDER_URL", "");
    const res = await POST(req(SECRET));

    expect(res.status).toBe(503);
    expect(runMonthlyReports).not.toHaveBeenCalled();
  });

  it("runs the June 2026 retest with force unchecked, even if ?force=1 is supplied", async () => {
    const res = await POST(req(SECRET, "https://hub.psgweb.me/api/ops/monthly-report/retest?force=1"));

    expect(res.status).toBe(200);
    expect(runMonthlyReports).toHaveBeenCalledTimes(1);
    expect(runMonthlyReports.mock.calls[0][0]).toBe("2026-06");

    const body = await res.json();
    expect(body.force).toBe(false);
    expect(body.targetShops).toEqual([
      "Tracy's Body Shop",
      "Wallace Collision",
      "Riverside Collision",
      "Demo Body Shop",
    ]);

    const deps = lastDeps();
    expect(deps.force).toBe(false);
    await deps.claimForSend("aaaaaaaa-0000-0000-0000-000000000001", "2026-06");
    expect(serviceStub.rpc).toHaveBeenCalledWith(
      "claim_monthly_report",
      expect.objectContaining({ p_force: false })
    );
  });

  it("returns sanitized evidence only", async () => {
    const res = await POST(req(SECRET));
    const body = await res.json();
    const raw = JSON.stringify(body);

    expect(body.results).toEqual([
      {
        shopName: "Tracy's Body Shop",
        status: "held",
        reason:
          "schema: [REDACTED_EMAIL] used [url] and customer [REDACTED_ID]",
      },
      {
        shopName: "Wallace Collision",
        status: "failed",
        error: "renderer failed for [REDACTED_EMAIL] at [url] account [REDACTED_ID]",
      },
    ]);
    expect(body.results[0].shopId).toBeUndefined();
    expect(raw).not.toContain("owner@");
    expect(raw).not.toContain("SECRET123");
    expect(raw).not.toContain("TOKEN456");
    expect(raw).not.toContain("1234567890");
    expect(raw).not.toContain("987654321");
    expect(raw).not.toContain("aaaaaaaa-0000-0000-0000-000000000001");
    expect(raw).not.toContain("https://");
  });
});
