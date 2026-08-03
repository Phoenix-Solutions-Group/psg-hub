import { beforeEach, describe, expect, it, vi } from "vitest";

type User = { id: string } | null;

let mockUser: User = null;
let mockReview: { id: string; shop_id: string } | null = null;
let mockMembership: { role: "owner" | "manager" | "viewer" } | null = null;
let mockVersions: unknown[] = [];
let mockVersion: Record<string, unknown> | null = null;
let mockRestoreRequest: Record<string, unknown> | null = null;
let mockActiveResponse: Record<string, unknown> | null = null;
let mockInsertError: { code?: string; message: string } | null = null;
let mockUpdateReturnsRow = true;

const requireOpsFn = vi.fn();
const recordAuditEvent = vi.fn();

function chain(data: unknown, error: unknown = null, orderedData: unknown = data) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: orderedData, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    single: vi.fn().mockResolvedValue({ data, error }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: mockRestoreRequest,
          error: mockInsertError,
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: mockUpdateReturnsRow ? mockRestoreRequest : null,
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
}

function serverClient() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "review_items") return chain(mockReview);
      if (table === "shop_users") return chain(mockMembership);
      return chain(null);
    }),
  };
}

function serviceClient() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "review_response_versions") {
        return chain(mockVersion, null, mockVersions);
      }
      if (table === "review_response_restore_requests") {
        return chain(mockRestoreRequest);
      }
      if (table === "review_responses") {
        return chain(mockActiveResponse);
      }
      return chain(null);
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverClient()),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => serviceClient()),
}));

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: (...args: unknown[]) => requireOpsFn(...args),
}));

vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}));

const { GET: versionsGET } = await import("@/app/api/reviews/[id]/versions/route");
const { POST: restorePOST } = await import("@/app/api/reviews/[id]/restore-requests/route");
const { PATCH: opsRestorePATCH } = await import(
  "@/app/api/ops/reviews/restore-requests/[id]/route"
);

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

beforeEach(() => {
  mockUser = { id: "u1" };
  mockReview = { id: "r1", shop_id: "shopA" };
  mockMembership = { role: "owner" };
  mockVersions = [
    {
      id: "v1",
      version: 1,
      body: "old reply",
      status: "approved",
      recorded_at: "2026-07-17T00:00:00Z",
    },
  ];
  mockVersion = {
    review_response_id: "resp-1",
    review_item_id: "r1",
    shop_id: "shopA",
    version: 1,
    body: "old reply",
    status: "approved",
    tone_preset: "default",
    model_id: "m",
    prompt_version: "p",
    safety_flags: [],
    safety_overridden: false,
  };
  mockRestoreRequest = {
    id: "11111111-1111-1111-1111-111111111111",
    review_response_id: "resp-1",
    review_item_id: "r1",
    shop_id: "shopA",
    requested_version: 1,
    status: "pending",
    requested_by: "u1",
  };
  mockActiveResponse = { id: "resp-1", version: 3 };
  mockInsertError = null;
  mockUpdateReturnsRow = true;
  requireOpsFn.mockResolvedValue({
    ok: true,
    userId: "psg-1",
    access: { role: "psg_superadmin", functions: new Set() },
  });
  recordAuditEvent.mockResolvedValue("audit-1");
});

describe("review response versions", () => {
  it("lists version history for a shop member", async () => {
    const res = await versionsGET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.versions[0].version).toBe(1);
  });

  it("blocks version history across shops", async () => {
    mockMembership = null;
    const res = await versionsGET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("customer restore request", () => {
  it("creates a pending restore request for an existing version", async () => {
    const res = await restorePOST(req({ version: 1, reason: "Use the old copy" }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.request.status).toBe("pending");
  });

  it("returns 409 when the same version already has a pending request", async () => {
    mockInsertError = { code: "23505", message: "duplicate" };
    const res = await restorePOST(req({ version: 1 }), {
      params: Promise.resolve({ id: "r1" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("ops restore decision", () => {
  it("rejects a pending request and writes an audit event", async () => {
    const res = await opsRestorePATCH(
      req({ action: "reject", note: "Keep current response" }) as any,
      {
        params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }),
      },
    );
    expect(res.status).toBe(200);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "review_response_restore.reject" }),
    );
  });

  it("approves by restoring the old version as a new active version", async () => {
    const res = await opsRestorePATCH(req({ action: "approve" }) as any, {
      params: Promise.resolve({ id: "11111111-1111-1111-1111-111111111111" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.request.status).toBe("pending");
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "review_response_restore.approve",
        payload: expect.objectContaining({ restoredVersion: 4 }),
      }),
    );
  });
});
