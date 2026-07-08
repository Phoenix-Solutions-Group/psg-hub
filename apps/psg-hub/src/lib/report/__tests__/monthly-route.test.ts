import { describe, it, expect, vi, beforeEach } from "vitest";

// Thin auth/wiring test for the monthly cron route. The pipeline logic is covered by
// monthly.test.ts; here we only prove the CRON_SECRET gate (401 before any work), the
// not-configured 503 guard, and that an authorized+configured call invokes the
// orchestrator. runMonthlyReports is mocked so no real DB/LLM/network runs.

const { runMonthlyReports } = vi.hoisted(() => ({ runMonthlyReports: vi.fn() }));
// Stub the service client so we can spy on the claim RPC. runMonthlyReports is mocked and
// never invokes the deps closures, so only `.rpc` (exercised when we call claimForSend by
// hand) is needed.
const { serviceStub } = vi.hoisted(() => ({ serviceStub: { rpc: vi.fn() } }));
vi.mock("@/lib/report/monthly", () => ({ runMonthlyReports }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => serviceStub }));

import { GET, POST } from "@/app/api/cron/monthly-report/route";
import type { MonthlyDeps } from "@/lib/report/monthly";

const CONFIGURED = {
  REPORT_RENDER_URL: "https://render.example.com",
  RENDER_TOKEN: "tok",
  REPORT_EMAIL_TEMPLATE_ID: "d-tmpl",
  AI_GATEWAY_API_KEY: "gw-key",
};

function req(headers: Record<string, string> = {}, url = "https://hub.psgweb.me/api/cron/monthly-report") {
  return new Request(url, { headers });
}

/** The deps object the route passed into the (mocked) orchestrator on its last call. */
function lastDeps(): MonthlyDeps {
  return runMonthlyReports.mock.calls.at(-1)![1] as MonthlyDeps;
}
const AUTH = { authorization: "Bearer cron-secret" };

beforeEach(() => {
  vi.clearAllMocks();
  runMonthlyReports.mockResolvedValue({
    period: "2026-05",
    results: [
      {
        shop: {
          id: "aaaaaaaa-0000-0000-0000-000000000001",
          name: "Shop A",
          ownerEmail: "owner@example.com",
        },
        status: "held",
        reason: "schema: no linked sources to report",
      },
      {
        shop: {
          id: "bbbbbbbb-0000-0000-0000-000000000002",
          name: "Shop B",
          ownerEmail: "owner-b@example.com",
        },
        status: "failed",
        error:
          "render worker responded 400 for owner-b@example.com at https://render.example.com/api?api_token=SECRET123&shop=1234567890",
      },
    ],
    counts: { sent: 0, skipped: 0, held: 1, failed: 1 },
  });
  serviceStub.rpc.mockResolvedValue({ data: true, error: null });
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
    expect(body.actionRequired).toEqual([
      {
        shopId: "aaaaaaaa-0000-0000-0000-000000000001",
        shopName: "Shop A",
        status: "held",
        reason: "schema: no linked sources to report",
      },
      {
        shopId: "bbbbbbbb-0000-0000-0000-000000000002",
        shopName: "Shop B",
        status: "failed",
        error: "render worker responded 400 for [REDACTED_EMAIL] at [url]",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("owner@example.com");
    expect(JSON.stringify(body)).not.toContain("SECRET123");
    expect(JSON.stringify(body)).not.toContain("1234567890");
  });

  it("scheduled GET never forces, even with ?force=1", async () => {
    const res = await GET(req(AUTH, "https://hub.psgweb.me/api/cron/monthly-report?force=1"));
    expect(res.status).toBe(200);
    expect(lastDeps().force).toBe(false);
    expect((await res.json()).force).toBe(false);
  });

  it("manual POST honors ?force=1: force reaches BOTH the preflight bypass AND the claim RPC", async () => {
    const res = await POST(req(AUTH, "https://hub.psgweb.me/api/cron/monthly-report?force=1"));
    expect(res.status).toBe(200);
    expect((await res.json()).force).toBe(true);

    const deps = lastDeps();
    expect(deps.force).toBe(true); // seam 1: preflight alreadySent bypass
    // seam 2: the claim binding — the seam that had the original double-send bug. Invoke
    // it and prove the same flag reaches the RPC as p_force, not a hardcoded false.
    await deps.claimForSend("aaaaaaaa-0000-0000-0000-000000000001", "2026-05");
    expect(serviceStub.rpc).toHaveBeenCalledWith(
      "claim_monthly_report",
      expect.objectContaining({ p_force: true })
    );
  });

  it("manual POST without ?force=1 does not force (preflight AND claim see false)", async () => {
    const res = await POST(req(AUTH));
    expect(res.status).toBe(200);
    const deps = lastDeps();
    expect(deps.force).toBe(false);
    await deps.claimForSend("aaaaaaaa-0000-0000-0000-000000000001", "2026-05");
    expect(serviceStub.rpc).toHaveBeenCalledWith(
      "claim_monthly_report",
      expect.objectContaining({ p_force: false })
    );
  });
});
