import { describe, it, expect, vi, beforeEach } from "vitest";

// Thin auth/wiring test for the monthly cron route. The pipeline logic is covered by
// monthly.test.ts; here we only prove the CRON_SECRET gate (401 before any work), the
// not-configured 503 guard, and that an authorized+configured call invokes the
// orchestrator. runMonthlyReports is mocked so no real DB/LLM/network runs.

const { runMonthlyReports } = vi.hoisted(() => ({ runMonthlyReports: vi.fn() }));
vi.mock("@/lib/report/monthly", () => ({ runMonthlyReports }));

import { GET } from "@/app/api/cron/monthly-report/route";

const CONFIGURED = {
  REPORT_RENDER_URL: "https://render.example.com",
  RENDER_TOKEN: "tok",
  REPORT_EMAIL_TEMPLATE_ID: "d-tmpl",
  AI_GATEWAY_API_KEY: "gw-key",
};

function req(headers: Record<string, string> = {}) {
  return new Request("https://hub.psgweb.me/api/cron/monthly-report", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  runMonthlyReports.mockResolvedValue({
    period: "2026-05",
    results: [],
    counts: { sent: 0, skipped: 0, held: 0, failed: 0 },
  });
  process.env.CRON_SECRET = "cron-secret";
  Object.assign(process.env, CONFIGURED);
});

describe("monthly-report cron route", () => {
  it("401 with no Authorization (before any work)", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(runMonthlyReports).not.toHaveBeenCalled();
  });

  it("401 with a wrong secret", async () => {
    const res = await GET(req({ authorization: "Bearer nope" }));
    expect(res.status).toBe(401);
    expect(runMonthlyReports).not.toHaveBeenCalled();
  });

  it("503 when the report secrets are not configured", async () => {
    delete process.env.REPORT_RENDER_URL;
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(503);
    expect(runMonthlyReports).not.toHaveBeenCalled();
  });

  it("200 invokes the orchestrator when authorized + configured", async () => {
    const res = await GET(req({ authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    expect(runMonthlyReports).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toHaveProperty("counts");
    expect(body).toHaveProperty("period");
  });
});
