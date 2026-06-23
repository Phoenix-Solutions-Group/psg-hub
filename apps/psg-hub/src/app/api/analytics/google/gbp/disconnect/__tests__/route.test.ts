import { describe, it, expect, vi, beforeEach } from "vitest";

// PSG-247 — GBP disconnect (revoke) route: auth → owner gate → load linked gbp
// account → best-effort revoke at Google → flip row to `revoked` → audit
// gbp.disconnect. The supabase clients, crypto, revoke + audit sink are mocked.

let mockUser: { id: string } | null = null;
let mockMembership: { role: string } | null = null;
let mockAccount: Record<string, unknown> | null = null;
let updatePatch: Record<string, unknown> | null = null;
const auditEvents: Array<Record<string, unknown>> = [];

let revokeReturn = true;
let decryptThrows = false;
const revokeSpy = vi.fn(async () => revokeReturn);
const decryptSpy = vi.fn(() => {
  if (decryptThrows) throw new Error("decrypt failed");
  return "refresh-token";
});

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
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn().mockReturnValue({
      // select(...).eq().eq().eq().order().limit().maybeSingle()
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockAccount, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
      // update(patch).eq(id) -> { error }
      update: vi.fn().mockImplementation((patch: Record<string, unknown>) => {
        updatePatch = patch;
        return { eq: vi.fn().mockResolvedValue({ error: null }) };
      }),
    }),
  })),
}));
vi.mock("@/lib/google-ads/crypto", () => ({ decryptRefreshToken: () => decryptSpy() }));
vi.mock("@/lib/google-ads/oauth", () => ({ revokeAtGoogle: () => revokeSpy() }));
vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    auditEvents.push(e);
    return "audit-1";
  }),
}));

import { POST } from "../route";

const SHOP = "11111111-1111-4111-8111-111111111111";
const reqOf = (body: unknown) =>
  new Request("http://test/api/analytics/google/gbp/disconnect", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "owner" };
  mockAccount = {
    id: "acc-1",
    encrypted_refresh_token: "\\xdeadbeef",
    key_version: 1,
    status: "linked",
  };
  updatePatch = null;
  auditEvents.length = 0;
  revokeReturn = true;
  decryptThrows = false;
  revokeSpy.mockClear();
  decryptSpy.mockClear();
});

describe("POST /api/analytics/google/gbp/disconnect", () => {
  it("revokes at Google, flips the row to revoked, and audits gbp.disconnect (owner)", async () => {
    const res = await POST(reqOf({ shop_id: SHOP }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.google_revoked).toBe(true);
    expect(body.revoked_at).toBeTruthy();
    expect(revokeSpy).toHaveBeenCalledOnce();
    expect(updatePatch).toMatchObject({ status: "revoked" });
    expect(updatePatch?.revoked_at).toBeTruthy();
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe("gbp.disconnect");
    expect(auditEvents[0].targetShopId).toBe(SHOP);
    expect((auditEvents[0].payload as Record<string, unknown>).googleRevoked).toBe(true);
  });

  it("401 when unauthenticated", async () => {
    mockUser = null;
    expect((await POST(reqOf({ shop_id: SHOP }))).status).toBe(401);
  });

  it("400 when shop_id is missing", async () => {
    expect((await POST(reqOf({}))).status).toBe(400);
  });

  it("403 when the caller is a manager (owner-only)", async () => {
    mockMembership = { role: "manager" };
    expect((await POST(reqOf({ shop_id: SHOP }))).status).toBe(403);
  });

  it("403 when the caller has no membership", async () => {
    mockMembership = null;
    expect((await POST(reqOf({ shop_id: SHOP }))).status).toBe(403);
  });

  it("404 when there is no linked gbp account", async () => {
    mockAccount = null;
    const res = await POST(reqOf({ shop_id: SHOP }));
    expect(res.status).toBe(404);
    expect(auditEvents).toHaveLength(0);
  });

  it("still flips the row to revoked when decrypt/revoke fails (google_revoked false)", async () => {
    decryptThrows = true;
    const res = await POST(reqOf({ shop_id: SHOP }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.google_revoked).toBe(false);
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(updatePatch).toMatchObject({ status: "revoked" });
    expect((auditEvents[0].payload as Record<string, unknown>).googleRevoked).toBe(false);
  });
});
