import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- mocks ---------------------------------------------------------------
// requireSuperadmin is the auth gate; swap `gate` per-test for unauth/forbidden/allowed.
// The orchestrator + audit writer are mocked so this suite proves the ROUTE wiring
// (auth, param validation, format negotiation, 404, audit) — the orchestrator itself is
// covered by lib/intel/report/__tests__/run.test.ts.
let gate: unknown = { ok: true, userId: "super-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({
  requireSuperadmin: async () => gate,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({}),
}));

let runResult: { report: unknown; html: string } = { report: {}, html: "" };
const runMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return runResult;
});
vi.mock("@/lib/intel/report/run", () => ({
  runCompetitorReport: (opts: unknown) => runMock(opts),
}));

const auditMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return "audit-1";
});
vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: (e: unknown) => auditMock(e),
}));

const { GET } = await import("@/app/api/ops/intel/competitor-report/route");

const SHOP = "11111111-2222-4333-8444-555555555555";

function req(qs = "") {
  return new NextRequest(`http://localhost/api/ops/intel/competitor-report${qs}`);
}

function makeRun(totalCompetitors: number, narrative: Record<string, unknown>) {
  return {
    report: { summary: { totalCompetitors }, narrative },
    html: "<!doctype html><h2>Threat ranking</h2>",
  };
}

beforeEach(() => {
  gate = { ok: true, userId: "super-1", access: {} };
  runResult = makeRun(2, { status: "grounded", provider: "perplexity", model: "sonar-pro" });
  runMock.mockClear();
  auditMock.mockClear();
});

describe("GET /api/ops/intel/competitor-report — auth", () => {
  it("401 when unauthenticated", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await GET(req(`?shopId=${SHOP}`));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("403 when not a superadmin", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const res = await GET(req(`?shopId=${SHOP}`));
    expect(res.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/ops/intel/competitor-report — params", () => {
  it("400 when shopId is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it("400 when shopId is not a UUID", async () => {
    const res = await GET(req("?shopId=not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("400 when format is unsupported", async () => {
    const res = await GET(req(`?shopId=${SHOP}&format=pdf`));
    expect(res.status).toBe(400);
  });

  it("404 when the shop has no competitor scores", async () => {
    runResult = makeRun(0, { status: "pending_activation", notice: "…" });
    const res = await GET(req(`?shopId=${SHOP}`));
    expect(res.status).toBe(404);
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/ops/intel/competitor-report — output + audit", () => {
  it("returns HTML by default and audits the run with the grounding provider/model", async () => {
    const res = await GET(req(`?shopId=${SHOP}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("Threat ranking");
    expect(auditMock).toHaveBeenCalledTimes(1);
    const event = auditMock.mock.calls[0][0] as Record<string, unknown>;
    expect(event.action).toBe("intel.competitor_report.run");
    expect(event.actorProfileId).toBe("super-1");
    expect(event.targetShopId).toBe(SHOP);
    expect((event.payload as Record<string, unknown>).provider).toBe("perplexity");
    expect((event.payload as Record<string, unknown>).model).toBe("sonar-pro");
  });

  it("returns JSON when format=json and nulls provider/model for a pending narrative", async () => {
    runResult = makeRun(3, { status: "pending_activation", notice: "…" });
    const res = await GET(req(`?shopId=${SHOP}&format=json`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json.report.summary.totalCompetitors).toBe(3);
    const event = auditMock.mock.calls[0][0] as Record<string, unknown>;
    expect((event.payload as Record<string, unknown>).provider).toBeNull();
    expect((event.payload as Record<string, unknown>).model).toBeNull();
  });
});
