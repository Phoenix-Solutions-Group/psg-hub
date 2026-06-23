import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type {
  ApprovalQueueRow,
  ApprovalQueueStore,
  ApprovalStatus,
  Publisher,
} from "@/lib/ops/approval-queue/gate";

// PSG-247 — proves the approve route INJECTS the live serverPublishers registry,
// so an approved gbp_post actually publishes (vs. the gate's empty default). The
// publishers module is mocked with a CONTROLLABLE fake publisher; the genuine
// approveApproval orchestration runs against an in-memory store.

let mockUser: { id: string } | null = null;
let mockRow: Record<string, unknown> | null = null;
let mockMembership: { role: string } | null = null;
const auditEvents: Array<Record<string, unknown>> = [];

let publisherImpl: Publisher;
const publisherSpy = vi.fn((row: ApprovalQueueRow) => publisherImpl(row));

function memoryStore(): ApprovalQueueStore & { rows: Map<string, ApprovalQueueRow> } {
  const rows = new Map<string, ApprovalQueueRow>();
  return {
    rows,
    async insert(r) {
      const id = r.id ?? "apr-1";
      rows.set(id, { ...r, id });
      return rows.get(id)!;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async update(id, patch) {
      const next = { ...rows.get(id)!, ...patch };
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
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockMembership, error: null }),
            }),
          }),
        }),
      };
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => serverClient()) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(() => ({})) }));
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
vi.mock("@/lib/ops/approval-queue/publishers", () => ({
  serverPublishers: { gbp_post: (row: ApprovalQueueRow) => publisherSpy(row) },
}));

import { POST as approve } from "../[id]/approve/route";

const ctx = { params: Promise.resolve({ id: "apr-1" }) };
const req = (body?: unknown) =>
  new Request("http://test/api/approvals/apr-1/approve", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;

beforeEach(async () => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "owner" };
  mockRow = { id: "apr-1", shop_id: "shop-1", action_type: "gbp_post", status: "pending" };
  auditEvents.length = 0;
  publisherSpy.mockClear();
  publisherImpl = async () => ({ ref: "accounts/111/locations/555/localPosts/abc" });
  store = memoryStore();
  await store.insert({
    id: "apr-1",
    shop_id: "shop-1",
    action_type: "gbp_post",
    title: "Spring promo",
    summary: "Spring promo",
    payload_jsonb: { summary: "Spring promo" },
    status: "pending",
    proposed_by: "agent:gbp",
    decided_by_profile_id: null,
    decided_by_name: null,
    decided_at: null,
    decision_notes: null,
    published_at: null,
    publish_error: null,
  });
});

describe("approve route → live publisher wiring", () => {
  it("publishes an approved gbp_post via the injected registry (status published, audit published=true)", async () => {
    const res = await approve(req({ notes: "ship it" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(publisherSpy).toHaveBeenCalledOnce();
    expect(publisherSpy.mock.calls[0][0].id).toBe("apr-1");
    expect(body.approval.status).toBe("published");
    expect(body.approval.published_at).not.toBeNull();
    expect(auditEvents[0].action).toBe("approval.approve");
    expect((auditEvents[0].payload as Record<string, unknown>).published).toBe(true);
  });

  it("records publish_failed (decision preserved) when the publisher throws", async () => {
    publisherImpl = async () => {
      throw new Error("GBP rejected the post");
    };
    const res = await approve(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approval.status).toBe("publish_failed");
    expect(body.approval.decided_by_profile_id).toBe("user-1"); // decision survived
    expect(body.approval.publish_error).toMatch(/rejected/i);
    expect((auditEvents[0].payload as Record<string, unknown>).published).toBe(false);
    expect((auditEvents[0].payload as Record<string, unknown>).publishError).toMatch(/rejected/i);
  });
});
