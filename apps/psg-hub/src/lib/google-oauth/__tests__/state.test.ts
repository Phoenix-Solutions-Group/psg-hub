import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock of google_oauth_pending_states supporting the generic pending_accounts
// carry. Mirrors google-ads/__tests__/oauth-pending.test.ts, retargeted to the
// new table + the {ga4,gsc} pending_accounts shape.
type Row = Record<string, unknown> & {
  state_token: string;
  user_id: string;
  shop_id: string;
  consumed_at: string | null;
};
let rows: Row[] = [];

function statesApi() {
  return {
    insert: vi.fn((payload: Row) => {
      rows.push({ ...payload, consumed_at: null });
      return Promise.resolve({ error: null });
    }),
    delete: vi.fn(function (this: unknown) {
      return { lt: vi.fn(async () => ({ error: null })) } as never;
    }),
    update: vi.fn((patch: Partial<Row>) => {
      let token: string | null = null;
      let consumedNull = false;
      const chain = {
        eq: vi.fn((c: string, v: string) => {
          if (c === "state_token") token = v;
          return chain;
        }),
        is: vi.fn((c: string, v: unknown) => {
          if (c === "consumed_at" && v === null) consumedNull = true;
          return chain;
        }),
        select: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => {
          const row = rows.find(
            (r) =>
              r.state_token === token &&
              (!consumedNull || r.consumed_at === null)
          );
          if (!row) return { data: null, error: null };
          Object.assign(row, patch);
          return { data: { ...row }, error: null };
        }),
      };
      return chain;
    }),
    select: vi.fn(() => ({
      eq: vi.fn((_c: string, v: string) => ({
        maybeSingle: vi.fn(async () => {
          const row = rows.find((r) => r.state_token === v);
          return { data: row ? { ...row } : null, error: null };
        }),
      })),
    })),
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (t: string) => {
      if (t !== "google_oauth_pending_states")
        throw new Error(`unexpected table ${t}`);
      return statesApi();
    },
  }),
}));

const {
  buildAuthorizeUrl,
  peekState,
  verifyAndConsumeState,
  stashPendingSelection,
  consumePendingSelection,
  exchangeCodeForTokens,
  StateError,
} = await import("@/lib/google-oauth/state");

const SCOPE =
  "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";
const REDIRECT = "https://hub.psgweb.me/api/analytics/google/callback";

const PENDING = {
  encryptedTokenHex: "\\xdeadbeef",
  keyVersion: 1,
  scope: SCOPE,
  accounts: {
    ga4: [
      { id: "properties/111", name: "Acme GA4" },
      { id: "properties/222", name: "Beta GA4" },
    ],
    gsc: [{ id: "sc-domain:acme.com", name: "sc-domain:acme.com" }],
  },
};

beforeEach(() => {
  rows = [];
});

describe("buildAuthorizeUrl (parameterized scope + redirect)", () => {
  it("embeds the passed scope + redirect URI (not the ads couplings)", async () => {
    const { url, stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(parsed.searchParams.get("scope")).toBe(SCOPE);
    expect(parsed.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("state")).toBe(stateToken);
    // NOT the adwords scope / ads redirect.
    expect(url).not.toContain("adwords");
    expect(url).not.toContain("/api/ads/google/callback");
  });
});

describe("peekState", () => {
  it("returns binding without consuming (idempotent)", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    expect(await peekState(stateToken)).toEqual({ userId: "u1", shopId: "s1" });
    expect(await peekState(stateToken)).toEqual({ userId: "u1", shopId: "s1" });
  });

  it("unknown token -> not_found", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    rows = [];
    await expect(peekState(stateToken)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("tampered token -> invalid_signature", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    const [body] = stateToken.split(".");
    await expect(peekState(`${body}.deadbeef`)).rejects.toMatchObject({
      code: "invalid_signature",
    });
  });
});

describe("stash + consume pending selection (generic ga4/gsc)", () => {
  it("stash then consume returns both source lists + binding", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    await stashPendingSelection(stateToken, PENDING);
    const consumed = await consumePendingSelection(stateToken);
    expect(consumed.userId).toBe("u1");
    expect(consumed.shopId).toBe("s1");
    expect(consumed.pending.encryptedTokenHex).toBe("\\xdeadbeef");
    expect(consumed.pending.accounts.ga4).toHaveLength(2);
    expect(consumed.pending.accounts.gsc).toHaveLength(1);
    expect(consumed.pending.accounts.gsc[0].id).toBe("sc-domain:acme.com");
  });

  it("second consume -> replayed", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    await stashPendingSelection(stateToken, PENDING);
    await consumePendingSelection(stateToken);
    await expect(consumePendingSelection(stateToken)).rejects.toBeInstanceOf(
      StateError
    );
  });

  it("consume with no stashed pending -> malformed", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    await expect(consumePendingSelection(stateToken)).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("missing source lists default to empty arrays (not throw)", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    await stashPendingSelection(stateToken, {
      encryptedTokenHex: "\\xabcd",
      keyVersion: 1,
      scope: SCOPE,
      accounts: { ga4: [], gsc: [] },
    });
    const consumed = await consumePendingSelection(stateToken);
    expect(consumed.pending.accounts).toEqual({ ga4: [], gsc: [] });
  });
});

describe("verifyAndConsumeState (single-step)", () => {
  it("consumes once; replay -> replayed", async () => {
    const { stateToken } = await buildAuthorizeUrl({
      scope: SCOPE,
      redirectUri: REDIRECT,
      userId: "u1",
      shopId: "s1",
    });
    expect(await verifyAndConsumeState(stateToken)).toEqual({
      userId: "u1",
      shopId: "s1",
    });
    await expect(verifyAndConsumeState(stateToken)).rejects.toMatchObject({
      code: "replayed",
    });
  });
});

describe("exchangeCodeForTokens (redirect is a required arg, no env fallback)", () => {
  it("throws when redirectUri is empty (never silently uses an ads env)", async () => {
    await expect(exchangeCodeForTokens("code", "")).rejects.toThrow(
      /OAuth env vars missing/
    );
  });
});
