import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleApiError } from "../client";
import type { GbpPresenceState } from "../gbp-presence";

const markErrorMock = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("../accounts", () => ({
  // getLinkedAccount is never reached — fetchPresence/fetchReviews are injected — but
  // stub it so importing the module does not pull in the crypto/service chain.
  getLinkedAccount: vi.fn(),
  markAccountError: (...a: unknown[]) => markErrorMock(...a),
}));

import { syncGbpPresence, reportMonth } from "../gbp-presence-sync";

function presence(overrides: Partial<GbpPresenceState> = {}): GbpPresenceState {
  return {
    open_status: "OPEN",
    primary_category: "Auto body shop",
    categories: ["Car repair and maintenance"],
    has_hours: true,
    website_uri: "https://example.com",
    has_description: true,
    phone_present: true,
    completeness_score: 100,
    ...overrides,
  };
}

type AcctRow = { id: string; shop_id: string; external_account_id: string };

function makeService(opts: {
  accounts?: AcctRow[];
  accountsError?: { message: string };
  ledgerInsertError?: { message: string };
}) {
  const calls = {
    ledgerInserts: [] as unknown[],
    ledgerUpdates: [] as { patch: Record<string, unknown>; id: unknown }[],
    upserts: [] as { rows: unknown[] }[],
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "analytics_sync_runs") {
        return {
          insert: vi.fn((row: unknown) => {
            calls.ledgerInserts.push(row);
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
        b.order = async () =>
          opts.accountsError
            ? { data: null, error: opts.accountsError }
            : { data: opts.accounts ?? [], error: null };
        return b;
      }
      if (table === "analytics_snapshots") {
        return {
          upsert: async (rows: unknown[]) => {
            calls.upserts.push({ rows });
            return { error: null };
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

describe("reportMonth", () => {
  it("prefers the explicit month override", () => {
    expect(reportMonth({ month: "2026-04", today: "2026-06-11" })).toBe("2026-04");
  });
  it("falls back to the month containing today", () => {
    expect(reportMonth({ today: "2026-06-11" })).toBe("2026-06");
  });
});

describe("syncGbpPresence", () => {
  it("writes ONE monthly gbp_presence row per shop (date=YYYY-MM-01) merging presence + rating", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1", external_account_id: "locations/1" }],
    });
    const fetchPresence = vi.fn(async () => presence());
    const fetchReviews = vi.fn(async () => ({
      average_rating: 4.6,
      total_review_count: 87,
    }));
    const res = await syncGbpPresence(client, {
      month: "2026-06",
      fetchPresence: fetchPresence as never,
      fetchReviews: fetchReviews as never,
    });

    expect(res).toEqual({ synced: 1, skipped: 0, failed: 0 });
    expect(calls.upserts[0].rows).toHaveLength(1);
    expect(calls.upserts[0].rows[0]).toMatchObject({
      shop_id: "shop-1",
      source: "gbp_presence",
      period: "monthly",
      date: "2026-06-01",
      metrics: {
        open_status: "OPEN",
        completeness_score: 100,
        average_rating: 4.6,
        total_review_count: 87,
      },
    });
    expect(calls.ledgerInserts[0]).toMatchObject({ source: "gbp_presence" });
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("success");
  });

  it("keeps the presence row with a null rating when the reviews call FAILS (account NOT flipped)", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1", external_account_id: "locations/1" }],
    });
    const fetchPresence = vi.fn(async () => presence());
    const fetchReviews = vi.fn(async () => {
      throw new GoogleApiError("rate_limited", "429");
    });
    const res = await syncGbpPresence(client, {
      month: "2026-06",
      fetchPresence: fetchPresence as never,
      fetchReviews: fetchReviews as never,
    });

    expect(res).toEqual({ synced: 1, skipped: 0, failed: 0 });
    expect(calls.upserts[0].rows).toHaveLength(1);
    expect(calls.upserts[0].rows[0]).toMatchObject({
      source: "gbp_presence",
      metrics: { open_status: "OPEN", average_rating: null, total_review_count: null },
    });
    // a RATING failure must NEVER flip the account.
    expect(markErrorMock).not.toHaveBeenCalled();
  });

  it("contains a PRESENCE auth_failed: marks the account error, writes NO row, continues", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "a1", shop_id: "shop-1", external_account_id: "locations/1" },
        { id: "a2", shop_id: "shop-2", external_account_id: "locations/2" },
      ],
    });
    const fetchPresence = vi.fn(async (shopId: string) => {
      if (shopId === "shop-1") throw new GoogleApiError("auth_failed", "invalid_grant");
      return presence();
    });
    const fetchReviews = vi.fn(async () => ({
      average_rating: 5,
      total_review_count: 3,
    }));
    const res = await syncGbpPresence(client, {
      month: "2026-06",
      fetchPresence: fetchPresence as never,
      fetchReviews: fetchReviews as never,
    });

    expect(res).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(markErrorMock).toHaveBeenCalledWith("a1", "invalid_grant");
    // only shop-2 made it to a row.
    expect(calls.upserts[0].rows).toHaveLength(1);
    expect(calls.upserts[0].rows[0]).toMatchObject({ shop_id: "shop-2" });
  });

  it("does NOT flip the account on a non-auth PRESENCE error", async () => {
    const { client } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1", external_account_id: "locations/1" }],
    });
    const fetchPresence = vi.fn(async () => {
      throw new GoogleApiError("bad_request", "location not accessible");
    });
    const fetchReviews = vi.fn();
    const res = await syncGbpPresence(client, {
      month: "2026-06",
      fetchPresence: fetchPresence as never,
      fetchReviews: fetchReviews as never,
    });
    expect(res).toEqual({ synced: 0, skipped: 0, failed: 1 });
    expect(markErrorMock).not.toHaveBeenCalled();
  });

  it("collapses a double-linked shop to ONE row (no double-write)", async () => {
    const { client, calls } = makeService({
      accounts: [
        { id: "a-new", shop_id: "shop-1", external_account_id: "locations/2" },
        { id: "a-old", shop_id: "shop-1", external_account_id: "locations/1" },
        { id: "b", shop_id: "shop-2", external_account_id: "locations/9" },
      ],
    });
    const fetchPresence = vi.fn(async () => presence());
    const fetchReviews = vi.fn(async () => ({
      average_rating: null,
      total_review_count: null,
    }));
    const res = await syncGbpPresence(client, {
      month: "2026-06",
      fetchPresence: fetchPresence as never,
      fetchReviews: fetchReviews as never,
    });
    expect(fetchPresence).toHaveBeenCalledTimes(2); // shop-1 deduped
    expect(res.synced).toBe(2);
    expect(calls.upserts[0].rows).toHaveLength(2);
  });

  it("on an accounts-read error: closes the ledger error and rethrows", async () => {
    const { client, calls } = makeService({ accountsError: { message: "db down" } });
    await expect(
      syncGbpPresence(client, { month: "2026-06" })
    ).rejects.toThrow(/db down/);
    expect(calls.ledgerUpdates.at(-1)?.patch.status).toBe("error");
  });

  it("a ledger-open failure is non-blocking (rows still upsert)", async () => {
    const { client, calls } = makeService({
      accounts: [{ id: "a1", shop_id: "shop-1", external_account_id: "locations/1" }],
      ledgerInsertError: { message: "ledger boom" },
    });
    const fetchPresence = vi.fn(async () => presence());
    const fetchReviews = vi.fn(async () => ({
      average_rating: 4,
      total_review_count: 1,
    }));
    const res = await syncGbpPresence(client, {
      month: "2026-06",
      fetchPresence: fetchPresence as never,
      fetchReviews: fetchReviews as never,
    });
    expect(res.synced).toBe(1);
    expect(calls.upserts[0].rows).toHaveLength(1);
  });
});
