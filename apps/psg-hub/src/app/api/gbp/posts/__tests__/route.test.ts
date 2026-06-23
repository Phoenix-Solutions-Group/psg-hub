import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type {
  ApprovalQueueRow,
  ApprovalQueueStore,
  ApprovalStatus,
} from "@/lib/ops/approval-queue/gate";
import type { LinkedAccount } from "@/lib/google-oauth/accounts";

// PSG-247 — the GBP draft route: auth → owner/manager gate → payload validation →
// connected-account guard → enqueue a `gbp_post` pending row. The supabase clients
// + getLinkedAccount + the queue store are mocked; the genuine enqueueApproval
// orchestration runs against an in-memory store.

let mockUser: { id: string } | null = null;
let mockMembership: { role: string } | null = null;
let mockLinked: LinkedAccount | null = null;

function memoryStore(): ApprovalQueueStore & { rows: Map<string, ApprovalQueueRow> } {
  const rows = new Map<string, ApprovalQueueRow>();
  let n = 0;
  return {
    rows,
    async insert(r) {
      const id = r.id ?? `apr-${++n}`;
      const stored = { ...r, id };
      rows.set(id, stored);
      return stored;
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async update(id, patch) {
      const cur = rows.get(id)!;
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: mockMembership, error: null }),
          }),
        }),
      }),
    }),
  })),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock("@/lib/google-oauth/accounts", () => ({
  getLinkedAccount: vi.fn(async () => mockLinked),
}));
vi.mock("@/lib/ops/approval-queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ops/approval-queue")>();
  return { ...actual, supabaseApprovalQueueStore: vi.fn(() => store) };
});

import { POST as draft } from "../route";

const SHOP = "11111111-1111-4111-8111-111111111111";
const linked: LinkedAccount = {
  accountId: "acc-1",
  externalAccountId: "locations/555",
  externalParentId: "accounts/111",
  refreshToken: "rt",
};
const reqOf = (body: unknown) =>
  new Request("http://test/api/gbp/posts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;

const valid = { shopId: SHOP, summary: "We now offer free collision estimates!" };

beforeEach(() => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "owner" };
  mockLinked = linked;
  store = memoryStore();
});

describe("POST /api/gbp/posts (draft GBP post)", () => {
  it("queues a pending gbp_post for an owner with a linked GBP location (201)", async () => {
    const res = await draft(reqOf(valid));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.approval.status).toBe("pending");
    expect(body.approval.action_type).toBe("gbp_post");
    expect(body.approval.shop_id).toBe(SHOP);
    // payload carries the validated post (summary + defaulted languageCode).
    expect(body.approval.payload_jsonb).toMatchObject({
      summary: valid.summary,
      languageCode: "en-US",
    });
    // title defaults from the summary.
    expect(body.approval.title).toBe(valid.summary);
  });

  it("queues a manager's draft with a CTA in the payload", async () => {
    mockMembership = { role: "manager" };
    const res = await draft(
      reqOf({ ...valid, callToAction: { actionType: "BOOK", url: "https://book.test" } })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.approval.payload_jsonb.callToAction).toEqual({
      actionType: "BOOK",
      url: "https://book.test",
    });
  });

  it("401 when unauthenticated", async () => {
    mockUser = null;
    expect((await draft(reqOf(valid))).status).toBe(401);
  });

  it("403 when the caller is only a viewer", async () => {
    mockMembership = { role: "viewer" };
    expect((await draft(reqOf(valid))).status).toBe(403);
  });

  it("422 on an empty summary", async () => {
    expect((await draft(reqOf({ shopId: SHOP, summary: "" }))).status).toBe(422);
  });

  it("422 on a non-CALL CTA missing its url", async () => {
    const res = await draft(reqOf({ ...valid, callToAction: { actionType: "BOOK" } }));
    expect(res.status).toBe(422);
  });

  it("409 when the shop has no linked Google Business Profile (don't queue an un-publishable post)", async () => {
    mockLinked = null;
    const res = await draft(reqOf(valid));
    expect(res.status).toBe(409);
    expect(store.rows.size).toBe(0);
  });
});
