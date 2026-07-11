#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
for (const file of [
  ".env.preview.local",
  ".env.local",
  ".env.test.local",
]) {
  loadEnvFile(path.join(root, file));
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const operatorEmail = process.env.DEMO_OPERATOR_EMAIL;
const operatorPassword = process.env.DEMO_OPERATOR_PASSWORD;
const shopEmail = process.env.DEMO_SHOP_EMAIL;
const shopPassword = process.env.DEMO_SHOP_PASSWORD;

if (!url || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}
if (!operatorEmail || !operatorPassword || !shopEmail || !shopPassword) {
  throw new Error(
    "Missing DEMO_OPERATOR_EMAIL, DEMO_OPERATOR_PASSWORD, DEMO_SHOP_EMAIL, or DEMO_SHOP_PASSWORD."
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

async function main() {
  const operator = await ensureAuthUser({
    email: operatorEmail,
    password: operatorPassword,
    displayName: "QA Superadmin",
  });
  const shopUser = await ensureAuthUser({
    email: shopEmail,
    password: shopPassword,
    displayName: "QA Shop User",
  });

  await upsertProfile(operator, "QA Superadmin", "admin");
  await upsertProfile(shopUser, "QA Shop User", "viewer");

  const client = await upsertByLookup({
    table: "clients",
    filters: { name: "QA Superadmin Walkthrough Client" },
    insert: {
      name: "QA Superadmin Walkthrough Client",
      website_url: "https://qa-superadmin.example",
      primary_market: "San Francisco, CA",
      zip_code: "94107",
    },
    update: {
      website_url: "https://qa-superadmin.example",
      primary_market: "San Francisco, CA",
      zip_code: "94107",
    },
    label: "QA client",
  });

  const shop = await upsertByLookup({
    table: "shops",
    filters: { slug: "qa-superadmin-walkthrough" },
    insert: {
      client_id: client.id,
      name: "QA Superadmin Walkthrough Shop",
      slug: "qa-superadmin-walkthrough",
      url: "https://qa-superadmin.example",
      telephone: "(555) 010-1209",
      address_locality: "San Francisco",
      address_region: "CA",
      address_postal_code: "94107",
      address_country: "US",
    },
    update: {
      client_id: client.id,
      name: "QA Superadmin Walkthrough Shop",
      url: "https://qa-superadmin.example",
      telephone: "(555) 010-1209",
      address_locality: "San Francisco",
      address_region: "CA",
      address_postal_code: "94107",
      address_country: "US",
    },
    label: "QA shop",
  });

  const { error: roleError } = await supabase.from("app_user_roles").upsert(
    [
      { profile_id: operator.id, role: "psg_superadmin" },
      { profile_id: shopUser.id, role: "customer" },
    ],
    { onConflict: "profile_id" }
  );
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
    filters: { slug: "qa-superadmin-walkthrough" },
    insert: {
      slug: "qa-superadmin-walkthrough",
      display_name: "QA Superadmin Walkthrough",
      audience: "customer",
      min_tier_slug: "growth",
      default_visibility: "visible",
    },
    update: {
      display_name: "QA Superadmin Walkthrough",
      audience: "customer",
      min_tier_slug: "growth",
      default_visibility: "visible",
    },
    label: "QA module",
  });

  console.log("Seeded QA superadmin walkthrough environment.");
  console.log(`Operator: ${operatorEmail}`);
  console.log(`Shop user: ${shopEmail}`);
  console.log(`Shop: ${shop.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
