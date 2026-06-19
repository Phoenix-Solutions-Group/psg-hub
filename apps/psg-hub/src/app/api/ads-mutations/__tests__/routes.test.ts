import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- mocks ---------------------------------------------------------------
// requireOpsFn("ads_mutations") is the auth gate (PSG-26d); swap `opsGate` per-test to
// simulate allowed / forbidden. The registry, governance, rate-limit, bridge and types
// are the REAL modules — these tests prove the route wiring end to end, with the
// bridge failing closed (no Sandbox), which is the live state today.
let opsGate: unknown = { ok: true, userId: "user-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: async (_fn: string) => opsGate,
}));

// Universal chainable + awaitable Supabase service stub. Every builder method
// returns the builder; awaiting it yields a shape that satisfies job-insert
// (data.id), updates (error), audit insert (error), and rate-limit head counts (count).
function makeServiceMock() {
  const result = { data: { id: "job-1" }, error: null, count: 0 };
  const builder: Record<string, unknown> = {};
  for (const m of [
    "insert", "select", "update", "eq", "gte", "single", "order", "maybeSingle", "head",
  ]) {
    builder[m] = vi.fn(() => builder);
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { from: vi.fn(() => builder) };
}
let serviceMock: ReturnType<typeof makeServiceMock>;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceMock,
}));

const { GET } = await import("@/app/api/ads-mutations/registry/route");
const { POST: dryRun } = await import("@/app/api/ads-mutations/dry-run/route");
const { POST: execute } = await import("@/app/api/ads-mutations/execute/route");

function getReq(qs = "") {
  return new NextRequest(`http://localhost/api/ads-mutations/registry${qs}`);
}
function postReq(url: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  opsGate = { ok: true, userId: "user-1", access: {} };
  serviceMock = makeServiceMock();
  delete process.env.ADS_MUTATIONS_SANDBOX_ENABLED;
});

describe("GET /api/ads-mutations/registry", () => {
  it("returns the full catalog with sandbox disabled by default", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sandboxEnabled).toBe(false);
    expect(json.count).toBeGreaterThanOrEqual(10);
    expect(json.mutations.length).toBe(json.count);
  });

  it("filters by platform", async () => {
    const res = await GET(getReq("?platform=gtm"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.mutations.every((m: { platform: string }) => m.platform === "gtm")).toBe(true);
  });

  it("rejects an unknown platform with 422", async () => {
    const res = await GET(getReq("?platform=tiktok"));
    expect(res.status).toBe(422);
  });

  it("propagates the capability gate's 403", async () => {
    opsGate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/ads-mutations/dry-run", () => {
  it("422s when the target is missing (governance)", async () => {
    const res = await dryRun(
      postReq("/api/ads-mutations/dry-run", {
        mutationKey: "google_ads.negative_keywords",
        targetRef: "",
        params: { campaign_id: 1, negatives: [] },
      })
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(JSON.stringify(json.errors)).toContain("Target required");
  });

  it("503 `gated` for a valid request while the Sandbox bridge is disabled", async () => {
    const res = await dryRun(
      postReq("/api/ads-mutations/dry-run", {
        mutationKey: "google_ads.negative_keywords",
        targetRef: "123-456-7890",
        params: { campaign_id: 1, negatives: [{ text: "free", match_type: "EXACT" }] },
      })
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.gated).toBe(true);
  });
});

describe("POST /api/ads-mutations/execute", () => {
  it("422s a high-risk mutation with no approval ref", async () => {
    const res = await execute(
      postReq("/api/ads-mutations/execute", {
        mutationKey: "google_ads.campaign_bidding", // high-risk
        targetRef: "123-456-7890",
        params: { changes: [{ campaign_id: 1, strategy: "MAXIMIZE_CONVERSIONS" }] },
      })
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(JSON.stringify(json.errors)).toContain("high-risk");
  });

  it("503 `gated` for a permitted low-risk execute while the Sandbox is disabled", async () => {
    const res = await execute(
      postReq("/api/ads-mutations/execute", {
        mutationKey: "google_ads.negative_keywords", // low-risk, no approval needed
        targetRef: "123-456-7890",
        params: { campaign_id: 1, negatives: [{ text: "free", match_type: "EXACT" }] },
      })
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.gated).toBe(true);
  });
});
