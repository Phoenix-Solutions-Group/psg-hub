import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OWNER, MULTI, PASSWORD } from "./fixtures";
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

test.describe("google ads — /dashboard/ads online, unlinked surface (AC-3)", () => {
  // OWNER shop slug (e2e-owner-auto-body) is in SHOP_ADS_TIER_OVERRIDE
  // (.env.test.local) -> treated as Performance tier. 0 linked accounts -> the
  // empty-link state.
  test.use({ storageState: OWNER.statePath });

  test("renders the accounts/link surface, not the coming-soon guard, no mutation controls", async ({
    page,
  }) => {
    await page.goto("/dashboard/ads");

    // Real surface heading + the empty accounts state from <AccountsTable>.
    await expect(page.getByRole("heading", { name: "Google Ads" })).toBeVisible();
    await expect(
      page.getByText("No Google Ads account linked yet.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Link Google Ads" })
    ).toBeVisible();

    // The old "coming soon" guard copy is gone.
    await expect(page.getByText(/arrive in a later release/)).toHaveCount(0);

    // Campaign MUTATION is out of scope (v1.2 / D52) — no create/edit control.
    await expect(
      page.getByRole("button", { name: /Create campaign/i })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Create your first campaign/i })
    ).toHaveCount(0);

    await checkA11y(page, "google-ads-empty-link");
    await shoot(page, "google-ads-empty-link");
  });
});
