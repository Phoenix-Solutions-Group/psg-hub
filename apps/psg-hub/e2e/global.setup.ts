import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import {
  PASSWORD,
  AUTH_DIR,
  OWNER,
  MULTI,
  MEGA,
  SNAPSHOT_END_DATE,
  SNAPSHOT_SYNCED_AT,
  FIXTURE_SHOP_NAMES,
  FIXTURE_EMAILS,
} from "./fixtures";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Hard local-only guard. This seed deletes + creates rows with the service-role
// key (RLS bypass); it must NEVER run against the shared prod project.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
  throw new Error(
    `[e2e] Refusing to seed: target is not local (NEXT_PUBLIC_SUPABASE_URL=${url}). ` +
      `Ensure .env.test.local points at the local Supabase stack and \`supabase start\` is running.`
  );
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * profiles row for the user. `clients.created_by` and `app_user_roles.profile_id`
 * both FK -> profiles(id), and the local stack has no auth.users->profiles trigger,
 * so the fixture must create it explicitly (prod provisions it via a signup trigger
 * absent from the schema dump). The RBAC gate reads app_user_roles, not profiles.role.
 */
async function seedProfile(userId: string, displayName: string): Promise<void> {
  const { error } = await admin
    .from("profiles")
    // profiles.role CHECK = admin|reviewer|viewer (legacy column, NOT the RBAC
    // gate which reads app_user_roles). Least-privilege 'viewer' — no staff bypass.
    .insert({ id: userId, display_name: displayName, role: "viewer" });
  if (error) throw new Error(`[e2e] profile insert failed: ${error.message}`);
}

/** Mirror of /api/onboarding: client -> shop -> shop_users(role). */
async function seedShop(ownerId: string, name: string, role: string): Promise<string> {
  const { data: client, error: cErr } = await admin
    .from("clients")
    .insert({ name, website_url: null, created_by: ownerId })
    .select("id")
    .single();
  if (cErr || !client) throw new Error(`[e2e] client insert failed: ${cErr?.message}`);

  const { data: shop, error: sErr } = await admin
    .from("shops")
    .insert({ client_id: client.id, name, slug: slugify(name) })
    .select("id")
    .single();
  if (sErr || !shop) throw new Error(`[e2e] shop insert failed: ${sErr?.message}`);

  const { error: mErr } = await admin
    .from("shop_users")
    .insert({ user_id: ownerId, shop_id: shop.id, role });
  if (mErr) throw new Error(`[e2e] shop_users insert failed: ${mErr.message}`);

  return shop.id;
}

/**
 * 09-02: deterministic daily semrush snapshots for a shop (trailing `days`
 * ending SNAPSHOT_END_DATE). Values are formula-derived from the day index —
 * no randomness. Upsert on the idempotency key, so re-runs net zero new rows.
 */
async function seedSnapshots(shopId: string, days: number): Promise<void> {
  const end = new Date(`${SNAPSHOT_END_DATE}T00:00:00Z`).getTime();
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date(end - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      shop_id: shopId,
      source: "semrush",
      date: d,
      period: "daily",
      synced_at: SNAPSHOT_SYNCED_AT,
      metrics: {
        organic_traffic: 400 + i * 7,
        organic_keywords: 120 + i,
        organic_traffic_cost: 900 + i * 11,
        backlinks: 60 + i * 2,
        authority_score: 38,
      },
    };
  });
  const { error } = await admin
    .from("analytics_snapshots")
    .upsert(rows, { onConflict: "shop_id,source,date,period" });
  if (error) throw new Error(`[e2e] snapshot seed failed: ${error.message}`);
}

/**
 * 10-02: deterministic daily google_ads snapshots for a shop. Spend rises by
 * day index from `spendBase`; cpl = spend/conversions. Same idempotency key.
 */
async function seedGoogleAdsSnapshots(
  shopId: string,
  days: number,
  spendBase: number
): Promise<void> {
  const end = new Date(`${SNAPSHOT_END_DATE}T00:00:00Z`).getTime();
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date(end - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const spend = spendBase + i;
    const conversions = 5 + i;
    return {
      shop_id: shopId,
      source: "google_ads",
      date: d,
      period: "daily",
      synced_at: SNAPSHOT_SYNCED_AT,
      metrics: {
        spend,
        clicks: 50 + i,
        impressions: 1000 + i * 10,
        conversions,
        cpl: spend / conversions,
        cost_micros: spend * 1_000_000,
      },
    };
  });
  const { error } = await admin
    .from("analytics_snapshots")
    .upsert(rows, { onConflict: "shop_id,source,date,period" });
  if (error) throw new Error(`[e2e] google_ads snapshot seed failed: ${error.message}`);
}

/**
 * 11-02: deterministic daily ga4 snapshots for a shop. Sessions rise by day index
 * from `sessionsBase`; engagement_rate is a constant ratio (aggregate-excluded).
 * Same idempotency key.
 */
async function seedGa4Snapshots(
  shopId: string,
  days: number,
  sessionsBase: number
): Promise<void> {
  const end = new Date(`${SNAPSHOT_END_DATE}T00:00:00Z`).getTime();
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date(end - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sessions = sessionsBase + i * 5;
    return {
      shop_id: shopId,
      source: "ga4",
      date: d,
      period: "daily",
      synced_at: SNAPSHOT_SYNCED_AT,
      metrics: {
        sessions,
        total_users: sessions - 10,
        active_users: sessions - 20,
        new_users: 20 + i,
        engaged_sessions: sessions - 30,
        key_events: 3 + i,
        engagement_rate: 0.6,
      },
    };
  });
  const { error } = await admin
    .from("analytics_snapshots")
    .upsert(rows, { onConflict: "shop_id,source,date,period" });
  if (error) throw new Error(`[e2e] ga4 snapshot seed failed: ${error.message}`);
}

/**
 * 11-03: deterministic daily gsc snapshots for a shop. Clicks rise by 2 per day
 * index from `clicksBase`; ctr + position are constant ratios/averages
 * (aggregate-excluded). Same idempotency key.
 */
async function seedGscSnapshots(
  shopId: string,
  days: number,
  clicksBase: number
): Promise<void> {
  const end = new Date(`${SNAPSHOT_END_DATE}T00:00:00Z`).getTime();
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date(end - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const clicks = clicksBase + i * 2;
    return {
      shop_id: shopId,
      source: "gsc",
      date: d,
      period: "daily",
      synced_at: SNAPSHOT_SYNCED_AT,
      metrics: {
        clicks,
        impressions: clicks * 12,
        ctr: 0.08,
        position: 9.5,
      },
    };
  });
  const { error } = await admin
    .from("analytics_snapshots")
    .upsert(rows, { onConflict: "shop_id,source,date,period" });
  if (error) throw new Error(`[e2e] gsc snapshot seed failed: ${error.message}`);
}

async function seedGbpSnapshots(
  shopId: string,
  days: number,
  callsBase: number
): Promise<void> {
  const end = new Date(`${SNAPSHOT_END_DATE}T00:00:00Z`).getTime();
  const rows = Array.from({ length: days }, (_, i) => {
    const d = new Date(end - (days - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const calls = callsBase + i;
    // All FLOW counts (no ratio). impressions_total = the four splits summed, exactly
    // as 13-02b's parser derives it (calls*1 + *2 + *3 + *4 = calls*10).
    return {
      shop_id: shopId,
      source: "gbp",
      date: d,
      period: "daily",
      synced_at: SNAPSHOT_SYNCED_AT,
      metrics: {
        call_clicks: calls,
        website_clicks: calls * 4,
        direction_requests: Math.floor(calls / 4),
        conversations: calls,
        impressions_desktop_maps: calls,
        impressions_desktop_search: calls * 2,
        impressions_mobile_maps: calls * 3,
        impressions_mobile_search: calls * 4,
        impressions_total: calls * 10,
      },
    };
  });
  const { error } = await admin
    .from("analytics_snapshots")
    .upsert(rows, { onConflict: "shop_id,source,date,period" });
  if (error) throw new Error(`[e2e] gbp snapshot seed failed: ${error.message}`);
}

async function ensureCustomerRole(userId: string): Promise<void> {
  const { data: existing } = await admin
    .from("app_user_roles")
    .select("profile_id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (!existing) {
    await admin.from("app_user_roles").insert({ profile_id: userId, role: "customer" });
  }
}

/** Idempotent: remove any prior fixture data so re-runs (without db reset) are clean. */
async function cleanup(): Promise<void> {
  const { data: shops } = await admin
    .from("shops")
    .select("id, client_id")
    .in("name", FIXTURE_SHOP_NAMES);
  for (const s of shops ?? []) {
    await admin.from("analytics_snapshots").delete().eq("shop_id", s.id);
    await admin.from("shop_users").delete().eq("shop_id", s.id);
    await admin.from("shops").delete().eq("id", s.id);
    if (s.client_id) await admin.from("clients").delete().eq("id", s.client_id);
  }

  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of list?.users ?? []) {
    if (u.email && FIXTURE_EMAILS.includes(u.email)) {
      await admin.from("app_user_roles").delete().eq("profile_id", u.id);
      await admin.from("shop_users").delete().eq("user_id", u.id);
      // profiles last among public rows: clients.created_by FK -> profiles, and
      // those clients were already removed above by name.
      await admin.from("profiles").delete().eq("id", u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  }
}

async function createUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`[e2e] createUser ${email} failed: ${error?.message}`);
  return data.user.id;
}

setup("seed fixtures + per-role storageState", async ({ browser }) => {
  setup.setTimeout(120_000);
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // 1. Programmatic seed (service-role ladder, dynamic UUIDs).
  await cleanup();

  const ownerId = await createUser(OWNER.email);
  await seedProfile(ownerId, "E2E Owner");
  await ensureCustomerRole(ownerId);
  const ownerShopId = await seedShop(ownerId, OWNER.shopName, "owner");

  const multiId = await createUser(MULTI.email);
  await seedProfile(multiId, "E2E Multi");
  await ensureCustomerRole(multiId);
  const shopAId = await seedShop(multiId, MULTI.shopA, "owner");
  const shopBId = await seedShop(multiId, MULTI.shopB, "viewer");

  // 09-02: big-MSO fixture — 9 owned shops drives the switcher typeahead (>=8).
  const megaId = await createUser(MEGA.email);
  await seedProfile(megaId, "E2E Mega");
  await ensureCustomerRole(megaId);
  for (const name of MEGA.shopNames) {
    await seedShop(megaId, name, "owner");
  }

  // 09-02: deterministic analytics snapshots (charts + MSO aggregate data).
  await seedSnapshots(ownerShopId, 30);
  await seedSnapshots(shopAId, 14);
  await seedSnapshots(shopBId, 14);

  // 10-02: paid (google_ads) snapshots for OWNER + the MULTI shops. MEGA is left
  // WITHOUT a paid source on purpose — drives the "No Google Ads account linked"
  // unlinked-state assertion. Aggregate spend on the latest day = 113 + 213 = 326.
  await seedGoogleAdsSnapshots(ownerShopId, 30, 100);
  await seedGoogleAdsSnapshots(shopAId, 14, 100);
  await seedGoogleAdsSnapshots(shopBId, 14, 200);

  // 11-02: ga4 (website traffic) snapshots for OWNER + the MULTI shops. MEGA is
  // left WITHOUT a ga4 source on purpose — drives the "No Google Analytics
  // property linked" unlinked-state assertion. Latest-day sessions: OWNER
  // 500+29*5=645, A 500+13*5=565, B 800+13*5=865; aggregate A+B = 1430.
  await seedGa4Snapshots(ownerShopId, 30, 500);
  await seedGa4Snapshots(shopAId, 14, 500);
  await seedGa4Snapshots(shopBId, 14, 800);

  // 11-03: gsc (search performance) snapshots for OWNER + the MULTI shops. MEGA is
  // left WITHOUT a gsc source on purpose — drives the "No Google Search Console site
  // linked" unlinked-state assertion. Latest-day clicks: OWNER 200+29*2=258, A
  // 200+13*2=226, B 400+13*2=426; aggregate A+B = 652.
  await seedGscSnapshots(ownerShopId, 30, 200);
  await seedGscSnapshots(shopAId, 14, 200);
  await seedGscSnapshots(shopBId, 14, 400);

  // 13-02b: gbp (local presence) snapshots for OWNER + the MULTI shops. MEGA is left
  // WITHOUT a gbp source on purpose — drives the "No Google Business Profile linked"
  // unlinked-state assertion. Latest-day call_clicks (callsBase + idx): OWNER
  // 300+29=329, A 300+13=313, B 500+13=513; aggregate A+B = 826. Every gbp metric is
  // summable, so the aggregate keeps ALL KPIs (none excluded).
  await seedGbpSnapshots(ownerShopId, 30, 300);
  await seedGbpSnapshots(shopAId, 14, 300);
  await seedGbpSnapshots(shopBId, 14, 500);

  // 2. Real UI login per role -> persist @supabase/ssr cookies as storageState.
  for (const fx of [
    { email: OWNER.email, statePath: OWNER.statePath },
    { email: MULTI.email, statePath: MULTI.statePath },
    { email: MEGA.email, statePath: MEGA.statePath },
  ]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(fx.email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await ctx.storageState({ path: fx.statePath });
    await ctx.close();
  }
});
