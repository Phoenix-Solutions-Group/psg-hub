#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
for (const file of [
  ".env.preview.local",
  ".env.local",
  ".env.test.local",
]) {
  loadEnvFile(path.join(root, file));
}

const isCliInvocation = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const operatorEmail = process.env.DEMO_OPERATOR_EMAIL;
const operatorPassword = process.env.DEMO_OPERATOR_PASSWORD;
const shopEmail = process.env.DEMO_SHOP_EMAIL;
const shopPassword = process.env.DEMO_SHOP_PASSWORD;
const includeInternalRegressionUser = shouldSeedInternalRegressionUser(process.env);
const internalEmail = includeInternalRegressionUser ? process.env.DEMO_INTERNAL_EMAIL : undefined;
const internalPassword = includeInternalRegressionUser ? process.env.DEMO_INTERNAL_PASSWORD : undefined;

export const CLEAN_DEMO_SEED = {
  operatorDisplayName: "BSM Demo Admin",
  shopUserDisplayName: "BSM Demo User",
  internalDisplayName: "BSM Regression Internal Staff",
  clientName: "BSM Demo Client",
  shopName: "BSM Demo Collision Center",
  shopSlug: "bsm-demo-collision-center",
  moduleSlug: "bsm-demo-walkthrough",
  moduleDisplayName: "BSM Demo Walkthrough",
  legacyClientName: "QA Superadmin Walkthrough Client",
  legacyShopSlug: "qa-superadmin-walkthrough",
  legacyModuleSlug: "qa-superadmin-walkthrough",
  legacyInternalEmail: "qa-internal-staff@psg.test",
};

export function shouldSeedInternalRegressionUser(env = process.env) {
  return env.DEMO_INCLUDE_INTERNAL_REGRESSION_USER === "1";
}

export function requiredDemoEnvNames(env = process.env) {
  const required = [
    "DEMO_OPERATOR_EMAIL",
    "DEMO_OPERATOR_PASSWORD",
    "DEMO_SHOP_EMAIL",
    "DEMO_SHOP_PASSWORD",
  ];
  if (shouldSeedInternalRegressionUser(env)) {
    required.push("DEMO_INTERNAL_EMAIL", "DEMO_INTERNAL_PASSWORD");
  }
  return required;
}

let supabase;

function connectSupabase() {
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

async function findAuthUserByEmail(email) {
  const needle = email.toLowerCase();
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Auth user lookup failed: ${error.message}`);
    const found = data.users.find((user) => user.email?.toLowerCase() === needle);
    if (found) return found;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function ensureAuthUser({ email, password, displayName }) {
  const existing = await findAuthUserByEmail(email);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error) throw new Error(`Update auth user ${email} failed: ${error.message}`);
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error) throw new Error(`Create auth user ${email} failed: ${error.message}`);
  return data.user;
}

async function deleteAuthUserByEmail(email) {
  const existing = await findAuthUserByEmail(email);
  if (!existing) return;
  await supabase.from("app_user_roles").delete().eq("profile_id", existing.id);
  await supabase.from("shop_users").delete().eq("user_id", existing.id);
  await supabase.from("profiles").delete().eq("id", existing.id);
  const { error } = await supabase.auth.admin.deleteUser(existing.id);
  if (error) throw new Error(`Delete auth user ${email} failed: ${error.message}`);
}

async function upsertProfile(user, displayName, role = "viewer") {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      display_name: displayName,
      role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw new Error(`Profile upsert for ${displayName} failed: ${error.message}`);
}

async function upsertByLookup({ table, select = "id", filters, insert, update, label }) {
  let query = supabase.from(table).select(select).limit(1);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const existing = await query;
  if (existing.error) throw new Error(`${label} lookup failed: ${existing.error.message}`);

  if (existing.data?.[0]) {
    const { data, error } = await supabase
      .from(table)
      .update(update ?? insert)
      .eq("id", existing.data[0].id)
      .select(select)
      .single();
    if (error) throw new Error(`${label} update failed: ${error.message}`);
    return data;
  }

  const { data, error } = await supabase.from(table).insert(insert).select(select).single();
  if (error) throw new Error(`${label} insert failed: ${error.message}`);
  return data;
}

async function cleanupLegacyDemoSeedRows() {
  const { data: legacyShop } = await supabase
    .from("shops")
    .select("id, client_id")
    .eq("slug", CLEAN_DEMO_SEED.legacyShopSlug)
    .maybeSingle();
  if (legacyShop) {
    await supabase.from("module_access_grants").delete().eq("shop_id", legacyShop.id);
    await supabase.from("subscriptions").delete().eq("shop_id", legacyShop.id);
    await supabase.from("shop_users").delete().eq("shop_id", legacyShop.id);
    await supabase.from("shops").delete().eq("id", legacyShop.id);
    if (legacyShop.client_id) {
      await supabase.from("clients").delete().eq("id", legacyShop.client_id);
    }
  }
  await supabase.from("clients").delete().eq("name", CLEAN_DEMO_SEED.legacyClientName);
  await supabase.from("modules").delete().eq("slug", CLEAN_DEMO_SEED.legacyModuleSlug);
  if (!includeInternalRegressionUser) {
    await deleteAuthUserByEmail(CLEAN_DEMO_SEED.legacyInternalEmail);
  }
}

async function main() {
  const missingDemoEnv = requiredDemoEnvNames(process.env).filter((key) => !process.env[key]);
  if (missingDemoEnv.length > 0) {
    throw new Error(`Missing required demo seed env vars: ${missingDemoEnv.join(", ")}.`);
  }
  supabase = connectSupabase();

  await cleanupLegacyDemoSeedRows();

  const operator = await ensureAuthUser({
    email: operatorEmail,
    password: operatorPassword,
    displayName: CLEAN_DEMO_SEED.operatorDisplayName,
  });
  const shopUser = await ensureAuthUser({
    email: shopEmail,
    password: shopPassword,
    displayName: CLEAN_DEMO_SEED.shopUserDisplayName,
  });

  await upsertProfile(operator, CLEAN_DEMO_SEED.operatorDisplayName, "admin");
  await upsertProfile(shopUser, CLEAN_DEMO_SEED.shopUserDisplayName, "viewer");

  const client = await upsertByLookup({
    table: "clients",
    filters: { name: CLEAN_DEMO_SEED.clientName },
    insert: {
      name: CLEAN_DEMO_SEED.clientName,
      website_url: "https://bsm-demo.example",
      primary_market: "San Francisco, CA",
      zip_code: "94107",
    },
    update: {
      website_url: "https://bsm-demo.example",
      primary_market: "San Francisco, CA",
      zip_code: "94107",
    },
    label: "BSM demo client",
  });

  const shop = await upsertByLookup({
    table: "shops",
    filters: { slug: CLEAN_DEMO_SEED.shopSlug },
    insert: {
      client_id: client.id,
      name: CLEAN_DEMO_SEED.shopName,
      slug: CLEAN_DEMO_SEED.shopSlug,
      url: "https://bsm-demo.example",
      telephone: "(555) 010-1209",
      address_locality: "San Francisco",
      address_region: "CA",
      address_postal_code: "94107",
      address_country: "US",
    },
    update: {
      client_id: client.id,
      name: CLEAN_DEMO_SEED.shopName,
      url: "https://bsm-demo.example",
      telephone: "(555) 010-1209",
      address_locality: "San Francisco",
      address_region: "CA",
      address_postal_code: "94107",
      address_country: "US",
    },
    label: "BSM demo shop",
  });

  const roleRows = [
    { profile_id: operator.id, role: "psg_superadmin" },
    { profile_id: shopUser.id, role: "customer" },
  ];

  if (includeInternalRegressionUser) {
    const internalUser = await ensureAuthUser({
      email: internalEmail,
      password: internalPassword,
      displayName: CLEAN_DEMO_SEED.internalDisplayName,
    });
    await upsertProfile(internalUser, CLEAN_DEMO_SEED.internalDisplayName, "viewer");
    roleRows.push({ profile_id: internalUser.id, role: "psg_internal" });
  }

  const { error: roleError } = await supabase
    .from("app_user_roles")
    .upsert(roleRows, { onConflict: "profile_id" });
  if (roleError) throw new Error(`Role upsert failed: ${roleError.message}`);

  const { error: membershipError } = await supabase.from("shop_users").upsert(
    { user_id: shopUser.id, shop_id: shop.id, role: "manager" },
    { onConflict: "user_id,shop_id" }
  );
  if (membershipError) throw new Error(`Shop membership upsert failed: ${membershipError.message}`);

  const { error: subError } = await supabase.from("subscriptions").upsert(
    {
      shop_id: shop.id,
      stripe_customer_id: `qa-superadmin-${shop.id}`,
      stripe_subscription_id: `qa-superadmin-${shop.id}`,
      tier: "growth",
      status: "active",
    },
    { onConflict: "shop_id" }
  );
  if (subError) throw new Error(`Subscription upsert failed: ${subError.message}`);

  await upsertByLookup({
    table: "modules",
    filters: { slug: CLEAN_DEMO_SEED.moduleSlug },
    insert: {
      slug: CLEAN_DEMO_SEED.moduleSlug,
      display_name: CLEAN_DEMO_SEED.moduleDisplayName,
      audience: "customer",
      min_tier_slug: "growth",
      default_visibility: "visible",
    },
    update: {
      display_name: CLEAN_DEMO_SEED.moduleDisplayName,
      audience: "customer",
      min_tier_slug: "growth",
      default_visibility: "visible",
    },
    label: "BSM demo module",
  });

  console.log("Seeded clean BSM demo environment.");
  console.log(`Operator: ${operatorEmail}`);
  console.log(`Shop user: ${shopEmail}`);
  if (includeInternalRegressionUser) {
    console.log(`Regression-only internal staff: ${internalEmail}`);
  }
  console.log(`Shop: ${shop.id}`);
}

if (isCliInvocation) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
