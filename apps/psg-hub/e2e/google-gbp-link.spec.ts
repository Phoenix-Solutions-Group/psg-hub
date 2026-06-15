import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OWNER, MULTI, PASSWORD } from "./fixtures";

// Phase 13 / 13-01 — schema round-trip for the GBP source row on the shared
// google_oauth_accounts model, with REAL clients against the LOCAL migrated DB
// (mirrors google-analytics-link.spec.ts). Only this catches column / constraint /
// RLS drift from the 20260614194040_gbp_oauth_source migration. Proves:
//   - the widened source CHECK admits 'gbp' (an insert with source='gbp' succeeds).
//   - the new external_parent_id column stores the parent accounts/{id} and the
//     external_account_id stores the bare locations/{id}.
//   - the bytea refresh token round-trips byte-identical (the 10-01 trap).
//   - a MEMBER reads its shop's gbp row via RLS; a NON-member reads 0.
//   - a pre-existing ga4 row on the same shop is UNTOUCHED by the gbp write.
// Self-seeds + cleans up; global.setup.ts is untouched.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Hard local-only guard — service-role writes (RLS bypass) must NEVER touch prod.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
  throw new Error(
    `[e2e] Refusing to run gbp schema test: non-local target ${url}`
  );
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
  if (error || !data)
    throw new Error(`[e2e] shop "${name}" not found: ${error?.message}`);
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

test.describe("google oauth — GBP source schema round-trip (AC-2, AC-5)", () => {
  let shopAId: string; // MULTI owns this -> member read
  const PLAINTEXT = "fake-gbp-refresh-token-üñ-13-01";
  const HEX_BYTEA = `\\x${Buffer.from(PLAINTEXT, "utf8").toString("hex")}`;
  const LOCATION_ID = "locations/13571113";
  const ACCOUNT_ID = "accounts/24681012";
  const GA4_ID = "properties/999000111"; // a sibling row that must stay untouched
  const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

  test.beforeAll(async () => {
    shopAId = await shopIdByName(MULTI.shopA);

    // Idempotent re-run without db reset.
    await admin.from("google_oauth_accounts").delete().eq("shop_id", shopAId);

    // A pre-existing GA4 row (sibling source) + the GBP row, as /gbp/select writes
    // it: bare locations/{id} in external_account_id, accounts/{id} in
    // external_parent_id, the bytea token in `\x<hex>` text form.
    const { error: gErr } = await admin.from("google_oauth_accounts").insert([
      {
        shop_id: shopAId,
        source: "ga4",
        external_account_id: GA4_ID,
        display_name: "E2E GA4 Property",
        encrypted_refresh_token: `\\x${Buffer.from("ga4-token", "utf8").toString("hex")}`,
        key_version: 1,
        scope: "https://www.googleapis.com/auth/analytics.readonly",
        status: "linked",
      },
      {
        shop_id: shopAId,
        source: "gbp",
        external_account_id: LOCATION_ID,
        external_parent_id: ACCOUNT_ID,
        display_name: "Wallace Collision Center",
        encrypted_refresh_token: HEX_BYTEA,
        key_version: 1,
        scope: GBP_SCOPE,
        status: "linked",
      },
    ]);
    expect(gErr, `accounts insert (incl. source='gbp'): ${gErr?.message}`).toBeNull();
  });

  test.afterAll(async () => {
    await admin.from("google_oauth_accounts").delete().eq("shop_id", shopAId);
  });

  test("source CHECK admits 'gbp'; row stores bare location + parent account", async () => {
    const { data, error } = await admin
      .from("google_oauth_accounts")
      .select("source, external_account_id, external_parent_id, encrypted_refresh_token")
      .eq("shop_id", shopAId)
      .eq("source", "gbp")
      .single();
    expect(error, `gbp row select: ${error?.message}`).toBeNull();
    expect(data!.external_account_id).toBe(LOCATION_ID);
    expect(data!.external_parent_id).toBe(ACCOUNT_ID);
    // bytea round-trips as a `\x<hex>` string; decode + compare byte-identical.
    const raw = data!.encrypted_refresh_token as unknown;
    expect(typeof raw).toBe("string");
    expect((raw as string).startsWith("\\x")).toBe(true);
    expect(Buffer.from((raw as string).slice(2), "hex").toString("utf8")).toBe(
      PLAINTEXT
    );
  });

  test("the sibling ga4 row is untouched (external_parent_id null for non-gbp)", async () => {
    const { data, error } = await admin
      .from("google_oauth_accounts")
      .select("external_account_id, external_parent_id")
      .eq("shop_id", shopAId)
      .eq("source", "ga4")
      .single();
    expect(error).toBeNull();
    expect(data!.external_account_id).toBe(GA4_ID);
    expect(data!.external_parent_id).toBeNull();
  });

  test("unique (shop_id, source, external_account_id) — re-link upserts, not dupes", async () => {
    const { error } = await admin.from("google_oauth_accounts").upsert(
      {
        shop_id: shopAId,
        source: "gbp",
        external_account_id: LOCATION_ID,
        external_parent_id: ACCOUNT_ID,
        display_name: "Wallace Collision Center (reconnected)",
        encrypted_refresh_token: HEX_BYTEA,
        key_version: 1,
        scope: GBP_SCOPE,
        status: "linked",
      },
      { onConflict: "shop_id,source,external_account_id" }
    );
    expect(error, `upsert: ${error?.message}`).toBeNull();
    const { count } = await admin
      .from("google_oauth_accounts")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopAId)
      .eq("source", "gbp");
    expect(count).toBe(1);
  });

  test("RLS: a MEMBER reads their shop's gbp row", async () => {
    const member = await sessionClientFor(MULTI.email);
    const { data } = await member
      .from("google_oauth_accounts")
      .select("source, external_parent_id")
      .eq("shop_id", shopAId)
      .eq("source", "gbp");
    expect(data?.length).toBe(1);
    expect(data![0].external_parent_id).toBe(ACCOUNT_ID);
  });

  test("RLS: a NON-member reads zero rows", async () => {
    const stranger = await sessionClientFor(OWNER.email); // not a member of MULTI shopA
    const { data } = await stranger
      .from("google_oauth_accounts")
      .select("source")
      .eq("shop_id", shopAId);
    expect(data ?? []).toEqual([]);
  });
});
