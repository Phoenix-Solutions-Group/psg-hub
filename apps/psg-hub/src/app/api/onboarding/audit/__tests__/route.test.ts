import { describe, it, expect, vi, beforeEach } from "vitest";

type User = { id: string } | null;
let mockUser: User = null;
let mockActiveShopId: string | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
  })),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/shop/context", () => ({
  getActiveShopContext: vi.fn(async () => ({ shops: [], activeShopId: mockActiveShopId })),
}));

const runShopAudit = vi.fn();
const getLatestShopAudit = vi.fn();
const recordBsmPilotEvent = vi.fn();
vi.mock("@/lib/seo-audit/run", () => ({
  ShopAuditPersistError: class ShopAuditPersistError extends Error {},
  runShopAudit: (...a: unknown[]) => runShopAudit(...a),
  getLatestShopAudit: (...a: unknown[]) => getLatestShopAudit(...a),
}));
vi.mock("@/lib/bsm/pilot-events", () => ({
  recordBsmPilotEvent: (...a: unknown[]) => recordBsmPilotEvent(...a),
}));

const { POST, GET } = await import("@/app/api/onboarding/audit/route");

function get(url: string) {
  // The route only reads request.nextUrl.searchParams; provide that shape.
  return { nextUrl: new URL(url) } as unknown as import("next/server").NextRequest;
}

const REPORT = {
  shopId: "s1",
  businessName: "Tracy's",
  domain: "tracys.com",
  generatedAt: "2026-06-23T12:00:00.000Z",
  mode: "audited" as const,
  healthScore: 82,
  grade: "B" as const,
  summary: { pagesCrawled: 3, keepCount: 2, improveCount: 1, findingsBySeverity: { critical: 0, high: 0, medium: 1, low: 0 }, keywordOpportunities: 8 },
  findings: [],
  recommendations: [],
  inventory: [],
  keywordTargets: [],
};

beforeEach(() => {
  mockUser = null;
  mockActiveShopId = null;
  runShopAudit.mockReset();
  getLatestShopAudit.mockReset();
  recordBsmPilotEvent.mockReset();
});

describe("POST /api/onboarding/audit", () => {
  it("401 when unauthenticated", async () => {
    const res = await POST();
    expect(res.status).toBe(401);
    expect(runShopAudit).not.toHaveBeenCalled();
  });

  it("404 when the caller has no shop", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = null;
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it("runs the audit for the caller's active shop and returns the summary", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = "s1";
    runShopAudit.mockResolvedValue({ report: REPORT, html: "<html></html>", auditId: "a1" });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ auditId: "a1", grade: "B", healthScore: 82 });
    // the run is bound to the caller's shop + id (never an attacker-supplied id)
    expect(runShopAudit).toHaveBeenCalledWith(expect.objectContaining({ shopId: "s1", userId: "u1" }));
  });

  it("returns a retry state when the audit runs but cannot be saved", async () => {
    const { ShopAuditPersistError } = await import("@/lib/seo-audit/run");
    mockUser = { id: "u1" };
    mockActiveShopId = "s1";
    runShopAudit.mockRejectedValue(new ShopAuditPersistError("save failed"));
    const res = await POST();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("could not save");
    expect(body).not.toHaveProperty("auditId");
    expect(body).not.toHaveProperty("summary");
    expect(recordBsmPilotEvent).toHaveBeenCalledWith(
      {},
      {
        eventName: "audit_save_failed",
        shopId: "s1",
        userId: "u1",
      },
    );
  });
});

describe("GET /api/onboarding/audit", () => {
  it("401 when unauthenticated", async () => {
    const res = await GET(get("http://localhost/api/onboarding/audit"));
    expect(res.status).toBe(401);
  });

  it("400 on an invalid format", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = "s1";
    const res = await GET(get("http://localhost/api/onboarding/audit?format=pdf"));
    expect(res.status).toBe(400);
  });

  it("404 when no audit has been run yet", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = "s1";
    getLatestShopAudit.mockResolvedValue(null);
    const res = await GET(get("http://localhost/api/onboarding/audit"));
    expect(res.status).toBe(404);
  });

  it("returns json summary by default", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = "s1";
    getLatestShopAudit.mockResolvedValue({ report: REPORT, generatedAt: REPORT.generatedAt });
    const res = await GET(get("http://localhost/api/onboarding/audit"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ grade: "B", mode: "audited" });
  });

  it("returns the branded html report on format=html", async () => {
    mockUser = { id: "u1" };
    mockActiveShopId = "s1";
    getLatestShopAudit.mockResolvedValue({ report: REPORT, generatedAt: REPORT.generatedAt });
    const res = await GET(get("http://localhost/api/onboarding/audit?format=html"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("<!doctype html>");
  });
});
