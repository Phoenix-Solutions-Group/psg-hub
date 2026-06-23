import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { ApprovalQueueRow, ApprovalQueueStore, ApprovalStatus } from "@/lib/ops/approval-queue/gate";

// PSG-245 / Wave 2 (G-d) — approve/reject decision routes. Exercises the route
// gating (auth → RLS-scoped load → owner/manager membership), the real
// orchestration (run against an in-memory store), and the append-only audit
// write. The supabase clients + audit sink are mocked; supabaseApprovalQueueStore
// is overridden to return the in-memory store so the genuine approveApproval /
// rejectApproval logic executes.

type User = { id: string } | null;
let mockUser: User = null;
let mockRow: Record<string, unknown> | null = null;
let mockMembership: { role: string } | null = null;

const auditEvents: Array<Record<string, unknown>> = [];

/** Shared in-memory store the mocked supabaseApprovalQueueStore returns. */
function memoryStore(): ApprovalQueueStore & { rows: Map<string, ApprovalQueueRow> } {
  const rows = new Map<string, ApprovalQueueRow>();
  return {
    rows,
    async insert(row) {
      const id = row.id ?? "apr-1";
      const stored = { ...row, id };
      rows.set(id, stored);
      return stored;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async update(id, patch) {
      const cur = rows.get(id);
      if (!cur) throw new Error(`no row ${id}`);
      const next = { ...cur, ...patch };
      rows.set(id, next);
      return next;
    },
    async listByShop(shopId, statuses?: ApprovalStatus[]) {
      return [...rows.values()].filter(
        (r) => r.shop_id === shopId && (!statuses || statuses.includes(r.status))
      );
    },
  };
}
let store: ReturnType<typeof memoryStore>;

function serverClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "approval_queue") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
            }),
          }),
        };
      }
      if (table === "shop_users") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockMembership, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    auditEvents.push(e);
    return "audit-1";
  }),
}));
vi.mock("@/lib/ops/approval-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ops/approval-queue")>();
  return { ...actual, supabaseApprovalQueueStore: vi.fn(() => store) };
});
// PSG-247 — these PSG-245 route tests assert the gate's "no registered publisher →
// approved" invariant. The approve route now injects the live serverPublishers
// (gbp_post → GBP local post); stub it EMPTY here so this suite keeps testing the
// generic gating/orchestration in isolation. The live publish wiring is covered in
// approve-publish.test.ts (controllable fake) + the publisher/client unit tests.
vi.mock("@/lib/ops/approval-queue/publishers", () => ({ serverPublishers: {} }));

import { POST as approve } from "../[id]/approve/route";
import { POST as reject } from "../[id]/reject/route";
import { POST as enqueue } from "../route";

const SHOP_UUID = "11111111-1111-4111-8111-111111111111";
const enqueueReq = (body: unknown) =>
  new Request("http://test/api/approvals", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;

const ctx = { params: Promise.resolve({ id: "apr-1" }) };
const req = (body?: unknown) =>
  new Request("http://test/api/approvals/apr-1/approve", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;

beforeEach(async () => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "manager" };
  mockRow = { id: "apr-1", shop_id: "shop-1", action_type: "gbp_post", status: "pending" };
  auditEvents.length = 0;
  store = memoryStore();
  await store.insert({
    id: "apr-1",
    shop_id: "shop-1",
    action_type: "gbp_post",
    title: "Draft GBP post",
    summary: null,
    payload_jsonb: {},
    status: "pending",
    proposed_by: "agent:autopilot",
    decided_by_profile_id: null,
    decided_by_name: null,
    decided_at: null,
    decision_notes: null,
    published_at: null,
    publish_error: null,
  });
});

describe("POST /api/approvals/[id]/approve", () => {
  it("approves a pending row and writes an approval.approve audit event", async () => {
    const res = await approve(req({ notes: "looks good" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    // No publisher is registered for gbp_post yet → approved (not fabricated-published).
    expect(body.approval.status).toBe("approved");
    expect(body.approval.decided_by_profile_id).toBe("user-1");
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe("approval.approve");
    expect(auditEvents[0].targetShopId).toBe("shop-1");
    expect((auditEvents[0].payload as Record<string, unknown>).published).toBe(false);
  });

  it("401 when unauthenticated", async () => {
    mockUser = null;
    const res = await approve(req(), ctx);
    expect(res.status).toBe(401);
    expect(auditEvents).toHaveLength(0);
  });

  it("404 when the row is not visible (RLS) / missing", async () => {
    mockRow = null;
    const res = await approve(req(), ctx);
    expect(res.status).toBe(404);
  });

  it("403 when the caller is only a viewer", async () => {
    mockMembership = { role: "viewer" };
    const res = await approve(req(), ctx);
    expect(res.status).toBe(403);
    expect(auditEvents).toHaveLength(0);
  });

  it("403 when the caller has no membership on the shop", async () => {
    mockMembership = null;
    const res = await approve(req(), ctx);
    expect(res.status).toBe(403);
  });

  it("409 when the row was already decided", async () => {
    await store.update("apr-1", { status: "rejected" });
    const res = await approve(req(), ctx);
    expect(res.status).toBe(409);
  });
});

describe("POST /api/approvals/[id]/reject", () => {
  it("rejects a pending row and writes an approval.reject audit event (never publishes)", async () => {
    const res = await reject(req({ notes: "off-brand" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approval.status).toBe("rejected");
    expect(body.approval.published_at).toBeNull();
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe("approval.reject");
  });

  it("403 for a viewer", async () => {
    mockMembership = { role: "viewer" };
    const res = await reject(req(), ctx);
    expect(res.status).toBe(403);
  });

  it("409 when already decided", async () => {
    await store.update("apr-1", { status: "approved" });
    const res = await reject(req(), ctx);
    expect(res.status).toBe(409);
  });
});

describe("POST /api/approvals (enqueue)", () => {
  const valid = { shopId: SHOP_UUID, actionType: "gbp_post", title: "Spring promo post" };

  it("queues a pending action for an owner/manager (201)", async () => {
    const res = await enqueue(enqueueReq(valid));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.approval.status).toBe("pending");
    expect(body.approval.action_type).toBe("gbp_post");
    expect(body.approval.shop_id).toBe(SHOP_UUID);
  });

  it("401 when unauthenticated", async () => {
    mockUser = null;
    const res = await enqueue(enqueueReq(valid));
    expect(res.status).toBe(401);
  });

  it("403 when the caller is not owner/manager on the target shop", async () => {
    mockMembership = { role: "viewer" };
    const res = await enqueue(enqueueReq(valid));
    expect(res.status).toBe(403);
  });

  it("422 on an invalid body (missing title)", async () => {
    const res = await enqueue(enqueueReq({ shopId: SHOP_UUID, actionType: "gbp_post" }));
    expect(res.status).toBe(422);
  });
});
