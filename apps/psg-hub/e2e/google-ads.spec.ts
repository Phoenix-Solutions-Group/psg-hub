import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OPS_STAFF, OWNER, MULTI, PASSWORD } from "./fixtures";
import { checkA11y, shoot } from "./_helpers";

// Phase 10 / 10-01. Two proofs against the LOCAL migrated DB:
//  AC-2 — the blind-built google_ads_* schema round-trips with REAL clients
//         (service-role writes + user-session RLS reads). Mocked unit tests
//         replay nothing against the migration; only this catches column /
//         constraint / RLS drift (the 09-02 latent-bug lesson). It already
//         caught one: a raw Buffer bytea write corrupts the token (stored as
//         the JSON {"type":"Buffer"...}); the fix stores `\x<hex>` — asserted
//         below via the same readback the app now performs.
//  AC-3 — /dashboard/ads is online: the real unlinked accounts/link surface,
//         not the old "coming soon" guard, with no campaign-mutation controls.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Hard local-only guard (mirrors global.setup) — this writes with the
// service-role key (RLS bypass) and must NEVER touch shared prod.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
  throw new Error(`[e2e] Refusing to run google-ads schema test: non-local target ${url}`);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3,
  0xcf, 0xd3, 0x0a, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c,
  0x3c, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x74,
  0x72, 0x61, 0x69, 0x6c, 0x65, 0x72, 0x0a, 0x3c, 0x3c, 0x3e, 0x3e, 0x0a,
  0x25, 0x25, 0x45, 0x4f, 0x46,
]);

async function shopIdByName(name: string): Promise<string> {
  const { data, error } = await admin
    .from("shops")
    .select("id")
    .eq("name", name)
    .single();
  if (error || !data) throw new Error(`[e2e] shop "${name}" not found: ${error?.message}`);
  return data.id as string;
}

async function sessionClientFor(email: string): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`[e2e] signIn ${email} failed: ${error.message}`);
  return c;
}

test.describe("google ads — schema round-trip with real clients (AC-1, AC-2)", () => {
  let shopAId: string; // MULTI owns this -> member read
  let accountId: string;
  const PLAINTEXT = "fake-refresh-token-üñ-10-01";
  const HEX_BYTEA = `\\x${Buffer.from(PLAINTEXT, "utf8").toString("hex")}`;

  test.beforeAll(async () => {
    shopAId = await shopIdByName(MULTI.shopA);

    // Clean any prior probe rows (idempotent re-run without db reset).
    await admin.from("google_ads_campaigns").delete().eq("shop_id", shopAId);
    await admin.from("ads_api_call_log").delete().eq("shop_id", shopAId);
    await admin.from("google_ads_oauth_states").delete().eq("shop_id", shopAId);
    await admin.from("google_ads_accounts").delete().eq("shop_id", shopAId);

    // service-role inserts across all 4 tables (the callback / oauth / client
    // write contracts). bytea via the `\x<hex>` text form (the 10-01 fix).
    const { data: acct, error: aErr } = await admin
      .from("google_ads_accounts")
      .insert({
        shop_id: shopAId,
        customer_id: "1234567890",
        login_customer_id: null,
        encrypted_refresh_token: HEX_BYTEA,
        key_version: 1,
        scope: "https://www.googleapis.com/auth/adwords",
        status: "linked",
      })
      .select("id")
      .single();
    expect(aErr, `account insert: ${aErr?.message}`).toBeNull();
    accountId = acct!.id as string;

    const { error: oErr } = await admin.from("google_ads_oauth_states").insert({
      state_token: `e2e-state-${shopAId}`,
      user_id: "00000000-0000-0000-0000-000000000001",
      shop_id: shopAId,
      nonce: "e2e-nonce",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(oErr, `oauth_state insert: ${oErr?.message}`).toBeNull();

    const { error: cErr } = await admin.from("google_ads_campaigns").insert({
      shop_id: shopAId,
      account_id: accountId,
      external_resource_name: "customers/1234567890/campaigns/5555",
      external_id: "5555",
      name: "E2E Probe Campaign",
      campaign_type: "SEARCH",
      status: "paused",
      daily_budget_micros: 50_000_000,
    });
    expect(cErr, `campaign insert: ${cErr?.message}`).toBeNull();

    const { error: lErr } = await admin.from("ads_api_call_log").insert({
      shop_id: shopAId,
      account_id: accountId,
      endpoint: "customers.listAccessibleCustomers",
      method: "GET",
      result: "success",
    });
    expect(lErr, `call_log insert: ${lErr?.message}`).toBeNull();
  });

  test.afterAll(async () => {
    await admin.from("google_ads_campaigns").delete().eq("shop_id", shopAId);
    await admin.from("ads_api_call_log").delete().eq("shop_id", shopAId);
    await admin.from("google_ads_oauth_states").delete().eq("shop_id", shopAId);
    await admin.from("google_ads_accounts").delete().eq("shop_id", shopAId);
  });

  test("bytea stores the bytes (not the Buffer JSON) and reads back byte-identical", async () => {
    const { data, error } = await admin
      .from("google_ads_accounts")
      .select("encrypted_refresh_token")
      .eq("id", accountId)
      .single();
    expect(error).toBeNull();
    const raw = data!.encrypted_refresh_token as unknown;
    // PostgREST returns bytea as a `\x<hex>` string; decode + compare.
    expect(typeof raw).toBe("string");
    expect((raw as string).startsWith("\\x")).toBe(true);
    const decoded = Buffer.from((raw as string).slice(2), "hex").toString("utf8");
    expect(decoded).toBe(PLAINTEXT);
  });

  test("rate-limit COUNT query runs against the real index (no schema drift)", async () => {
    const windowStart = new Date(Date.now() - 3_600_000).toISOString();
    const { count, error } = await admin
      .from("ads_api_call_log")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopAId)
      .in("method", ["GET", "SEARCH"])
      .gte("created_at", windowStart);
    expect(error).toBeNull();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("RLS: a MEMBER reads their shop's accounts + campaigns", async () => {
    const member = await sessionClientFor(MULTI.email);
    const { data: accts } = await member
      .from("google_ads_accounts")
      .select("id")
      .eq("shop_id", shopAId);
    expect(accts?.length).toBe(1);
    const { data: camps } = await member
      .from("google_ads_campaigns")
      .select("id")
      .eq("shop_id", shopAId);
    expect(camps?.length).toBe(1);
  });

  test("RLS: a NON-member reads zero accounts + campaigns", async () => {
    const stranger = await sessionClientFor(OWNER.email); // not a member of MULTI shopA
    const { data: accts } = await stranger
      .from("google_ads_accounts")
      .select("id")
      .eq("shop_id", shopAId);
    expect(accts ?? []).toEqual([]);
    const { data: camps } = await stranger
      .from("google_ads_campaigns")
      .select("id")
      .eq("shop_id", shopAId);
    expect(camps ?? []).toEqual([]);
  });

  test("RLS: transient tables are default-deny even for a member", async () => {
    const member = await sessionClientFor(MULTI.email);
    const { data: states } = await member
      .from("google_ads_oauth_states")
      .select("state_token")
      .eq("shop_id", shopAId);
    expect(states ?? []).toEqual([]);
    const { data: log } = await member
      .from("ads_api_call_log")
      .select("id")
      .eq("shop_id", shopAId);
    expect(log ?? []).toEqual([]);
  });
});

test.describe("google ads — customer-facing hub", () => {
  test.use({ storageState: OWNER.statePath });

  let ownerShopId: string;
  let reportId: string;
  let needsInfoRequestId: string;
  let otherShopReportId: string;

  test.beforeAll(async () => {
    ownerShopId = await shopIdByName(OWNER.shopName);
    const otherShopId = await shopIdByName(MULTI.shopA);

    await admin.from("google_ads_customer_requests").delete().eq("shop_id", ownerShopId);
    await admin.from("google_ads_optimization_audit_reports").delete().eq("shop_id", ownerShopId);
    await admin.from("google_ads_campaigns").delete().eq("shop_id", ownerShopId);
    await admin.from("google_ads_accounts").delete().eq("shop_id", ownerShopId);

    const { data: acct, error: acctErr } = await admin
      .from("google_ads_accounts")
      .insert({
        shop_id: ownerShopId,
        customer_id: "9876543210",
        encrypted_refresh_token: "\\x746f6b656e",
        key_version: 1,
        scope: "https://www.googleapis.com/auth/adwords",
        status: "linked",
      })
      .select("id")
      .single();
    expect(acctErr, `account insert: ${acctErr?.message}`).toBeNull();

    const { error: campaignErr } = await admin.from("google_ads_campaigns").insert([
      {
        shop_id: ownerShopId,
        account_id: acct!.id,
        external_resource_name: "customers/9876543210/campaigns/100",
        external_id: "100",
        name: "E2E Collision Repair Leads",
        campaign_type: "SEARCH",
        status: "enabled",
        daily_budget_micros: 75000000,
        metrics: { conversions: 24, clicks: 300, impressions: 8000, cost_micros: 1800000000 },
        metrics_synced_at: new Date().toISOString(),
      },
    ]);
    expect(campaignErr, `campaign insert: ${campaignErr?.message}`).toBeNull();

    const { data: requestRows, error: requestErr } = await admin
      .from("google_ads_customer_requests")
      .insert([
        {
          shop_id: ownerShopId,
          requested_by_profile_id: (await admin.auth.admin.listUsers()).data.users.find(
            (user) => user.email === OWNER.email,
          )!.id,
          request_type: "campaign_adjustment",
          title: "Confirm repair services",
          details: "Please confirm which repair services should be promoted.",
          status: "needs_more_info",
          psg_response: "Which services should this campaign emphasize?",
        },
        {
          shop_id: ownerShopId,
          requested_by_profile_id: (await admin.auth.admin.listUsers()).data.users.find(
            (user) => user.email === OWNER.email,
          )!.id,
          request_type: "new_campaign",
          title: "Launch bumper repair",
          details: "Please launch a bumper repair campaign.",
          status: "done",
          psg_response: "Campaign is live.",
          resolved_at: new Date().toISOString(),
        },
      ])
      .select("id, status");
    expect(requestErr, `request insert: ${requestErr?.message}`).toBeNull();
    needsInfoRequestId = requestRows!.find((row) => row.status === "needs_more_info")!.id;

    reportId = "44444444-4444-4444-4444-444444444444";
    otherShopReportId = "55555555-5555-5555-5555-555555555555";
    await admin.storage
      .from("google-ads-audit-reports")
      .upload(`${ownerShopId}/${reportId}.pdf`, PDF_BYTES, {
        contentType: "application/pdf",
        upsert: true,
      });
    await admin.storage
      .from("google-ads-audit-reports")
      .upload(`${otherShopId}/${otherShopReportId}.pdf`, PDF_BYTES, {
        contentType: "application/pdf",
        upsert: true,
      });
    const opsUser = (await admin.auth.admin.listUsers()).data.users.find(
      (user) => user.email === OPS_STAFF.email,
    )!;
    const { error: reportErr } = await admin.from("google_ads_optimization_audit_reports").upsert(
      [
        {
          id: reportId,
          shop_id: ownerShopId,
          title: "E2E Google Ads report",
          period_month: "2026-07",
          storage_path: `${ownerShopId}/${reportId}.pdf`,
          original_filename: "e2e-google-ads-report.pdf",
          content_type: "application/pdf",
          byte_size: PDF_BYTES.byteLength,
          published_by_profile_id: opsUser.id,
        },
        {
          id: otherShopReportId,
          shop_id: otherShopId,
          title: "Other shop report",
          period_month: "2026-07",
          storage_path: `${otherShopId}/${otherShopReportId}.pdf`,
          original_filename: "other-shop-report.pdf",
          content_type: "application/pdf",
          byte_size: PDF_BYTES.byteLength,
          published_by_profile_id: opsUser.id,
        },
      ],
      { onConflict: "id" },
    );
    expect(reportErr, `report insert: ${reportErr?.message}`).toBeNull();
  });

  test("renders the customer hub, request workflow, reports, and screenshot evidence", async ({ page }) => {
    await page.goto("/dashboard/ads");

    await expect(page.getByRole("heading", { name: "Your Google Ads" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How your ads are doing" })).toBeVisible();
    await expect(page.getByText("Numbers current as of")).toBeVisible();
    await expect(page.getByText("Spend", { exact: true })).toBeVisible();
    await expect(page.getByText("Leads", { exact: true })).toBeVisible();
    await expect(page.getByText("Cost per lead", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Best-performing ads" })).toBeVisible();
    await expect(
      page.getByLabel("Best-performing ads").getByText("E2E Collision Repair Leads"),
    ).toBeVisible();

    const requests = [
      { type: "budget_change", fields: { "Requested monthly budget": "3000", "Why do you want this change?": "Increase qualified repair leads", "When would you like it?": "2026-09-01" } },
      { type: "campaign_status_change", fields: { "Pause or restart?": "Pause", "Why?": "Shop capacity is full", "Requested date": "2026-09-02", "If pausing, until when?": "September 15" } },
      { type: "new_campaign", fields: { "Service to promote": "Fleet repair", "Offer or message": "Fast fleet estimates", "Area to cover": "Riverside", "Start date": "2026-09-03", "Monthly budget guidance": "2500" } },
      { type: "ad_copy_change", fields: { "What is wrong?": "The service wording is outdated", "Exact new wording": "Certified aluminum repair", "Why should it change?": "Match current shop capabilities" } },
      { type: "location_change", fields: { "Current area": "Riverside", "Requested cities, ZIP codes, or radius": "Riverside and Moreno Valley" } },
      { type: "destination_change", fields: { "New phone number": "951-555-0100" } },
      { type: "performance_review", fields: { "What would you like us to review?": "Why did lead volume change?", "Which time period?": "Last 30 days" } },
      { type: "problem_report", fields: { "What is wrong?": "The dashboard numbers look stale", Example: "Yesterday and today match exactly", "When did it happen?": "This morning" } },
    ] as const;

    for (const request of requests) {
      await page.getByRole("button", { name: "Request a change" }).click();
      await page.getByLabel("Request type").selectOption(request.type);
      if (!["new_campaign", "performance_review", "problem_report"].includes(request.type)) {
        await page
          .getByRole("combobox", { name: "Campaign", exact: true })
          .selectOption({ label: "E2E Collision Repair Leads" });
      }
      for (const [label, value] of Object.entries(request.fields)) {
        await page.getByLabel(label).fill(value);
      }
      await page.getByRole("button", { name: "Review request" }).click();
      await page.getByText("I understand this is a request").click();
      await page.getByRole("button", { name: "Send for PSG review" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Nothing changed in Google Ads" }),
      ).toBeVisible();
    }

    const { data: submitted } = await admin
      .from("google_ads_customer_requests")
      .select("request_type, acknowledged_at")
      .eq("shop_id", ownerShopId)
      .eq("status", "submitted");
    expect(new Set(submitted?.map((row) => row.request_type))).toEqual(
      new Set(requests.map((request) => request.type)),
    );
    expect(submitted?.every((row) => row.acknowledged_at)).toBe(true);

    const { data: unchangedCampaign } = await admin
      .from("google_ads_campaigns")
      .select("status, daily_budget_micros")
      .eq("shop_id", ownerShopId)
      .single();
    expect(unchangedCampaign).toEqual({ status: "enabled", daily_budget_micros: 75000000 });

    await expect(page.getByText("We need one detail from you")).toBeVisible();
    await page.getByLabel("Your answer").fill("Promote certified aluminum repair and bumper repair.");
    await page.getByRole("button", { name: "Send detail" }).click();
    await expect(page.getByText("Detail sent to PSG.")).toBeVisible();

    await expect(page.getByText("Next report", { exact: true })).toBeVisible();
    await expect(page.getByText("E2E Google Ads report")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download report (PDF)" })).toBeVisible();

    await checkA11y(page, "google-ads-customer-hub");
    await shoot(page, "google-ads-customer-hub");
  });

  test("report owner can download and report non-owner is denied", async ({ page }) => {
    const ownerResponse = await page.request.get(`/api/google-ads/audit-reports/${reportId}/download`);
    expect(ownerResponse.status()).toBe(200);

    const nonOwnerResponse = await page.request.get(
      `/api/google-ads/audit-reports/${otherShopReportId}/download`,
    );
    expect(nonOwnerResponse.status()).toBe(403);
  });
});

test.describe("google ads — ops request status update", () => {
  test.use({ storageState: OPS_STAFF.statePath });

  test("PSG operations can move a customer request status from the browser context", async ({ page }) => {
    const ownerShopId = await shopIdByName(OWNER.shopName);
    const { data: request, error } = await admin
      .from("google_ads_customer_requests")
      .insert({
        shop_id: ownerShopId,
        requested_by_profile_id: (await admin.auth.admin.listUsers()).data.users.find(
          (user) => user.email === OWNER.email,
        )!.id,
        request_type: "campaign_adjustment",
        title: "Ops status proof",
        details: "Please update this request through the operations route.",
        status: "submitted",
      })
      .select("id")
      .single();
    expect(error, `status proof insert: ${error?.message}`).toBeNull();

    const response = await page.request.patch(`/api/ops/google-ads/requests/${request!.id}`, {
      data: {
        status: "in_progress",
        response: "PSG is working on it.",
      },
    });
    expect(response.status()).toBe(200);

    const { data: updated } = await admin
      .from("google_ads_customer_requests")
      .select("status, psg_response")
      .eq("id", request!.id)
      .single();
    expect(updated).toMatchObject({
      status: "in_progress",
      psg_response: "PSG is working on it.",
    });
  });
});
