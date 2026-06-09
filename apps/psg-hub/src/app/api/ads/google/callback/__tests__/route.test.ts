import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/google-ads/oauth", () => {
  class StateError extends Error {
    constructor(public code: string) {
      super(code);
      this.name = "StateError";
    }
  }
  return {
    StateError,
    peekState: vi.fn(),
    verifyAndConsumeState: vi.fn(),
    stashPendingSelection: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
  };
});
vi.mock("@/lib/google-ads/crypto", () => ({
  encryptRefreshToken: vi.fn(() => ({ ciphertext: Buffer.from("ab", "hex"), keyVersion: 1 })),
}));
vi.mock("@/lib/google-ads/customers", () => ({ listManagedAccounts: vi.fn() }));
vi.mock("@/lib/google-ads/link", () => ({ persistLinkedAccount: vi.fn() }));

let mockUser: { id: string } | null = { id: "u1" };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));

const oauth = await import("@/lib/google-ads/oauth");
const { listManagedAccounts } = await import("@/lib/google-ads/customers");
const { persistLinkedAccount } = await import("@/lib/google-ads/link");
const { GET } = await import("@/app/api/ads/google/callback/route");

function req() {
  return new Request("http://localhost/api/ads/google/callback?code=c&state=st");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { id: "u1" };
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev";
  process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = "6935795509";
  vi.mocked(oauth.peekState).mockResolvedValue({ userId: "u1", shopId: "s1" });
  vi.mocked(oauth.exchangeCodeForTokens).mockResolvedValue({
    access_token: "at",
    refresh_token: "rt",
    scope: "scope",
    expires_in: 3600,
  });
  vi.mocked(oauth.verifyAndConsumeState).mockResolvedValue({ userId: "u1", shopId: "s1" });
  vi.mocked(oauth.stashPendingSelection).mockResolvedValue(undefined);
  vi.mocked(persistLinkedAccount).mockResolvedValue({ error: null });
  vi.mocked(listManagedAccounts).mockReset();
});

describe("GET /api/ads/google/callback (MCC)", () => {
  it("multiple accounts → renders the picker, stashes, does NOT persist or consume", async () => {
    vi.mocked(listManagedAccounts).mockResolvedValue([
      { id: "6048611995", name: "Wallace" },
      { id: "1234567890", name: "Tracy's" },
    ]);
    const res = await GET(req());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('action="/api/ads/google/select"');
    expect(html).toContain("6048611995");
    expect(html).toContain("Wallace");
    expect(oauth.stashPendingSelection).toHaveBeenCalledOnce();
    expect(persistLinkedAccount).not.toHaveBeenCalled();
    expect(oauth.verifyAndConsumeState).not.toHaveBeenCalled();
  });

  it("exactly one account → auto-links (consume + persist), success", async () => {
    vi.mocked(listManagedAccounts).mockResolvedValue([{ id: "6048611995", name: "Wallace" }]);
    const res = await GET(req());
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("linked");
    expect(oauth.verifyAndConsumeState).toHaveBeenCalledOnce();
    expect(persistLinkedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "6048611995", loginCustomerId: "6935795509" })
    );
    expect(oauth.stashPendingSelection).not.toHaveBeenCalled();
  });

  it("no accessible client accounts → 400", async () => {
    vi.mocked(listManagedAccounts).mockResolvedValue([]);
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(persistLinkedAccount).not.toHaveBeenCalled();
  });

  it("session user mismatch → 403, no token exchange", async () => {
    mockUser = { id: "intruder" };
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(oauth.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it("invalid state → 400", async () => {
    vi.mocked(oauth.peekState).mockRejectedValue(new oauth.StateError("replayed"));
    const res = await GET(req());
    expect(res.status).toBe(400);
  });
});
