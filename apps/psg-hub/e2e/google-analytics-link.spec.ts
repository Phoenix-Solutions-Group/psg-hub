import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OWNER, MULTI, PASSWORD } from "./fixtures";

// Phase 11 / 11-01 — schema round-trip for the shared GA4 + GSC account model,
// with REAL clients against the LOCAL migrated DB (mirrors google-ads.spec.ts).
// Mocked unit tests replay nothing against the migration; only this catches
// column / constraint / RLS drift on google_oauth_accounts + the default-deny
// google_oauth_pending_states. Proves the load-bearing invariants:
//   - TWO rows (ga4 + gsc) for one shop SHARE one `\x<hex>` bytea refresh token,
//     and both decode byte-identical (the 10-01 raw-Buffer trap).
//   - a MEMBER reads its shop's rows via RLS; a NON-member reads 0.
//   - the transient pending-state table is default-deny even for a member.
// Self-seeds + cleans up; global.setup.ts is untouched.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Hard local-only guard (mirrors google-ads.spec) — service-role writes (RLS
// bypass) must NEVER touch shared prod.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
  throw new Error(
    `[e2e] Refusing to run google-oauth schema test: non-local target ${url}`
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

test.describe("google oauth — shared GA4+GSC account schema round-trip (AC-2, AC-5)", () => {
  let shopAId: string; // MULTI owns this -> member read
  const PLAINTEXT = "fake-google-refresh-token-üñ-11-01";
  const HEX_BYTEA = `\\x${Buffer.from(PLAINTEXT, "utf8").toString("hex")}`;
  const GA4_ID = "properties/123456789";
  const GSC_ID = "sc-domain:e2e-multi-shop-a.example";

  test.beforeAll(async () => {
    shopAId = await shopIdByName(MULTI.shopA);

    // Idempotent re-run without db reset.
    await admin.from("google_oauth_pending_states").delete().eq("shop_id", shopAId);
    await admin.from("google_oauth_accounts").delete().eq("shop_id", shopAId);

    // Two rows — one GA4, one GSC — SHARING the same encrypted refresh token, as
    // the /select route writes them. bytea via the `\x<hex>` text form.
    const { error: gErr } = await admin.from("google_oauth_accounts").insert([
      {
        shop_id: shopAId,
        source: "ga4",
        external_account_id: GA4_ID,
        display_name: "E2E GA4 Property",
        encrypted_refresh_token: HEX_BYTEA,
        key_version: 1,
        scope:
          "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
        status: "linked",
      },
      {
        shop_id: shopAId,
        source: "gsc",
        external_account_id: GSC_ID,
        display_name: GSC_ID,
        encrypted_refresh_token: HEX_BYTEA,
        key_version: 1,
        scope:
          "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly",
        status: "linked",
      },
    ]);
    expect(gErr, `accounts insert: ${gErr?.message}`).toBeNull();

    const { error: pErr } = await admin
      .from("google_oauth_pending_states")
      .insert({
        state_token: `e2e-google-state-${shopAId}`,
        user_id: "00000000-0000-0000-0000-000000000001",
        shop_id: shopAId,
        nonce: "e2e-nonce",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        pending_accounts: { ga4: [{ id: GA4_ID, name: "x" }], gsc: [] },
      });
    expect(pErr, `pending_state insert: ${pErr?.message}`).toBeNull();
  });

  test.afterAll(async () => {
    await admin.from("google_oauth_pending_states").delete().eq("shop_id", shopAId);
    await admin.from("google_oauth_accounts").delete().eq("shop_id", shopAId);
  });

  test("two rows share one bytea token; both read back byte-identical", async () => {
    const { data, error } = await admin
      .from("google_oauth_accounts")
      .select("source, external_account_id, encrypted_refresh_token")
      .eq("shop_id", shopAId)
      .order("source");
    expect(error).toBeNull();
    expect(data?.length).toBe(2);
    expect(data!.map((r) => r.source)).toEqual(["ga4", "gsc"]);
    for (const row of data!) {
      const raw = row.encrypted_refresh_token as unknown;
      // PostgREST returns bytea as a `\x<hex>` string; decode + compare.
      expect(typeof raw).toBe("string");
      expect((raw as string).startsWith("\\x")).toBe(true);
      const decoded = Buffer.from((raw as string).slice(2), "hex").toString(
        "utf8"
      );
      expect(decoded).toBe(PLAINTEXT);
    }
  });

  test("unique (shop_id, source, external_account_id) — re-link upserts, not dupes", async () => {
    const { error } = await admin.from("google_oauth_accounts").upsert(
      {
        shop_id: shopAId,
        source: "ga4",
        external_account_id: GA4_ID,
        display_name: "E2E GA4 Property (reconnected)",
        encrypted_refresh_token: HEX_BYTEA,
        key_version: 1,
        scope: "x",
        status: "linked",
      },
      { onConflict: "shop_id,source,external_account_id" }
    );
    expect(error, `upsert: ${error?.message}`).toBeNull();
    const { count } = await admin
      .from("google_oauth_accounts")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopAId)
      .eq("source", "ga4");
    expect(count).toBe(1);
  });

  test("RLS: a MEMBER reads their shop's ga4 + gsc rows", async () => {
    const member = await sessionClientFor(MULTI.email);
    const { data } = await member
      .from("google_oauth_accounts")
      .select("source")
      .eq("shop_id", shopAId);
    expect(data?.length).toBe(2);
  });

  test("RLS: a NON-member reads zero rows", async () => {
    const stranger = await sessionClientFor(OWNER.email); // not a member of MULTI shopA
    const { data } = await stranger
      .from("google_oauth_accounts")
      .select("source")
      .eq("shop_id", shopAId);
    expect(data ?? []).toEqual([]);
  });

  test("RLS: the pending-state table is default-deny even for a member", async () => {
    const member = await sessionClientFor(MULTI.email);
    const { data } = await member
      .from("google_oauth_pending_states")
      .select("state_token")
      .eq("shop_id", shopAId);
    expect(data ?? []).toEqual([]);
  });
});
