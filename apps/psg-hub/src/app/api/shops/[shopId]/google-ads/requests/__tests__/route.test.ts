import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const VALID_SHOP = "11111111-1111-1111-1111-111111111111";
const OTHER_SHOP = "22222222-2222-2222-2222-222222222222";
const REQUEST_ID = "33333333-3333-3333-3333-333333333333";

let mockUser: { id: string } | null = { id: "user-1" };
let mockMembership: { role: string } | null = { role: "owner" };
let mockClientRows: unknown[] = [];
let mockClientError: { message: string } | null = null;
let mockServiceInsert: Record<string, unknown> | null = null;
let mockServiceUpdate: Record<string, unknown> | null = null;
let mockExistingRequest: Record<string, unknown> | null = null;
let mockServiceError: { message: string } | null = null;
let mockAuditEvents: Array<Record<string, unknown>> = [];
let mockOpsGate: unknown = { ok: true, userId: "ops-1", access: {} };

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "insert", "update"]) {
    builder[method] = vi.fn((arg?: unknown) => {
      if (method === "insert") mockServiceInsert = arg as Record<string, unknown>;
      if (method === "update") mockServiceUpdate = arg as Record<string, unknown>;
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockUser } }) },
    from: (table: string) => {
      if (table === "shop_users") {
        return chain({ data: mockMembership, error: null });
      }
      if (table === "google_ads_customer_requests") {
        return chain({ data: mockClientRows, error: mockClientError });
      }
      throw new Error(`unexpected client table: ${table}`);
    },
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== "google_ads_customer_requests") {
        throw new Error(`unexpected service table: ${table}`);
      }
      return chain({
        data:
          mockExistingRequest ??
          {
            id: REQUEST_ID,
            shop_id: VALID_SHOP,
            requested_by_profile_id: "user-1",
            request_type: "new_campaign",
            title: "Launch a new campaign",
            details: "Please build a new campaign for aluminum repair leads.",
            status: "submitted",
          },
        error: mockServiceError,
      });
    },
  }),
}));

vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: vi.fn(async (event: Record<string, unknown>) => {
    mockAuditEvents.push(event);
    return "audit-1";
  }),
}));

vi.mock("@/lib/auth/ops-access", () => ({
  requireOpsFn: async () => mockOpsGate,
}));

const customerRoute = await import("../route");
const customerReplyRoute = await import("../[requestId]/route");
const opsRoute = await import("@/app/api/ops/google-ads/requests/[id]/route");

function customerRequest(body: unknown) {
  return new Request("http://test/api/shops/x/google-ads/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function opsRequest(body: unknown) {
  return new NextRequest(`http://test/api/ops/google-ads/requests/${REQUEST_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function customerReplyRequest(body: unknown) {
  return new Request(`http://test/api/shops/${VALID_SHOP}/google-ads/requests/${REQUEST_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUser = { id: "user-1" };
  mockMembership = { role: "owner" };
  mockClientRows = [];
  mockClientError = null;
  mockServiceInsert = null;
  mockServiceUpdate = null;
  mockExistingRequest = null;
  mockServiceError = null;
  mockAuditEvents = [];
  mockOpsGate = { ok: true, userId: "ops-1", access: {} };
});

describe("Google Ads customer request workflow", () => {
  it("lists only after the explicit shop membership gate", async () => {
    mockClientRows = [{ id: REQUEST_ID, shop_id: VALID_SHOP, status: "submitted" }];

    const res = await customerRoute.GET(new Request("http://test"), {
      params: Promise.resolve({ shopId: VALID_SHOP }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests).toEqual(mockClientRows);
  });

  it("blocks cross-shop reads before querying request rows", async () => {
    mockMembership = null;

    const res = await customerRoute.GET(new Request("http://test"), {
      params: Promise.resolve({ shopId: OTHER_SHOP }),
    });

    expect(res.status).toBe(403);
  });

  it("creates a submitted customer request and writes an audit row", async () => {
    const res = await customerRoute.POST(
      customerRequest({
        requestType: "new_campaign",
        title: "Launch a new campaign",
        details: "Please build a new campaign for aluminum repair leads.",
        requestValues: { Service: "Aluminum repair" },
        acknowledged: true,
      }),
      { params: Promise.resolve({ shopId: VALID_SHOP }) },
    );

    expect(res.status).toBe(201);
    expect(mockServiceInsert).toMatchObject({
      shop_id: VALID_SHOP,
      requested_by_profile_id: "user-1",
      request_type: "new_campaign",
      status: "submitted",
      request_values: { Service: "Aluminum repair" },
      acknowledged_at: expect.any(String),
    });
    expect(mockAuditEvents).toMatchObject([
      {
        actorProfileId: "user-1",
        targetShopId: VALID_SHOP,
        action: "google_ads_request.create",
        payload: expect.objectContaining({ executesGoogleAdsChange: false }),
      },
    ]);
  });

  it("does not create a request for a non-member", async () => {
    mockMembership = null;

    const res = await customerRoute.POST(
      customerRequest({
        requestType: "performance_review",
        title: "Pause one campaign",
        details: "Please pause the campaign while we update intake capacity.",
        requestValues: { Question: "Why did leads change?" },
        acknowledged: true,
      }),
      { params: Promise.resolve({ shopId: OTHER_SHOP }) },
    );

    expect(res.status).toBe(403);
    expect(mockServiceInsert).toBeNull();
    expect(mockAuditEvents).toEqual([]);
  });

  it("does not let a read-only viewer submit a request", async () => {
    mockMembership = { role: "viewer" };

    const res = await customerRoute.POST(
      customerRequest({
        requestType: "performance_review",
        title: "Review performance",
        details: "Please explain the change in lead volume.",
        requestValues: { Question: "Why did leads change?" },
        acknowledged: true,
      }),
      { params: Promise.resolve({ shopId: VALID_SHOP }) },
    );

    expect(res.status).toBe(403);
    expect(mockServiceInsert).toBeNull();
  });

  it("requires the customer to acknowledge PSG review", async () => {
    const res = await customerRoute.POST(
      customerRequest({
        requestType: "problem_report",
        title: "Report a problem",
        details: "Ads numbers have not updated since yesterday.",
        requestValues: { Problem: "Numbers are stale" },
        acknowledged: false,
      }),
      { params: Promise.resolve({ shopId: VALID_SHOP }) },
    );

    expect(res.status).toBe(422);
    expect(mockServiceInsert).toBeNull();
  });

  it("lets PSG staff move a request through status/reply and audits the change", async () => {
    const res = await opsRoute.PATCH(
      opsRequest({
        status: "needs_more_info",
        response: "Please confirm which services you want emphasized.",
      }),
      { params: Promise.resolve({ id: REQUEST_ID }) },
    );

    expect(res.status).toBe(200);
    expect(mockServiceUpdate).toMatchObject({
      status: "needs_more_info",
      psg_response: "Please confirm which services you want emphasized.",
      updated_by_profile_id: "ops-1",
    });
    expect(mockAuditEvents).toMatchObject([
      {
        actorProfileId: "ops-1",
        targetShopId: VALID_SHOP,
        action: "google_ads_request.update",
        payload: expect.objectContaining({
          requestId: REQUEST_ID,
          previousStatus: "submitted",
          status: "needs_more_info",
          executesGoogleAdsChange: false,
        }),
      },
    ]);
  });

  it("lets a shop member answer a request only when PSG needs more info", async () => {
    mockExistingRequest = {
      id: REQUEST_ID,
      shop_id: VALID_SHOP,
      status: "needs_more_info",
    };

    const res = await customerReplyRoute.PATCH(
      customerReplyRequest({ response: "Please focus on certified aluminum repair." }),
      { params: Promise.resolve({ shopId: VALID_SHOP, requestId: REQUEST_ID }) },
    );

    expect(res.status).toBe(200);
    expect(mockServiceUpdate).toMatchObject({
      status: "psg_reviewing",
      psg_response: "Customer replied: Please focus on certified aluminum repair.",
      updated_by_profile_id: "user-1",
    });
    expect(mockAuditEvents).toMatchObject([
      {
        actorProfileId: "user-1",
        targetShopId: VALID_SHOP,
        action: "google_ads_request.customer_reply",
        payload: expect.objectContaining({
          requestId: REQUEST_ID,
          previousStatus: "needs_more_info",
          status: "psg_reviewing",
          executesGoogleAdsChange: false,
        }),
      },
    ]);
  });

  it("does not let a customer update a request that is not waiting on them", async () => {
    mockExistingRequest = {
      id: REQUEST_ID,
      shop_id: VALID_SHOP,
      status: "submitted",
    };

    const res = await customerReplyRoute.PATCH(
      customerReplyRequest({ response: "Extra context." }),
      { params: Promise.resolve({ shopId: VALID_SHOP, requestId: REQUEST_ID }) },
    );

    expect(res.status).toBe(409);
    expect(mockServiceUpdate).toBeNull();
  });

  it("requires a reason when PSG declines a request", async () => {
    const res = await opsRoute.PATCH(
      opsRequest({ status: "declined" }),
      { params: Promise.resolve({ id: REQUEST_ID }) },
    );

    expect(res.status).toBe(422);
    expect(mockServiceUpdate).toBeNull();
    expect(mockAuditEvents).toEqual([]);
  });

  it("propagates the PSG staff capability gate", async () => {
    mockOpsGate = {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };

    const res = await opsRoute.PATCH(
      opsRequest({ status: "in_progress" }),
      { params: Promise.resolve({ id: REQUEST_ID }) },
    );

    expect(res.status).toBe(403);
  });
});
