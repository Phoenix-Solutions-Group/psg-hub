import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---
vi.mock("@/lib/google-oauth/state", () => {
  class StateError extends Error {
    constructor(public code: string) {
      super(code);
      this.name = "StateError";
    }
  }
  return { StateError, consumePendingSelection: vi.fn() };
});
vi.mock("@/lib/google-oauth/accounts", () => ({ persistLinkedAccount: vi.fn() }));

let mockUser: { id: string } | null = { id: "u1" };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  }),
}));

const { consumePendingSelection, StateError } = await import(
  "@/lib/google-oauth/state"
);
const { persistLinkedAccount } = await import("@/lib/google-oauth/accounts");
const { POST } = await import("@/app/api/analytics/google/select/route");

function req(body: unknown) {
  return new Request("http://localhost/api/analytics/google/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const GA4 = "properties/123";
const GSC = "sc-domain:acme.com";
const PENDING = {
  userId: "u1",
  shopId: "s1",
  pending: {
    encryptedTokenHex: "\\xabcd",
    keyVersion: 1,
    scope: "scope",
    accounts: {
      ga4: [{ id: GA4, name: "Acme GA4" }],
      gsc: [{ id: GSC, name: GSC }],
    },
  },
};

beforeEach(() => {
  mockUser = { id: "u1" };
  vi.mocked(consumePendingSelection).mockReset();
  vi.mocked(persistLinkedAccount).mockReset();
  vi.mocked(persistLinkedAccount).mockResolvedValue({ error: null });
});

describe("POST /api/analytics/google/select", () => {
  it("both picked -> 200, persists TWO rows (ga4 + gsc) sharing one token", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(req({ state: "st", ga4_id: GA4, gsc_id: GSC }));
    expect(res.status).toBe(200);
    expect(persistLinkedAccount).toHaveBeenCalledTimes(2);
    expect(persistLinkedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId: "s1",
        source: "ga4",
        externalAccountId: GA4,
        displayName: "Acme GA4",
        encryptedTokenHex: "\\xabcd",
        keyVersion: 1,
        linkedBy: "u1",
      })
    );
    expect(persistLinkedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ source: "gsc", externalAccountId: GSC })
    );
  });

  it("ga4 only -> 200, persists ONE ga4 row", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(req({ state: "st", ga4_id: GA4 }));
    expect(res.status).toBe(200);
    expect(persistLinkedAccount).toHaveBeenCalledTimes(1);
    expect(persistLinkedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ga4", externalAccountId: GA4 })
    );
  });

  it("gsc only (ga4 skipped with empty string) -> 200, persists ONE gsc row", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(req({ state: "st", ga4_id: "", gsc_id: GSC }));
    expect(res.status).toBe(200);
    expect(persistLinkedAccount).toHaveBeenCalledTimes(1);
    expect(persistLinkedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ source: "gsc", externalAccountId: GSC })
    );
  });

  it("neither picked -> 400, no consume, no persist", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(req({ state: "st", ga4_id: "", gsc_id: "" }));
    expect(res.status).toBe(400);
    expect(consumePendingSelection).not.toHaveBeenCalled();
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("tampered ga4 id (not offered) -> 400, no persist", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(req({ state: "st", ga4_id: "properties/999" }));
    expect(res.status).toBe(400);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("tampered gsc id (not offered) -> 400, no persist", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(req({ state: "st", gsc_id: "sc-domain:evil.com" }));
    expect(res.status).toBe(400);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("valid ga4 + tampered gsc -> 400, NEITHER persisted (anti-tamper is all-or-nothing on a bad pick)", async () => {
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(
      req({ state: "st", ga4_id: GA4, gsc_id: "sc-domain:evil.com" })
    );
    expect(res.status).toBe(400);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("session user != state user -> 403, no persist", async () => {
    mockUser = { id: "intruder" };
    vi.mocked(consumePendingSelection).mockResolvedValue(PENDING);
    const res = await POST(req({ state: "st", ga4_id: GA4 }));
    expect(res.status).toBe(403);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("not signed in -> 401", async () => {
    mockUser = null;
    const res = await POST(req({ state: "st", ga4_id: GA4 }));
    expect(res.status).toBe(401);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("missing state -> 400", async () => {
    const res = await POST(req({ ga4_id: GA4 }));
    expect(res.status).toBe(400);
  });

  it("replayed/invalid state -> 400", async () => {
    vi.mocked(consumePendingSelection).mockRejectedValue(
      new StateError("replayed")
    );
    const res = await POST(req({ state: "st", ga4_id: GA4 }));
    expect(res.status).toBe(400);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });
});
