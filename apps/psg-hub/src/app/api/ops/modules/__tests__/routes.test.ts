import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// QA route-contract tests for the Superadmin Module Access Matrix API
// (PSG-29a / PSG-84). The lib unit suites cover the pure helpers; these prove
// the HTTP wiring of /api/ops/modules{,/[id],/grants}: the superadmin gate,
// the negative status codes (400/404/409/422), and that EVERY successful
// mutation records an access_audit row with the right action — i.e. the
// append-only audit trail can never be silently skipped on a write path.
//
// Auth gate + service client + audit sink are mocked; the zod schemas and the
// real ops/modules normalizers run, so validation behaviour is genuine.

// requireSuperadmin gate — swap `gate` per test to simulate allow / 401 / 403.
let gate: unknown = { ok: true, userId: "superadmin-1", access: {} };
vi.mock("@/lib/auth/ops-access", () => ({
  requireSuperadmin: async () => gate,
}));

// Audit sink — assert it is (or is not) called, and with what action.
const mockRecordAudit = vi.fn(async () => "audit-1");
vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAudit(...args),
}));

// FIFO-of-results Supabase service stub. Each `from()` logical query consumes
// the next queued result; terminal `single`/`maybeSingle`/await all resolve to
// it. Tests push the exact result shape each route step expects.
let responses: Array<{ data?: unknown; error?: unknown; code?: string }>;
function makeServiceMock() {
  return {
    from: vi.fn(() => {
      const result = responses.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      for (const m of ["insert", "select", "update", "delete", "eq", "in", "order", "limit"]) {
        builder[m] = vi.fn(() => builder);
      }
      builder.single = vi.fn(() => Promise.resolve(result));
      builder.maybeSingle = vi.fn(() => Promise.resolve(result));
      (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
      return builder;
    }),
  };
}
let serviceMock: ReturnType<typeof makeServiceMock>;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceMock,
}));

const { GET, POST: createModule } = await import("@/app/api/ops/modules/route");
const { PATCH: patchModule, DELETE: deleteModule } = await import(
  "@/app/api/ops/modules/[id]/route"
);
const { POST: setGrant, DELETE: clearGrant } = await import(
  "@/app/api/ops/modules/grants/route"
);

const FORBIDDEN = { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
const UNAUTH = { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function rawReq(url: string, method: string, raw: string) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: raw,
  });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  gate = { ok: true, userId: "superadmin-1", access: {} };
  serviceMock = makeServiceMock();
  responses = [];
  mockRecordAudit.mockClear();
});

// ── Authz: non-superadmin is blocked on every route (test plan: 401/403) ──
describe("authz — superadmin gate is enforced on all routes", () => {
  it("GET 403 for non-superadmin", async () => {
    gate = FORBIDDEN;
    expect((await GET()).status).toBe(403);
  });
  it("POST /modules 403 for non-superadmin, with no audit + no DB write", async () => {
    gate = FORBIDDEN;
    const res = await createModule(jsonReq("/api/ops/modules", "POST", { slug: "qa", displayName: "QA" }));
    expect(res.status).toBe(403);
    expect(serviceMock.from).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
  it("PATCH /modules/[id] 401 when unauthenticated", async () => {
    gate = UNAUTH;
    const res = await patchModule(jsonReq("/api/ops/modules/m1", "PATCH", { displayName: "X" }), idParams("m1"));
    expect(res.status).toBe(401);
  });
  it("DELETE /modules/[id] 403 for non-superadmin", async () => {
    gate = FORBIDDEN;
    expect((await deleteModule(jsonReq("/api/ops/modules/m1", "DELETE", {}), idParams("m1"))).status).toBe(403);
  });
  it("POST /grants 403 for non-superadmin", async () => {
    gate = FORBIDDEN;
    const res = await setGrant(
      jsonReq("/api/ops/modules/grants", "POST", { moduleId: "11111111-1111-4111-8111-111111111111", role: "customer", effect: "allow" })
    );
    expect(res.status).toBe(403);
  });
});

// ── Negative inputs: 400 / 422 / 409 / 404 (test plan negatives) ──────────
describe("negative inputs return the documented status codes", () => {
  it("malformed JSON → 400 (modules POST)", async () => {
    expect((await createModule(rawReq("/api/ops/modules", "POST", "not json{"))).status).toBe(400);
  });
  it("malformed JSON → 400 (grants POST)", async () => {
    expect((await setGrant(rawReq("/api/ops/modules/grants", "POST", "{bad"))).status).toBe(400);
  });

  it("schema-invalid slug (too short) → 422", async () => {
    expect((await createModule(jsonReq("/api/ops/modules", "POST", { slug: "a", displayName: "QA" }))).status).toBe(422);
  });
  it("normalizer-invalid slug (illegal chars) → 422", async () => {
    const res = await createModule(jsonReq("/api/ops/modules", "POST", { slug: "Bad Slug!", displayName: "QA" }));
    expect(res.status).toBe(422);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
  it("invalid grant effect → 422", async () => {
    const res = await setGrant(
      jsonReq("/api/ops/modules/grants", "POST", { moduleId: "11111111-1111-4111-8111-111111111111", role: "customer", effect: "maybe" })
    );
    expect(res.status).toBe(422);
  });

  it("duplicate slug (Postgres 23505) → 409", async () => {
    responses = [{ data: null, error: { code: "23505", message: "duplicate key" } }];
    const res = await createModule(jsonReq("/api/ops/modules", "POST", { slug: "dup-module", displayName: "Dup" }));
    expect(res.status).toBe(409);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("PATCH unknown module id → 404", async () => {
    responses = [{ data: null, error: { message: "no rows" } }];
    const res = await patchModule(jsonReq("/api/ops/modules/ghost", "PATCH", { displayName: "X" }), idParams("ghost"));
    expect(res.status).toBe(404);
  });
  it("DELETE unknown module id → 404", async () => {
    responses = [{ data: null, error: { message: "no rows" } }];
    expect((await deleteModule(jsonReq("/api/ops/modules/ghost", "DELETE", {}), idParams("ghost"))).status).toBe(404);
  });
  it("grant on unknown module id → 404", async () => {
    responses = [{ data: null, error: null }]; // ensureModule maybeSingle → null
    const res = await setGrant(
      jsonReq("/api/ops/modules/grants", "POST", { moduleId: "11111111-1111-4111-8111-111111111111", role: "customer", effect: "allow" })
    );
    expect(res.status).toBe(404);
  });
});

// ── Golden path: every successful mutation writes exactly one audit row ────
describe("audit trail — each successful mutation records its access_audit row", () => {
  it("create module → 201 + audit module.visibility.set / op=create", async () => {
    responses = [
      { data: { id: "mod-1", slug: "qa-module", display_name: "QA Module", audience: "customer", min_tier_slug: null, default_visibility: "visible" }, error: null },
    ];
    const res = await createModule(jsonReq("/api/ops/modules", "POST", { slug: "qa-module", displayName: "QA Module" }));
    expect(res.status).toBe(201);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    const ev = mockRecordAudit.mock.calls[0][0] as { action: string; actorProfileId: string; payload: { op: string; moduleId: string } };
    expect(ev.action).toBe("module.visibility.set");
    expect(ev.actorProfileId).toBe("superadmin-1");
    expect(ev.payload.op).toBe("create");
    expect(ev.payload.moduleId).toBe("mod-1");
  });

  it("edit module → 200 + audit op=update with before/after", async () => {
    responses = [
      { data: { id: "mod-1", slug: "qa-module", display_name: "Old", audience: "customer", min_tier_slug: null, default_visibility: "visible" }, error: null },
      { data: { id: "mod-1", slug: "qa-module", display_name: "New", audience: "customer", min_tier_slug: null, default_visibility: "visible" }, error: null },
    ];
    const res = await patchModule(jsonReq("/api/ops/modules/mod-1", "PATCH", { displayName: "New" }), idParams("mod-1"));
    expect(res.status).toBe(200);
    const ev = mockRecordAudit.mock.calls[0][0] as { action: string; payload: { op: string } };
    expect(ev.action).toBe("module.visibility.set");
    expect(ev.payload.op).toBe("update");
  });

  it("delete module → 200 + audit op=delete", async () => {
    responses = [
      { data: { id: "mod-1", slug: "qa-module", display_name: "QA Module" }, error: null }, // load existing
      { error: null }, // delete
    ];
    const res = await deleteModule(jsonReq("/api/ops/modules/mod-1", "DELETE", {}), idParams("mod-1"));
    expect(res.status).toBe(200);
    const ev = mockRecordAudit.mock.calls[0][0] as { payload: { op: string } };
    expect(ev.payload.op).toBe("delete");
  });

  it("grant allow → 201 + audit action module_access.grant", async () => {
    responses = [
      { data: { id: "mod-1", slug: "qa-module" }, error: null }, // ensureModule
      { error: null }, // clear existing role grant
      { data: { id: "grant-1", module_id: "mod-1", role: "customer", effect: "allow" }, error: null }, // insert
    ];
    const res = await setGrant(
      jsonReq("/api/ops/modules/grants", "POST", { moduleId: "11111111-1111-4111-8111-111111111111", role: "customer", effect: "allow" })
    );
    expect(res.status).toBe(201);
    expect((mockRecordAudit.mock.calls[0][0] as { action: string }).action).toBe("module_access.grant");
  });

  it("grant deny → audit action module_access.deny", async () => {
    responses = [
      { data: { id: "mod-1", slug: "qa-module" }, error: null },
      { error: null },
      { data: { id: "grant-2", module_id: "mod-1", role: "psg_internal", effect: "deny" }, error: null },
    ];
    await setGrant(
      jsonReq("/api/ops/modules/grants", "POST", { moduleId: "11111111-1111-4111-8111-111111111111", role: "psg_internal", effect: "deny" })
    );
    expect((mockRecordAudit.mock.calls[0][0] as { action: string }).action).toBe("module_access.deny");
  });

  it("clear grant (inherit) → 200 + audit action module_access.clear", async () => {
    responses = [
      { data: { id: "mod-1", slug: "qa-module" }, error: null }, // ensureModule
      { error: null }, // delete
    ];
    const res = await clearGrant(
      jsonReq("/api/ops/modules/grants", "DELETE", { moduleId: "11111111-1111-4111-8111-111111111111", role: "customer" })
    );
    expect(res.status).toBe(200);
    expect((mockRecordAudit.mock.calls[0][0] as { action: string }).action).toBe("module_access.clear");
  });
});
