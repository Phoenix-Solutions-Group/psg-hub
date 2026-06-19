import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable mock state (names must start with `mock` to satisfy vi.mock hoisting).
let mockUser: { id: string } | null = { id: "user_1" };
let mockMembership: { role: string } | null = { role: "owner" };
let mockInvoices: Array<Record<string, unknown>> = [];
let mockInvoicesError: unknown = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
    from: (table: string) => {
      if (table === "shop_users") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: mockMembership, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "invoices") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: mockInvoices,
                error: mockInvoicesError,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { GET } from "../route";

const VALID_SHOP = "11111111-1111-1111-1111-111111111111";

function call(shopId: string) {
  return GET(new Request("http://test/api/shops/x/invoices"), {
    params: Promise.resolve({ shopId }),
  });
}

beforeEach(() => {
  mockUser = { id: "user_1" };
  mockMembership = { role: "owner" };
  mockInvoices = [];
  mockInvoicesError = null;
});

describe("GET /api/shops/[shopId]/invoices", () => {
  it("400 on a non-UUID shopId", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated", async () => {
    mockUser = null;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(401);
  });

  it("403 when the user is not a member of the shop", async () => {
    mockMembership = null;
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(403);
  });

  it("200 with the shop's invoices for a member", async () => {
    mockInvoices = [
      { stripe_invoice_id: "in_1", status: "open", amount_due: 19900 },
    ];
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].stripe_invoice_id).toBe("in_1");
  });

  it("500 when the query errors", async () => {
    mockInvoicesError = new Error("db down");
    const res = await call(VALID_SHOP);
    expect(res.status).toBe(500);
  });
});
