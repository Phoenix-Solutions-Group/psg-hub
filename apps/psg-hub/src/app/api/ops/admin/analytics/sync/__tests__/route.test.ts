import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// --- mocks ---------------------------------------------------------------
// requireSuperadmin is the fail-closed gate; swap `gate` per-test.
let gate: unknown = { ok: true, userId: "super-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({
  requireSuperadmin: async () => gate,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({}),
}));

// The dispatcher is unit-tested separately (manual-sync.test.ts). Here we mock it to
// prove ROUTE wiring: auth gate, body parse/validation, and HTTP status mapping.
let runResult: unknown = { cadence: "daily", scope: "fleet", results: [] };
const runMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return runResult;
});
vi.mock("@/lib/analytics/manual-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/manual-sync")>();
  return { ...actual, runManualSync: (...a: unknown[]) => runMock(...a) };
});

const { POST } = await import("@/app/api/ops/admin/analytics/sync/route");

function req(body?: unknown): Request {
  return new Request("http://localhost/api/ops/admin/analytics/sync", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  gate = { ok: true, userId: "super-1", access: {} };
  runResult = {
    cadence: "daily",
    scope: "fleet",
    results: [{ source: "ga4", status: "success", rows_written: 5 }],
  };
  runMock.mockClear();
});

describe("POST /api/ops/admin/analytics/sync — auth", () => {
  it("401 when unauthenticated (dispatcher never called)", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await POST(req({ cadence: "daily" }));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("403 when authenticated but not a superadmin", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const res = await POST(req({ cadence: "daily" }));
    expect(res.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/admin/analytics/sync — validation", () => {
  it("400 on invalid cadence", async () => {
    const res = await POST(req({ cadence: "hourly" }));
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("400 on invalid daily source", async () => {
    const res = await POST(req({ cadence: "daily", source: "bing" }));
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("400 on malformed period", async () => {
    const res = await POST(req({ cadence: "monthly", period: "2026/07" }));
    expect(res.status).toBe(400);
  });

  it("400 on non-boolean force", async () => {
    const res = await POST(req({ cadence: "monthly", force: "yes" }));
    expect(res.status).toBe(400);
  });

  it("400 on malformed JSON", async () => {
    const bad = new Request("http://localhost/api/ops/admin/analytics/sync", {
      method: "POST",
      body: "{not json",
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });

  it("defaults to daily/all when body is empty", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
    const passed = runMock.mock.calls[0][1] as { cadence: string };
    expect(passed.cadence).toBe("daily");
  });
});

describe("POST /api/ops/admin/analytics/sync — dispatch + status mapping", () => {
  it("passes the parsed request through to the dispatcher", async () => {
    await POST(req({ cadence: "monthly", period: "2026-07", force: true }));
    const passed = runMock.mock.calls[0][1];
    expect(passed).toMatchObject({ cadence: "monthly", period: "2026-07", force: true });
  });

  it("200 when any step succeeded", async () => {
    runResult = {
      cadence: "daily",
      scope: "fleet",
      results: [
        { source: "ga4", status: "success", rows_written: 5 },
        { source: "gsc", status: "error", rows_written: 0, error: "boom" },
      ],
    };
    const res = await POST(req({ cadence: "daily" }));
    expect(res.status).toBe(200);
  });

  it("502 when at least one step errored and none succeeded", async () => {
    runResult = {
      cadence: "daily",
      scope: "fleet",
      results: [{ source: "ga4", status: "error", rows_written: 0, error: "boom" }],
    };
    const res = await POST(req({ cadence: "daily" }));
    expect(res.status).toBe(502);
  });

  it("503 when every step was skipped (nothing configured)", async () => {
    runResult = {
      cadence: "daily",
      scope: "fleet",
      results: [{ source: "ga4", status: "skipped", rows_written: 0, error: "not_configured" }],
    };
    const res = await POST(req({ cadence: "daily" }));
    expect(res.status).toBe(503);
  });
});
