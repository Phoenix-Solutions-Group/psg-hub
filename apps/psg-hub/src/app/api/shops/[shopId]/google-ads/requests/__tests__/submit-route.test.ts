import { beforeEach, describe, expect, it, vi } from "vitest";

const SHOP_ID = "11111111-1111-1111-1111-111111111111";
const REQUEST_ID = "33333333-3333-3333-3333-333333333333";

let membership: { role: string } | null;
let insertedRow: Record<string, unknown> | null;
let insertError: { message: string } | null;
let auditEvents: Array<Record<string, unknown>>;

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    builder[method] = vi.fn((arg?: unknown) => {
      if (method === "insert") insertedRow = arg as Record<string, unknown>;
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => {
      if (table !== "shop_users") throw new Error(`unexpected table: ${table}`);
      return chain({ data: membership, error: null });
    },
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () =>
      chain({
        data: { id: REQUEST_ID, shop_id: SHOP_ID, status: "submitted" },
        error: insertError,
      }),
  }),
}));

vi.mock("@/lib/audit/access-audit", () => ({
  recordAuditEvent: vi.fn(async (event: Record<string, unknown>) => {
    auditEvents.push(event);
    return "audit-1";
  }),
}));

const route = await import("../route");

function request(body: unknown) {
  return new Request("http://test/api/shops/x/google-ads/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(requestType: string, campaignId: string | null, campaignName: string | null) {
  return {
    requestType,
    campaignId,
    campaignName,
    title: "Customer Google Ads request",
    details: "Please review this request before making any live change.",
    requestValues: { Request: "Customer-provided details" },
    acknowledged: true,
  };
}

beforeEach(() => {
  membership = { role: "owner" };
  insertedRow = null;
  insertError = null;
  auditEvents = [];
});

describe("private Google Ads request submission", () => {
  it.each([
    ["budget_change", "riverside-search", "Collision Repair Search"],
    ["campaign_status_change", "riverside-local", "Riverside Local Services"],
    ["new_campaign", null, null],
    ["ad_copy_change", "riverside-brand", "Riverside Brand Search"],
    ["location_change", "riverside-search", "Collision Repair Search"],
    ["destination_change", "riverside-local", "Riverside Local Services"],
    ["performance_review", null, null],
    ["problem_report", null, null],
  ])("accepts the %s request type", async (requestType, campaignId, campaignName) => {
    const response = await route.POST(request(validBody(requestType, campaignId, campaignName)), {
      params: Promise.resolve({ shopId: SHOP_ID }),
    });

    expect(response.status).toBe(201);
    expect(insertedRow).toMatchObject({
      request_type: requestType,
      campaign_id: campaignId?.startsWith("riverside-") ? null : campaignId,
      campaign_name: campaignName,
    });
    expect(auditEvents).toHaveLength(1);
  });

  it("returns a 400 UI error for malformed JSON", async () => {
    const response = await route.POST(
      new Request("http://test/api/shops/x/google-ads/requests", {
        method: "POST",
        body: "{not-json",
      }),
      { params: Promise.resolve({ shopId: SHOP_ID }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
  });

  it("does not relax validation for other campaign aliases", async () => {
    const response = await route.POST(
      request(validBody("budget_change", "another-shop-preview", "Untrusted campaign")),
      { params: Promise.resolve({ shopId: SHOP_ID }) },
    );

    expect(response.status).toBe(422);
    expect(insertedRow).toBeNull();
  });

  it("returns 403 before inserting for a read-only role", async () => {
    membership = { role: "viewer" };

    const response = await route.POST(
      request(validBody("performance_review", null, null)),
      { params: Promise.resolve({ shopId: SHOP_ID }) },
    );

    expect(response.status).toBe(403);
    expect(insertedRow).toBeNull();
  });

  it("returns the UI error shape when the server cannot save", async () => {
    insertError = { message: "database unavailable" };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await route.POST(
      request(validBody("performance_review", null, null)),
      { params: Promise.resolve({ shopId: SHOP_ID }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Request creation failed" });
    expect(auditEvents).toEqual([]);
    consoleError.mockRestore();
  });
});
