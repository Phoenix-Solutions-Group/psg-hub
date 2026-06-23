import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { CccAccountRow, CccAccountStore } from "@/lib/ccc/approval-queue";
import type { CccConnectionStatus } from "@/lib/ccc/connection-state";

// PSG-267 / Phase 3 — approve/decline/revoke routes. Exercises the REAL superadmin gate
// (requireSuperadmin → getOpsAccess over a mocked service client), the genuine state-machine
// orchestration (run against an in-memory store), and the append-only audit write. Proves the
// gate fails CLOSED for unauth + non-superadmin before any mutation.

type User = { id: string } | null;
let mockUser: User = null;
let mockRole: string | null = null;
const auditEvents: Array<Record<string, unknown>> = [];

function memoryStore(): CccAccountStore & {
  rows: Map<string, CccAccountRow>;
  seed: (over?: Partial<CccAccountRow>) => CccAccountRow;
} {
  const rows = new Map<string, CccAccountRow>();
  return {
    rows,
    seed(over = {}) {
      const row: CccAccountRow = {
        id: "ccc-1",
        shop_id: "shop-1",
        ccc_account_id: "ACME-001",
        facility_id: "88231",
        connection_status: "pending_review",
        enabled_at: null,
        last_event_at: null,
        last_event_label: null,
        approved_by: null,
        approved_at: null,
        declined_reason: null,
        error_reason: null,
        ...over,
      };
      rows.set(row.id, row);
      return row;
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
    async list(statuses?: CccConnectionStatus[]) {
      return [...rows.values()].filter((r) => !statuses || statuses.includes(r.connection_status));
    },
  };
}
let store: ReturnType<typeof memoryStore>;

/** Minimal service client covering getOpsAccess()'s three reads. */
function serviceClient() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "app_user_roles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: mockRole ? { role: mockRole } : null }) }),
          }),
        };
      }
      if (table === "security_profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          }),
        };
      }
      if (table === "user_security_profile_assignments") {
        return { select: () => ({ eq: async () => ({ data: [] }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceClient()),
}));
vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    auditEvents.push(e);
    return "audit-1";
  }),
}));
vi.mock("@/lib/ccc/account-store", () => ({
  supabaseCccAccountStore: vi.fn(() => store),
}));

import { POST as approve } from "../[id]/approve/route";
import { POST as decline } from "../[id]/decline/route";
import { POST as revoke } from "../[id]/revoke/route";

const ctx = { params: Promise.resolve({ id: "ccc-1" }) };
const SHOP_UUID = "11111111-1111-4111-8111-111111111111";
const req = (body?: unknown) =>
  new Request("http://test/api/ops/admin/integrations/ccc/ccc-1/approve", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }) as unknown as NextRequest;

beforeEach(() => {
  mockUser = { id: "super-1" };
  mockRole = "psg_superadmin";
  auditEvents.length = 0;
  store = memoryStore();
});

describe("superadmin gate fails closed", () => {
  it("401 when unauthenticated (no mutation, no audit)", async () => {
    store.seed();
    mockUser = null;
    for (const [name, fn] of [["approve", approve], ["decline", decline], ["revoke", revoke]] as const) {
      const res = await fn(req({ reason: "x" }), ctx);
      expect(res.status, name).toBe(401);
    }
    expect(store.rows.get("ccc-1")!.connection_status).toBe("pending_review");
    expect(auditEvents).toHaveLength(0);
  });

  it("403 for a non-superadmin ops user", async () => {
    store.seed();
    mockRole = "psg_internal";
    const res = await approve(req({ shopId: SHOP_UUID }), ctx);
    expect(res.status).toBe(403);
    expect(auditEvents).toHaveLength(0);
  });
});

describe("approve route", () => {
  it("approves a linked pending row → connected + audit", async () => {
    store.seed({ shop_id: SHOP_UUID });
    const res = await approve(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.connection_status).toBe("connected");
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe("ccc.connection.approve");
    expect(auditEvents[0].targetShopId).toBe(SHOP_UUID);
  });

  it("AC: orphan (unmatched) approve → 409, no audit", async () => {
    store.seed({ shop_id: null });
    const res = await approve(req(), ctx);
    expect(res.status).toBe(409);
    expect(auditEvents).toHaveLength(0);
    expect(store.rows.get("ccc-1")!.connection_status).toBe("pending_review");
  });

  it("links + approves an unmatched row when shopId is supplied", async () => {
    store.seed({ shop_id: null });
    const res = await approve(req({ shopId: SHOP_UUID }), ctx);
    expect(res.status).toBe(200);
    expect(store.rows.get("ccc-1")!.shop_id).toBe(SHOP_UUID);
  });
});

describe("decline route", () => {
  it("declines with a reason → declined + audit", async () => {
    store.seed();
    const res = await decline(req({ reason: "Shop not onboarded yet" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.connection_status).toBe("declined");
    expect(body.account.declined_reason).toBe("Shop not onboarded yet");
    expect(auditEvents[0].action).toBe("ccc.connection.decline");
  });

  it("AC: missing reason → 422, no mutation", async () => {
    store.seed();
    const res = await decline(req({}), ctx);
    expect(res.status).toBe(422);
    expect(store.rows.get("ccc-1")!.connection_status).toBe("pending_review");
    expect(auditEvents).toHaveLength(0);
  });
});

describe("revoke route", () => {
  it("revokes a connected row → not_connected + audit", async () => {
    store.seed({ connection_status: "connected" });
    const res = await revoke(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.connection_status).toBe("not_connected");
    expect(auditEvents[0].action).toBe("ccc.connection.revoke");
  });

  it("revoke on a pending row → 409", async () => {
    store.seed({ connection_status: "pending_review" });
    const res = await revoke(req(), ctx);
    expect(res.status).toBe(409);
  });
});
