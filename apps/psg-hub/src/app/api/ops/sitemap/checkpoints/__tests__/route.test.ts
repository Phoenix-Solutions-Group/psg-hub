import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// --- mocks ---------------------------------------------------------------
// requireSuperadmin is the auth gate; swap `gate` per-test. decideCheckpoint + the audit
// writer are mocked so this suite proves the ROUTE wiring (auth, validation, actor-name
// resolution, status mapping, audit-on-decided). The decision algebra itself is covered by
// lib/sitemap/__tests__/checkpoint.test.ts.
let gate: unknown = { ok: true, userId: "super-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({ requireSuperadmin: async () => gate }));

// A tiny service-client fake: profiles.maybeSingle() → display_name; auth.admin.getUserById → email.
let profileName: string | null = "Nick Schoolcraft";
let authEmail: string | null = "nick@phoenixsolutionsgroup.net";
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profileName ? { display_name: profileName } : { display_name: null } }),
        }),
      }),
    }),
    auth: { admin: { getUserById: async () => ({ data: { user: authEmail ? { email: authEmail } : null } }) } },
  }),
}));

let decideOutcome: Record<string, unknown> = { status: "decided", record: {} };
const decideMock = vi.fn(async () => decideOutcome);
vi.mock("@/lib/sitemap/checkpoint", () => ({
  decideCheckpoint: (...args: unknown[]) => decideMock(...(args as [])),
  supabaseCheckpointStore: () => ({}),
}));

const auditMock = vi.fn(async () => "audit-1");
vi.mock("@/lib/audit/access-audit", () => ({ recordAuditEvent: (...a: unknown[]) => auditMock(...(a as [])) }));

const { POST } = await import("@/app/api/ops/sitemap/checkpoints/route");

const SHOP = "11111111-2222-4333-8444-555555555555";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/ops/sitemap/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const record = (over: Record<string, unknown> = {}) => ({
  phase: "clusters_page_types",
  content_hash: "hash-A",
  status: "approved",
  decided_by_name: "Nick Schoolcraft",
  decided_at: "2026-06-25T10:00:00.000Z",
  notes: null,
  ...over,
});

const goodBody = {
  shopId: SHOP,
  phase: "clusters_page_types",
  contentHash: "hash-A",
  decision: "approved",
};

beforeEach(() => {
  gate = { ok: true, userId: "super-1", access: {} };
  profileName = "Nick Schoolcraft";
  authEmail = "nick@phoenixsolutionsgroup.net";
  decideOutcome = { status: "decided", record: record() };
  decideMock.mockClear();
  auditMock.mockClear();
});

describe("POST /api/ops/sitemap/checkpoints — auth + validation", () => {
  it("401 when unauthenticated, no decide, no audit", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await POST(post(goodBody));
    expect(res.status).toBe(401);
    expect(decideMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("403 when not a superadmin", async () => {
    gate = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    const res = await POST(post(goodBody));
    expect(res.status).toBe(403);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("422 on a non-UUID shopId", async () => {
    const res = await POST(post({ ...goodBody, shopId: "nope" }));
    expect(res.status).toBe(422);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("422 on an unknown phase", async () => {
    const res = await POST(post({ ...goodBody, phase: "bogus_phase" }));
    expect(res.status).toBe(422);
  });

  it("422 on an invalid decision", async () => {
    const res = await POST(post({ ...goodBody, decision: "maybe" }));
    expect(res.status).toBe(422);
  });
});

describe("POST /api/ops/sitemap/checkpoints — decision mapping + audit", () => {
  it("200 + audits an approve with the REAL superadmin name", async () => {
    const res = await POST(post(goodBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "decided", checkpoint: { status: "approved" } });
    // decideCheckpoint received the server-resolved actor name (not 'operator').
    const arg = decideMock.mock.calls[0][1] as Record<string, unknown>;
    expect(arg.decidedByName).toBe("Nick Schoolcraft");
    expect(arg.decidedByProfileId).toBe("super-1");
    expect(auditMock).toHaveBeenCalledTimes(1);
    const auditArg = auditMock.mock.calls[0][0] as Record<string, unknown>;
    expect(auditArg).toMatchObject({ action: "sitemap.checkpoint", actorProfileId: "super-1", targetShopId: SHOP });
  });

  it("falls back to the auth email when the profile has no display name", async () => {
    profileName = null;
    await POST(post(goodBody));
    const arg = decideMock.mock.calls[0][1] as Record<string, unknown>;
    expect(arg.decidedByName).toBe("nick@phoenixsolutionsgroup.net");
  });

  it("200 + audits a changes_requested decision with its note", async () => {
    decideOutcome = { status: "decided", record: record({ status: "changes_requested", notes: "fix clusters" }) };
    const res = await POST(post({ ...goodBody, decision: "changes_requested", notes: "fix clusters" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ checkpoint: { status: "changes_requested", notes: "fix clusters" } });
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it("200 idempotent does NOT write a duplicate audit row", async () => {
    decideOutcome = { status: "idempotent", record: record() };
    const res = await POST(post(goodBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "idempotent" });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("409 stale on a mismatched content hash, no audit", async () => {
    decideOutcome = { status: "stale" };
    const res = await POST(post({ ...goodBody, contentHash: "hash-OLD" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_checkpoint");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("409 conflict when a settled gate is flipped, no audit", async () => {
    decideOutcome = { status: "conflict", record: record({ status: "approved" }) };
    const res = await POST(post({ ...goodBody, decision: "changes_requested" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_decided");
    expect(auditMock).not.toHaveBeenCalled();
  });
});
