import { describe, it, expect, vi, beforeEach } from "vitest";

// Full-row mock of google_ads_oauth_states supporting the pending-* carry.
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
              r.state_token === token && (!consumedNull || r.consumed_at === null)
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
      if (t !== "google_ads_oauth_states") throw new Error(`unexpected table ${t}`);
      return statesApi();
    },
  }),
}));

const {
  buildAuthorizeUrl,
  peekState,
  stashPendingSelection,
  consumePendingSelection,
  StateError,
} = await import("@/lib/google-ads/oauth");

const PENDING = {
  encryptedTokenHex: "\\xdeadbeef",
  keyVersion: 1,
  scope: "https://www.googleapis.com/auth/adwords",
  loginCustomerId: "6935795509",
  customers: [
    { id: "6048611995", name: "Wallace" },
    { id: "1234567890", name: "Tracy's" },
  ],
};

beforeEach(() => {
  rows = [];
});

describe("peekState", () => {
  it("returns binding without consuming (idempotent)", async () => {
    const { stateToken } = await buildAuthorizeUrl({ userId: "u1", shopId: "s1" });
    expect(await peekState(stateToken)).toEqual({ userId: "u1", shopId: "s1" });
    // peek again — still not consumed
    expect(await peekState(stateToken)).toEqual({ userId: "u1", shopId: "s1" });
  });

  it("unknown token → not_found", async () => {
    const { stateToken } = await buildAuthorizeUrl({ userId: "u1", shopId: "s1" });
    rows = [];
    await expect(peekState(stateToken)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("stash + consume pending selection", () => {
  it("stash then consume returns the pending payload + binding", async () => {
    const { stateToken } = await buildAuthorizeUrl({ userId: "u1", shopId: "s1" });
    await stashPendingSelection(stateToken, PENDING);
    const consumed = await consumePendingSelection(stateToken);
    expect(consumed.userId).toBe("u1");
    expect(consumed.shopId).toBe("s1");
    expect(consumed.pending.encryptedTokenHex).toBe("\\xdeadbeef");
    expect(consumed.pending.loginCustomerId).toBe("6935795509");
    expect(consumed.pending.customers).toHaveLength(2);
  });

  it("second consume → replayed", async () => {
    const { stateToken } = await buildAuthorizeUrl({ userId: "u1", shopId: "s1" });
    await stashPendingSelection(stateToken, PENDING);
    await consumePendingSelection(stateToken);
    await expect(consumePendingSelection(stateToken)).rejects.toBeInstanceOf(StateError);
  });

  it("peek does not block a later consume", async () => {
    const { stateToken } = await buildAuthorizeUrl({ userId: "u1", shopId: "s1" });
    await peekState(stateToken);
    await stashPendingSelection(stateToken, PENDING);
    const consumed = await consumePendingSelection(stateToken);
    expect(consumed.shopId).toBe("s1");
  });

  it("consume with no stashed pending → malformed", async () => {
    const { stateToken } = await buildAuthorizeUrl({ userId: "u1", shopId: "s1" });
    await expect(consumePendingSelection(stateToken)).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("stash on an already-consumed row → replayed", async () => {
    const { stateToken } = await buildAuthorizeUrl({ userId: "u1", shopId: "s1" });
    await stashPendingSelection(stateToken, PENDING);
    await consumePendingSelection(stateToken);
    await expect(stashPendingSelection(stateToken, PENDING)).rejects.toBeInstanceOf(
      StateError
    );
  });
});
