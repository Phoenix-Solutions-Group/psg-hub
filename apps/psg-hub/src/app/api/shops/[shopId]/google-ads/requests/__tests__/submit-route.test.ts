import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHOP_ID = "11111111-1111-1111-1111-111111111111";
const REQUEST_ID = "33333333-3333-3333-3333-333333333333";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";

let membership: { role: string } | null;
let insertedRow: Record<string, unknown> | null;
let insertError: { message: string } | null;
let auditEvents: Array<Record<string, unknown>>;
let campaignLookup: { data: { name: string } | null; error: { message: string } | null };

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
    from: (table: string) =>
      chain(table === "google_ads_campaigns" ? campaignLookup : {
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
  campaignLookup = { data: { name: "Database campaign name" }, error: null };
});

describe("private Google Ads request submission", () => {
  it("keeps legacy campaign adjustment rows valid during the staged migration", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase/migrations/20260820143000_google_ads_reviewed_requests.sql"),
      "utf8",
    );

    expect(migration).toMatch(/check \(request_type in \([\s\S]*'campaign_adjustment'/);
  });

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

  it("rejects a campaign that does not belong to the selected shop", async () => {
    campaignLookup = { data: null, error: null };

    const response = await route.POST(
      request(validBody("budget_change", CAMPAIGN_ID, "Another shop campaign")),
      { params: Promise.resolve({ shopId: SHOP_ID }) },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "Campaign not found" });
    expect(insertedRow).toBeNull();
    expect(auditEvents).toEqual([]);
  });

  it("uses the tenant campaign name from the database instead of browser input", async () => {
    const response = await route.POST(
      request(validBody("budget_change", CAMPAIGN_ID, "Untrusted browser name")),
      { params: Promise.resolve({ shopId: SHOP_ID }) },
    );

    expect(response.status).toBe(201);
    expect(insertedRow).toMatchObject({
      campaign_id: CAMPAIGN_ID,
      campaign_name: "Database campaign name",
    });
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
