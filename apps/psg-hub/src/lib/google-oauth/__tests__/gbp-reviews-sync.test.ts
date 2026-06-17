import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleApiError } from "../client";
import type { GbpReviewRow } from "../gbp-review-items";

const markErrorMock = vi.fn();
vi.mock("../accounts", () => ({
  // getLinkedAccount is never reached — fetchReviews is injected — but stub it so
  // importing the module does not pull in the crypto/service chain.
  getLinkedAccount: vi.fn(),
  markAccountError: (...a: unknown[]) => markErrorMock(...a),
}));

import { syncGbpReviews, syncGbpReviewsForShop } from "../gbp-reviews-sync";

function row(overrides: Partial<GbpReviewRow> = {}): GbpReviewRow {
  return {
    external_review_id: "accounts/1/locations/2/reviews/r1",
    platform: "google",
    rating: 5,
    text: "Great",
    author: "Jane",
    reviewed_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-02T10:00:00Z",
    ...overrides,
  };
}

type AcctRow = { id: string; shop_id: string };

function makeService(opts: {
  accounts?: AcctRow[];
  accountsError?: { message: string };
  ledgerInsertError?: { message: string };
  /** shop_id -> internal location row (or null = no internal location). Default: present. */
  locations?: Record<string, { id: string } | null>;
  upsertError?: { message: string };
}) {
  const calls = {
    ledgerInserts: [] as Record<string, unknown>[],
    ledgerUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
    upserts: [] as { rows: Record<string, unknown>[]; opts: unknown }[],
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "analytics_sync_runs") {
        return {
          insert: vi.fn((r: Record<string, unknown>) => {
            calls.ledgerInserts.push(r);
            return {
              select: () => ({
                single: async () =>
                  opts.ledgerInsertError
                    ? { data: null, error: opts.ledgerInsertError }
                    : { data: { id: "run-1" }, error: null },
              }),
            };
          }),
          update: vi.fn((patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: unknown) => {
              calls.ledgerUpdates.push({ patch, id });
              return { error: null };
            },
          })),
        };
      }
      if (table === "google_oauth_accounts") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        // batch awaits .order() directly; the single-shop path chains .limit().maybeSingle().
        b.order = () => ({
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve(
              opts.accountsError
                ? { data: null, error: opts.accountsError }
                : { data: opts.accounts ?? [], error: null }
            ).then(onFulfilled),
          limit: () => ({
            maybeSingle: async () => ({
              data: (opts.accounts ?? [])[0] ?? null,
              error: opts.accountsError ?? null,
            }),
          }),
        });
        return b;
      }
      if (table === "locations") {
        let shopId = "";
        const lb: Record<string, unknown> = {};
        lb.select = () => lb;
        lb.eq = (_col: string, val: string) => {
          shopId = val;
          return lb;
        };
        lb.order = () => lb;
        lb.limit = () => lb;
        lb.maybeSingle = async () => ({
          data:
            opts.locations === undefined
              ? { id: `loc-${shopId}` }
              : (opts.locations[shopId] ?? null),
          error: null,
        });
        return lb;
      }
      if (table === "review_items") {
        return {
          upsert: async (rows: Record<string, unknown>[], o: unknown) => {
            calls.upserts.push({ rows, opts: o });
            return { error: opts.upsertError ?? null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(() => {
  markErrorMock.mockReset();
});

describe("syncGbpReviews (batch)", () => {
  it("upserts per-review rows idempotently (onConflict) and opens a gbp_reviews ledger", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1" }],
    });
    const fetchReviews = vi.fn(async () => [
      row({ external_review_id: "r/1" }),
      row({ external_review_id: "r/2", rating: null, text: null, author: null }),
    ]);
    const res = await syncGbpReviews(client, { fetchReviews: fetchReviews as never });

    expect(res).toEqual({ synced: 2, skipped: 0, failed: 0 });
    expect(calls.upserts[0].opts).toEqual({
      onConflict: "shop_id,external_review_id",
    });
    expect(calls.upserts[0].rows).toHaveLength(2);
    expect(calls.upserts[0].rows[0]).toMatchObject({
      shop_id: "shop-1",
      location_id: "loc-shop-1",
      platform: "google",
      external_review_id: "r/1",
    });
    expect(calls.ledgerInserts[0]).toMatchObject({ source: "gbp_reviews" });
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("success");
  });

  it("contains a per-shop fetch throw: auth_failed flips the account, batch continues", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1" },
        { id: "a2", shop_id: "shop-2" },
      ],
    });
    const fetchReviews = vi.fn(async (shopId: string) => {
      if (shopId === "shop-1")
        throw new GoogleApiError("auth_failed", "invalid_grant");
      return [row({ external_review_id: "r/2" })];
    });
    const res = await syncGbpReviews(client, { fetchReviews: fetchReviews as never });

    expect(res).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(markErrorMock).toHaveBeenCalledWith("a1", "invalid_grant");
    expect(calls.upserts[0].rows).toHaveLength(1);
    expect(calls.upserts[0].rows[0]).toMatchObject({ shop_id: "shop-2" });
  });

  it("skips a shop with NO internal location (counted, NOT flipped, fetch not called)", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1" }],
      locations: { "shop-1": null },
    });
    const fetchReviews = vi.fn(async () => [row()]);
    const res = await syncGbpReviews(client, { fetchReviews: fetchReviews as never });

    expect(res).toEqual({ synced: 0, skipped: 1, failed: 0 });
    expect(fetchReviews).not.toHaveBeenCalled();
    expect(markErrorMock).not.toHaveBeenCalled();
    expect(calls.upserts).toHaveLength(0);
  });

  it("skips a shop whose fetch returns [] (unverified/non-VoM — AC-2: NOT flipped, no rows)", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1" }],
    });
    const fetchReviews = vi.fn(async () => []);
    const res = await syncGbpReviews(client, { fetchReviews: fetchReviews as never });

    expect(res).toEqual({ synced: 0, skipped: 1, failed: 0 });
    expect(markErrorMock).not.toHaveBeenCalled();
    expect(calls.upserts).toHaveLength(0);
  });

  it("does NOT flip the account on a non-auth fetch error", async () => {
    const { client } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1" }],
    });
    const fetchReviews = vi.fn(async () => {
      throw new GoogleApiError("bad_request", "location not accessible");
    });
    const res = await syncGbpReviews(client, { fetchReviews: fetchReviews as never });

    expect(res).toEqual({ synced: 0, skipped: 0, failed: 1 });
    expect(markErrorMock).not.toHaveBeenCalled();
  });

  it("collapses a double-linked shop to ONE ingest (latest linked_at wins)", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "a-new", shop_id: "shop-1" },
        { id: "a-old", shop_id: "shop-1" },
        { id: "b", shop_id: "shop-2" },
      ],
    });
    const fetchReviews = vi.fn(async (shopId: string) => [
      row({ external_review_id: `r/${shopId}` }),
    ]);
    const res = await syncGbpReviews(client, { fetchReviews: fetchReviews as never });

    expect(fetchReviews).toHaveBeenCalledTimes(2); // shop-1 deduped
    expect(res).toEqual({ synced: 2, skipped: 0, failed: 0 });
    expect(calls.upserts).toHaveLength(2);
  });

  it("on an accounts-read error: closes the ledger error and rethrows", async () => {
    const { client, calls } = makeService({ accountsError: { message: "db down" } });
    await expect(syncGbpReviews(client)).rejects.toThrow(/db down/);
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("error");
  });

  it("a ledger-open failure is non-blocking (rows still upsert)", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1" }],
      ledgerInsertError: { message: "ledger boom" },
    });
    const fetchReviews = vi.fn(async () => [row()]);
    const res = await syncGbpReviews(client, { fetchReviews: fetchReviews as never });
    expect(res.synced).toBe(1);
    expect(calls.upserts[0].rows).toHaveLength(1);
  });
});

describe("syncGbpReviewsForShop (single-shop, the ingest route core)", () => {
  it("returns { inserted, skipped, errors } for a linked shop with reviews", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1" }],
    });
    const fetchReviews = vi.fn(async () => [
      row({ external_review_id: "r/1" }),
      row({ external_review_id: "r/2" }),
    ]);
    const out = await syncGbpReviewsForShop(client, "shop-1", {
      fetchReviews: fetchReviews as never,
    });
    expect(out).toEqual({ inserted: 2, skipped: 0, errors: 0 });
    expect(calls.upserts[0].opts).toEqual({
      onConflict: "shop_id,external_review_id",
    });
  });

  it("returns skipped:1 when the shop has no linked gbp account", async () => {
    const { client } = makeService({ accounts: [] });
    const fetchReviews = vi.fn();
    const out = await syncGbpReviewsForShop(client, "shop-x", {
      fetchReviews: fetchReviews as never,
    });
    expect(out).toEqual({ inserted: 0, skipped: 1, errors: 0 });
    expect(fetchReviews).not.toHaveBeenCalled();
  });

  it("contains a fetch throw as errors:1 and flips the account on auth_failed", async () => {
    const { client } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1" }],
    });
    const fetchReviews = vi.fn(async () => {
      throw new GoogleApiError("auth_failed", "invalid_grant");
    });
    const out = await syncGbpReviewsForShop(client, "shop-1", {
      fetchReviews: fetchReviews as never,
    });
    expect(out).toEqual({ inserted: 0, skipped: 0, errors: 1 });
    expect(markErrorMock).toHaveBeenCalledWith("a1", "invalid_grant");
  });
});
