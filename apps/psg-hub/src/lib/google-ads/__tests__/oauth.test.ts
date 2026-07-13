import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase service before importing the module under test
type StoredRow = {
  state_token: string;
  user_id: string;
  shop_id: string;
  consumed_at: string | null;
  expires_at: string;
  nonce: string;
};

let rows: StoredRow[] = [];

function serviceClient() {
  return {
    from: vi.fn((table: string) => {
      if (table !== "google_ads_oauth_states") {
        throw new Error(`unexpected table: ${table}`);
      }
      let filterToken: string | null = null;
      let filterConsumedNull = false;
      return {
        insert: vi.fn((payload: StoredRow) => {
          rows.push({ ...payload, consumed_at: null });
          return Promise.resolve({ error: null });
        }),
        delete: vi.fn(function (this: unknown) {
          return this as never;
        }),
        lt: vi.fn((col: string, val: string) => {
          if (col === "expires_at") {
            rows = rows.filter((r) => r.expires_at >= val);
          }
          return Promise.resolve({ error: null });
        }),
        update: vi.fn((patch: Partial<StoredRow>) => {
          const chain = {
            eq: vi.fn((col: string, val: string) => {
              if (col === "state_token") filterToken = val;
              return chain;
            }),
            is: vi.fn((col: string, val: unknown) => {
              if (col === "consumed_at" && val === null)
                filterConsumedNull = true;
              return chain;
            }),
            select: vi.fn(() => chain),
            maybeSingle: vi.fn(async () => {
              if (!filterToken) return { data: null, error: null };
              const match = rows.find(
                (r) =>
                  r.state_token === filterToken &&
                  (!filterConsumedNull || r.consumed_at === null)
              );
              if (!match) return { data: null, error: null };
              match.consumed_at = patch.consumed_at ?? null;
              return {
                data: { user_id: match.user_id, shop_id: match.shop_id },
                error: null,
              };
            }),
          };
          return chain;
        }),
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, val: string) => ({
            maybeSingle: vi.fn(async () => {
              const match = rows.find((r) => r.state_token === val);
              return {
                data: match ? { consumed_at: match.consumed_at } : null,
                error: null,
              };
            }),
          })),
        })),
      };
    }),
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient(),
}));

const {
  buildAuthorizeUrl,
  verifyAndConsumeState,
  StateError,
} = await import("@/lib/google-ads/oauth");

beforeEach(() => {
  rows = [];
});

describe("buildAuthorizeUrl", () => {
  it("returns a Google OAuth URL + inserts state row", async () => {
    const { url, stateToken } = await buildAuthorizeUrl({
      userId: "u1",
      shopId: "s1",
    });
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=test-ads-client-id");
    expect(url).toContain(encodeURIComponent("https://www.googleapis.com/auth/adwords"));
    expect(url).toContain(`state=${encodeURIComponent(stateToken)}`);
    expect(rows.length).toBe(1);
    expect(rows[0].state_token).toBe(stateToken);
    expect(rows[0].user_id).toBe("u1");
    expect(rows[0].shop_id).toBe("s1");
  });

  it("falls back to the shared OAuth client when Ads-specific env vars are absent", async () => {
    const adsClientId = process.env.GOOGLE_ADS_CLIENT_ID;
    const adsClientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
    delete process.env.GOOGLE_ADS_CLIENT_ID;
    delete process.env.GOOGLE_ADS_CLIENT_SECRET;

    try {
      const { url } = await buildAuthorizeUrl({
        userId: "u1",
        shopId: "s1",
      });
      expect(url).toContain("client_id=test-client-id");
    } finally {
      process.env.GOOGLE_ADS_CLIENT_ID = adsClientId;
      process.env.GOOGLE_ADS_CLIENT_SECRET = adsClientSecret;
    }
  });
});

describe("verifyAndConsumeState", () => {
  it("valid state → returns {userId, shopId} and consumes", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      userId: "u1",
      shopId: "s1",
    });
    const result = await verifyAndConsumeState(stateToken);
    expect(result).toEqual({ userId: "u1", shopId: "s1" });
    // Second call → replayed
    await expect(verifyAndConsumeState(stateToken)).rejects.toBeInstanceOf(
      StateError
    );
  });

  it("tampered HMAC → throws invalid_signature", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      userId: "u1",
      shopId: "s1",
    });
    const parts = stateToken.split(".");
    const tampered = `${parts[0]}.xxxxxx`;
    await expect(verifyAndConsumeState(tampered)).rejects.toMatchObject({
      code: "invalid_signature",
    });
  });

  it("unknown state token → throws not_found", async () => {
    // Build a validly-signed token but never insert it into rows.
    const { stateToken } = await buildAuthorizeUrl({
      userId: "u2",
      shopId: "s2",
    });
    rows = []; // wipe store, token is validly signed but absent
    await expect(verifyAndConsumeState(stateToken)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("malformed token → throws malformed", async () => {
    await expect(verifyAndConsumeState("not-a-token")).rejects.toMatchObject({
      code: "malformed",
    });
  });
});
