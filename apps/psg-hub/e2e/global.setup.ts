import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import {
  PASSWORD,
  AUTH_DIR,
  OWNER,
  MULTI,
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
  await seedShop(ownerId, OWNER.shopName, "owner");

  const multiId = await createUser(MULTI.email);
  await seedProfile(multiId, "E2E Multi");
  await ensureCustomerRole(multiId);
  await seedShop(multiId, MULTI.shopA, "owner");
  await seedShop(multiId, MULTI.shopB, "viewer");

  // 2. Real UI login per role -> persist @supabase/ssr cookies as storageState.
  for (const fx of [
    { email: OWNER.email, statePath: OWNER.statePath },
    { email: MULTI.email, statePath: MULTI.statePath },
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
