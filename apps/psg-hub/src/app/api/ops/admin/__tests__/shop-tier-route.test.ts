import { beforeEach, describe, expect, it, vi } from "vitest";

const auditEvents: unknown[] = [];
const operations: unknown[] = [];

vi.mock("@/lib/auth/ops-access", () => ({
  requireSuperadmin: vi.fn(async () => ({ ok: true, userId: "super-1" })),
}));

vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: vi.fn(async (event) => {
    auditEvents.push(event);
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => service),
}));

const queues = new Map<string, Array<{ data: unknown; error: unknown }>>();

const service = {
  from(table: string) {
    let op = "select";
    let payload: unknown;

    const builder = {
      select() {
        if (op !== "update") op = "select";
        return builder;
      },
      update(nextPayload: unknown) {
        op = "update";
        payload = nextPayload;
        operations.push({ table, op, payload });
        return builder;
      },
      eq() {
        return builder;
      },
      maybeSingle: async () => dequeue(table, op),
      single: async () => dequeue(table, op),
    };

    return builder;
  },
};

function dequeue(table: string, op: string) {
  const key = `${table}:${op}`;
  const queue = queues.get(key);
  const next = queue?.shift();
  if (!next) {
    throw new Error(`No queued response for ${key}`);
  }
  return next;
}

function queue(table: string, op: string, response: { data: unknown; error: unknown }) {
  const key = `${table}:${op}`;
  queues.set(key, [...(queues.get(key) ?? []), response]);
}

function req(body: unknown) {
  return new Request("http://localhost/api/ops/admin/shops/shop-1/tier", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const route = await import("@/app/api/ops/admin/shops/[shopId]/tier/route");

describe("admin shop tier route", () => {
  beforeEach(() => {
    auditEvents.length = 0;
    operations.length = 0;
    queues.clear();
  });

  it("clears a shop tier and writes an audit event", async () => {
    queue("shops", "select", { data: { id: "shop-1", name: "Wallace", slug: "wallace" }, error: null });
    queue("subscriptions", "select", {
      data: { id: "sub-1", tier: "growth", status: "active" },
      error: null,
    });
    queue("subscriptions", "update", {
      data: { shop_id: "shop-1", tier: null, status: "active" },
      error: null,
    });

    const res = await route.PATCH(req({ tier: null }), {
      params: Promise.resolve({ shopId: "shop-1" }),
    });

    expect(res.status).toBe(200);
    expect(operations).toContainEqual({
      table: "subscriptions",
      op: "update",
      payload: { tier: null },
    });
    expect(auditEvents[0]).toMatchObject({
      actorProfileId: "super-1",
      action: "tier.change",
      targetShopId: "shop-1",
      payload: expect.objectContaining({ beforeTier: "growth", afterTier: null }),
    });
  });

  it("still accepts supported paid tiers", async () => {
    queue("shops", "select", { data: { id: "shop-1", name: "Wallace", slug: "wallace" }, error: null });
    queue("subscriptions", "select", {
      data: { id: "sub-1", tier: "essentials", status: "active" },
      error: null,
    });
    queue("subscriptions", "update", {
      data: { shop_id: "shop-1", tier: "growth", status: "active" },
      error: null,
    });

    const res = await route.PATCH(req({ tier: "growth" }), {
      params: Promise.resolve({ shopId: "shop-1" }),
    });

    expect(res.status).toBe(200);
    expect(operations).toContainEqual({
      table: "subscriptions",
      op: "update",
      payload: { tier: "growth" },
    });
  });
});
