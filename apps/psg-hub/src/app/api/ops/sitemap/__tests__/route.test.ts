import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- mocks ---------------------------------------------------------------
// requireSuperadmin is the auth gate; swap `gate` per-test. runSitemap + persistence are
// mocked so this suite proves the ROUTE wiring (auth, param validation, status mapping) —
// the orchestrator is covered by lib/sitemap/__tests__/run.test.ts.
let gate: unknown = { ok: true, userId: "super-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({ requireSuperadmin: async () => gate }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

let runOutcome: Record<string, unknown> = { status: "complete" };
const runMock = vi.fn(async () => runOutcome);
vi.mock("@/lib/sitemap/run", () => ({ runSitemap: () => runMock() }));

let packages: { data: { package: unknown } }[] = [];
vi.mock("@/lib/sitemap/persistence", () => ({ loadSitemapPackages: async () => packages }));
vi.mock("@/lib/sitemap/render", () => ({ renderSitemapDeliverable: () => "<!doctype html><h1>Deliverable</h1>" }));

const { POST, GET } = await import("@/app/api/ops/sitemap/route");

const SHOP = "11111111-2222-4333-8444-555555555555";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/ops/sitemap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function get(qs = "") {
  return new NextRequest(`http://localhost/api/ops/sitemap${qs}`);
}

beforeEach(() => {
  gate = { ok: true, userId: "super-1", access: {} };
  runOutcome = { status: "complete", persisted: { id: "art-1", shopId: SHOP }, package: { brief: { businessName: "Demo" } } };
  packages = [];
  runMock.mockClear();
});

describe("POST /api/ops/sitemap — auth + validation", () => {
  it("401 when unauthenticated, no run", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await POST(post({ shopId: SHOP }));
    expect(res.status).toBe(401);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("403 when not a superadmin, no run", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const res = await POST(post({ shopId: SHOP }));
    expect(res.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("400 on a non-UUID shopId", async () => {
    const res = await POST(post({ shopId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/ops/sitemap — outcome mapping", () => {
  it("200 + artifactId on complete", async () => {
    const res = await POST(post({ shopId: SHOP }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "complete", artifactId: "art-1" });
  });

  it("202 awaiting_approval surfaces the queued phase", async () => {
    runOutcome = {
      status: "awaiting_approval",
      stop: { phase: "clusters_page_types", contentHash: "abc", record: { summary: { clusterCount: 3 } } },
    };
    const res = await POST(post({ shopId: SHOP }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: "awaiting_approval", phase: "clusters_page_types" });
  });

  it("409 changes_requested surfaces the notes", async () => {
    runOutcome = { status: "changes_requested", stop: { phase: "package_handoff", approval: { notes: "fix it" } } };
    const res = await POST(post({ shopId: SHOP }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ status: "changes_requested", notes: "fix it" });
  });

  it("404 when the shop is not found", async () => {
    runOutcome = { status: "no_shop" };
    const res = await POST(post({ shopId: SHOP }));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/ops/sitemap — deliverable preview", () => {
  it("404 when no package persisted", async () => {
    const res = await GET(get(`?shopId=${SHOP}`));
    expect(res.status).toBe(404);
  });

  it("renders the latest package as HTML", async () => {
    packages = [{ data: { package: { brief: { businessName: "Demo" } } } }];
    const res = await GET(get(`?shopId=${SHOP}&format=html`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Deliverable");
  });
});
