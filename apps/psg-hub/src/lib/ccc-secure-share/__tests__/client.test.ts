import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the service client BEFORE importing the module under test.
const serviceState: {
  count: number;
  countError: { message: string } | null;
  insertError: { message: string } | null;
  inserts: unknown[];
  updates: { patch: Record<string, unknown>; id: unknown }[];
  insertThrows: boolean;
} = {
  count: 0,
  countError: null,
  insertError: null,
  inserts: [],
  updates: [],
  insertThrows: false,
};

function makeService() {
  return {
    from: vi.fn(() => ({
      // rate-limit count chain: .select(...).eq().in().gte() -> { count, error }
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => ({
            gte: vi.fn(async () => ({
              count: serviceState.count,
              error: serviceState.countError,
            })),
          })),
        })),
      })),
      insert: vi.fn(async (row: unknown) => {
        if (serviceState.insertThrows) throw new Error("connection reset");
        serviceState.inserts.push(row);
        return { error: serviceState.insertError };
      }),
      update: vi.fn((patch: Record<string, unknown>) => ({
        eq: vi.fn(async (_col: string, id: unknown) => {
          serviceState.updates.push({ patch, id });
          return { error: null };
        }),
      })),
    })),
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => makeService(),
}));

import {
  withCccRateLimit,
  logCccCall,
  mapCccError,
  getCccClient,
  markCccAccountAuthFailed,
} from "@/lib/ccc-secure-share/client";
import { CccApiError, NotImplementedError } from "@/lib/ccc-secure-share/types";

beforeEach(() => {
  serviceState.count = 0;
  serviceState.countError = null;
  serviceState.insertError = null;
  serviceState.inserts = [];
  serviceState.updates = [];
  serviceState.insertThrows = false;
});

describe("withCccRateLimit", () => {
  it("runs fn when under the window limit", async () => {
    serviceState.count = 3;
    const out = await withCccRateLimit("shop-1", "GET", async () => "ok");
    expect(out).toBe("ok");
  });

  it("throws rate_limited when the MUTATE window is exhausted", async () => {
    serviceState.count = 20; // == CCC_MUTATE_LIMIT_PER_HOUR
    await expect(
      withCccRateLimit("shop-1", "MUTATE", async () => "ok")
    ).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("read limit is independent of (higher than) the mutate limit", async () => {
    serviceState.count = 100; // under the 500 read limit
    const out = await withCccRateLimit("shop-1", "SEARCH", async () => 42);
    expect(out).toBe(42);
  });

  it("a count-query error surfaces as upstream", async () => {
    serviceState.countError = { message: "db down" };
    await expect(
      withCccRateLimit("shop-1", "GET", async () => "ok")
    ).rejects.toMatchObject({ code: "upstream" });
  });
});

describe("logCccCall", () => {
  it("inserts a normalized ledger row", async () => {
    await logCccCall({
      userId: null,
      shopId: "shop-1",
      accountId: "acct-1",
      endpoint: "/bms/messages",
      method: "GET",
      result: "success",
    });
    expect(serviceState.inserts).toHaveLength(1);
    expect(serviceState.inserts[0]).toMatchObject({
      shop_id: "shop-1",
      account_id: "acct-1",
      method: "GET",
      result: "success",
      resource_name: null,
      latency_ms: null,
      error_code: null,
    });
  });

  it("never throws even when the insert blows up (fire-and-forget)", async () => {
    serviceState.insertThrows = true;
    await expect(
      logCccCall({
        userId: null,
        shopId: "shop-1",
        accountId: null,
        endpoint: "/x",
        method: "GET",
        result: "error",
      })
    ).resolves.toBeUndefined();
  });
});

describe("mapCccError", () => {
  it("passes a CccApiError through unchanged", () => {
    const e = new CccApiError("bad_request", "nope");
    expect(mapCccError(e)).toBe(e);
  });

  it("classifies quota/rate strings as rate_limited", () => {
    expect(mapCccError(new Error("quota exceeded")).code).toBe("rate_limited");
  });

  it("classifies 401/unauthorized as auth_failed", () => {
    expect(mapCccError(new Error("401 unauthorized")).code).toBe("auth_failed");
  });

  it("classifies timeout/deadline as timeout", () => {
    expect(mapCccError(new Error("deadline exceeded")).code).toBe("timeout");
  });

  it("classifies invalid/bad request as bad_request", () => {
    expect(mapCccError(new Error("invalid facility id")).code).toBe(
      "bad_request"
    );
  });

  it("falls back to upstream and sanitizes PII in the message", () => {
    const mapped = mapCccError(new Error("failed for owner@example.com 5551234999"));
    expect(mapped.code).toBe("upstream");
    expect(mapped.message).not.toContain("owner@example.com");
    expect(mapped.message).toContain("[REDACTED_EMAIL]");
  });
});

describe("getCccClient — auth seam stub", () => {
  it("throws NotImplementedError until Phase 0 confirms the scheme", async () => {
    await expect(getCccClient("shop-1")).rejects.toBeInstanceOf(
      NotImplementedError
    );
  });
});

describe("markCccAccountAuthFailed", () => {
  it("updates the account to error with a sanitized message", async () => {
    await markCccAccountAuthFailed("acct-1", "boom for 5559998888");
    expect(serviceState.updates).toHaveLength(1);
    expect(serviceState.updates[0].patch.status).toBe("error");
    expect(String(serviceState.updates[0].patch.last_error)).toContain(
      "[REDACTED_ID]"
    );
  });
});
