import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type {
  ApprovalQueueRow,
  ApprovalQueueStore,
  ApprovalStatus,
  Publisher,
} from "@/lib/ops/approval-queue/gate";

// PSG-768 (B3/A1) — proves the retry route re-attempts the publish for a
// publish_failed row through the injected live registry, branches the returned
// status honestly, and enforces the same auth/role gate as approve.

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

import { POST as retry } from "../[id]/retry/route";

const ctx = { params: Promise.resolve({ id: "apr-1" }) };
const req = () =>
  new Request("http://test/api/approvals/apr-1/retry", { method: "POST" }) as unknown as NextRequest;

beforeEach(async () => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "owner" };
  mockRow = { id: "apr-1", shop_id: "shop-1", action_type: "gbp_post", status: "publish_failed" };
  auditEvents.length = 0;
  publisherSpy.mockClear();
  publisherImpl = async () => ({ ref: "accounts/111/locations/555/localPosts/xyz" });
  store = memoryStore();
  await store.insert({
    id: "apr-1",
    shop_id: "shop-1",
    action_type: "gbp_post",
    title: "Spring promo",
    summary: "Spring promo",
    payload_jsonb: { summary: "Spring promo" },
    status: "publish_failed",
    proposed_by: "agent:gbp",
    decided_by_profile_id: "user-1",
    decided_by_name: "Owner",
    decided_at: "2026-06-24T12:00:00.000Z",
    decision_notes: "ship it",
    published_at: null,
    publish_error: "GBP API 503",
  });
});

describe("retry route → re-publish a failed approval", () => {
  it("re-publishes on retry (status published, audit published=true)", async () => {
    const res = await retry(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(publisherSpy).toHaveBeenCalledOnce();
    expect(body.approval.status).toBe("published");
    expect(body.approval.publish_error).toBeNull();
    // Original decision is preserved through the retry.
    expect(body.approval.decided_by_profile_id).toBe("user-1");
    expect(auditEvents[0].action).toBe("approval.retry_publish");
    expect((auditEvents[0].payload as Record<string, unknown>).published).toBe(true);
  });

  it("stays publish_failed when the retry publisher throws again", async () => {
    publisherImpl = async () => {
      throw new Error("GBP rejected again");
    };
    const res = await retry(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approval.status).toBe("publish_failed");
    expect(body.approval.publish_error).toMatch(/rejected again/i);
    expect((auditEvents[0].payload as Record<string, unknown>).published).toBe(false);
  });

  it("409s when the row is not publish_failed (e.g. already published)", async () => {
    store.rows.get("apr-1")!.status = "published";
    const res = await retry(req(), ctx);
    expect(res.status).toBe(409);
    expect(publisherSpy).not.toHaveBeenCalled();
  });

  it("403s a caller who is not an owner/manager on the shop", async () => {
    mockMembership = null;
    const res = await retry(req(), ctx);
    expect(res.status).toBe(403);
    expect(publisherSpy).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated caller", async () => {
    mockUser = null;
    const res = await retry(req(), ctx);
    expect(res.status).toBe(401);
  });
});
