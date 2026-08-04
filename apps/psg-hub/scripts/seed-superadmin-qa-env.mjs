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
const directMailOnly = process.env.SEED_RIVERSIDE_DIRECT_MAIL_ONLY === "1";

export const CLEAN_DEMO_SEED = {
  operatorDisplayName: "BSM Demo Admin",
  shopUserDisplayName: "BSM Demo User",
  internalDisplayName: "BSM Regression Internal Staff",
  clientName: "Riverside Collision",
  shopName: "Riverside Collision",
  shopSlug: "riverside-collision",
  moduleSlug: "bsm-demo-walkthrough",
  moduleDisplayName: "BSM Demo Walkthrough",
  previousClientName: "BSM Demo Client",
  previousShopSlug: "bsm-demo-collision-center",
  previousPilotShopName: "PSG Pilot Body Shop",
  previousPilotShopSlug: "psg-pilot-body-shop",
  legacyClientName: "QA Superadmin Walkthrough Client",
  legacyShopSlug: "qa-superadmin-walkthrough",
  legacyModuleSlug: "qa-superadmin-walkthrough",
  legacyInternalEmail: "qa-internal-staff@psg.test",
  riversideAnalytics: {
    organicTraffic: 184,
    organicKeywords: 57,
    authorityScore: 41,
    backlinks: 142,
  },
  directMail: {
    sends: 45,
    priorSent: 72,
    priorOutcomes: 11,
    segmentKey: "demo-riverside-direct-mail",
  },
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

export function assertNoSupabaseError(result, label) {
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  return result;
}

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
  assertNoSupabaseError(
    await supabase.from("app_user_roles").delete().eq("profile_id", existing.id),
    `Delete roles for ${email}`
  );
  assertNoSupabaseError(
    await supabase.from("shop_users").delete().eq("user_id", existing.id),
    `Delete shop memberships for ${email}`
  );
  assertNoSupabaseError(
    await supabase.from("profiles").delete().eq("id", existing.id),
    `Delete profile for ${email}`
  );
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
  const legacyShopFilters = [
    { column: "slug", value: CLEAN_DEMO_SEED.legacyShopSlug },
    { column: "slug", value: CLEAN_DEMO_SEED.previousShopSlug },
    { column: "slug", value: CLEAN_DEMO_SEED.previousPilotShopSlug },
    { column: "name", value: CLEAN_DEMO_SEED.previousPilotShopName },
  ];

  const legacyShopIds = new Set();
  for (const { column, value } of legacyShopFilters) {
    const { data, error } = await supabase
      .from("shops")
      .select("id, client_id")
      .eq(column, value);
    if (error) throw new Error(`Legacy demo shop lookup failed: ${error.message}`);
    for (const demoShop of data ?? []) {
      if (legacyShopIds.has(demoShop.id)) continue;
      legacyShopIds.add(demoShop.id);
      assertNoSupabaseError(
        await supabase.from("analytics_snapshots").delete().eq("shop_id", demoShop.id),
        `Delete analytics snapshots for legacy demo shop ${demoShop.id}`
      );
      assertNoSupabaseError(
        await supabase.from("module_access_grants").delete().eq("shop_id", demoShop.id),
        `Delete module grants for legacy demo shop ${demoShop.id}`
      );
      assertNoSupabaseError(
        await supabase.from("subscriptions").delete().eq("shop_id", demoShop.id),
        `Delete subscriptions for legacy demo shop ${demoShop.id}`
      );
      assertNoSupabaseError(
        await supabase.from("shop_users").delete().eq("shop_id", demoShop.id),
        `Delete memberships for legacy demo shop ${demoShop.id}`
      );

      const deleteShopResult = await supabase.from("shops").delete().eq("id", demoShop.id);
      if (deleteShopResult.error?.message?.includes("access_audit is append-only")) {
        console.warn(
          `Kept historical legacy demo shop ${demoShop.id}; append-only audit rows prevent deleting the shop record.`
        );
      } else {
        assertNoSupabaseError(
          deleteShopResult,
          `Delete legacy demo shop ${demoShop.id}`
        );
      }

      if (demoShop.client_id) {
        const deleteClientResult = await supabase
          .from("clients")
          .delete()
          .eq("id", demoShop.client_id);
        if (
          deleteClientResult.error?.code !== "23503" &&
          !deleteClientResult.error?.message?.includes("access_audit is append-only")
        ) {
          assertNoSupabaseError(
            deleteClientResult,
            `Delete client for legacy demo shop ${demoShop.id}`
          );
        } else if (deleteClientResult.error?.message?.includes("access_audit is append-only")) {
          console.warn(
            `Kept historical legacy demo client ${demoShop.client_id}; append-only audit rows prevent deleting the client record.`
          );
        }
      }
    }
  }
  for (const clientName of [CLEAN_DEMO_SEED.legacyClientName, CLEAN_DEMO_SEED.previousClientName]) {
    const result = await supabase.from("clients").delete().eq("name", clientName);
    if (
      result.error?.code !== "23503" &&
      !result.error?.message?.includes("access_audit is append-only")
    ) {
      assertNoSupabaseError(result, `Delete legacy demo client ${clientName}`);
    } else if (result.error?.message?.includes("access_audit is append-only")) {
      console.warn(
        `Kept historical legacy demo client ${clientName}; append-only audit rows prevent deleting the client record.`
      );
    }
  }
  assertNoSupabaseError(
    await supabase.from("modules").delete().eq("slug", CLEAN_DEMO_SEED.legacyModuleSlug),
    `Delete legacy demo module ${CLEAN_DEMO_SEED.legacyModuleSlug}`
  );
  if (!includeInternalRegressionUser) {
    await deleteAuthUserByEmail(CLEAN_DEMO_SEED.legacyInternalEmail);
  }
}

function trailingDemoDates(days) {
  const to = new Date();
  to.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const d = new Date(to);
    d.setUTCDate(to.getUTCDate() - (days - 1 - index));
    return d.toISOString().slice(0, 10);
  });
}

async function seedRiversideAnalytics(shopId) {
  const dates = trailingDemoDates(30);
  const latest = CLEAN_DEMO_SEED.riversideAnalytics;
  const rows = dates.map((date, index) => {
    const remainingDays = dates.length - 1 - index;
    return {
      shop_id: shopId,
      source: "semrush",
      date,
      period: "daily",
      synced_at: `${dates.at(-1)}T12:00:00Z`,
      metrics: {
        organic_traffic: latest.organicTraffic - remainingDays,
        organic_keywords: latest.organicKeywords - remainingDays,
        organic_traffic_cost: 580 + index * 11,
        backlinks: latest.backlinks - remainingDays,
        authority_score: latest.authorityScore,
      },
    };
  });

  const { error: deleteGoogleError } = await supabase
    .from("analytics_snapshots")
    .delete()
    .eq("shop_id", shopId)
    .in("source", ["google_ads", "ga4", "gsc", "gbp", "gbp_presence"]);
  if (deleteGoogleError) {
    throw new Error(`Riverside Google demo cleanup failed: ${deleteGoogleError.message}`);
  }

  const { error } = await supabase
    .from("analytics_snapshots")
    .upsert(rows, { onConflict: "shop_id,source,date,period" });
  if (error) throw new Error(`Riverside analytics seed failed: ${error.message}`);
}

async function seedRiversideDirectMail(shopId) {
  const company = await upsertByLookup({
    table: "companies",
    filters: { shop_id: shopId },
    insert: {
      shop_id: shopId,
      name: CLEAN_DEMO_SEED.shopName,
      status: "active",
    },
    update: {
      name: CLEAN_DEMO_SEED.shopName,
      status: "active",
    },
    label: "Riverside direct-mail company",
  });
  const dates = trailingDemoDates(CLEAN_DEMO_SEED.directMail.sends);
  const historyRows = dates.map((sentDate, index) => ({
    company_id: company.id,
    shop_name: CLEAN_DEMO_SEED.shopName,
    piece_code: index % 3 === 0 ? "07" : index % 3 === 1 ? "10" : "14",
    piece_variant: "letter",
    sent_date: sentDate,
    recipient_hash: `demo-riverside-recipient-${index}`,
    household_key: `demo-riverside-household-${index % 36}`,
    send_ref: `demo:riverside:${sentDate}:${index}`,
    source: "demo_seed",
  }));

  assertNoSupabaseError(
    await supabase
      .from("mail_send_history")
      .delete()
      .eq("company_id", company.id)
      .eq("source", "demo_seed"),
    "Delete prior Riverside direct-mail demo history"
  );
  assertNoSupabaseError(
    await supabase
      .from("mail_send_priors")
      .delete()
      .eq("company_id", company.id)
      .eq("segment_key", CLEAN_DEMO_SEED.directMail.segmentKey),
    "Delete prior Riverside direct-mail demo result priors"
  );

  assertNoSupabaseError(
    await supabase
      .from("mail_send_history")
      .upsert(historyRows, { onConflict: "send_ref" }),
    "Seed Riverside direct-mail send history"
  );
  assertNoSupabaseError(
    await supabase.from("mail_send_priors").upsert(
      {
        company_id: company.id,
        shop_name: CLEAN_DEMO_SEED.shopName,
        segment_key: CLEAN_DEMO_SEED.directMail.segmentKey,
        piece_code: "07",
        trigger: "survey_followup_warranty",
        ab_variant: "A",
        n_sent: CLEAN_DEMO_SEED.directMail.priorSent,
        n_outcome: CLEAN_DEMO_SEED.directMail.priorOutcomes,
        outcome_rate:
          CLEAN_DEMO_SEED.directMail.priorOutcomes /
          CLEAN_DEMO_SEED.directMail.priorSent,
        method_ref: "seed-superadmin-qa-env:riverside-direct-mail",
      },
      { onConflict: "segment_key,piece_code,ab_variant" }
    ),
    "Seed Riverside direct-mail result priors"
  );
}

async function main() {
  supabase = connectSupabase();
  if (directMailOnly) {
    const { data: shop, error } = await supabase
      .from("shops")
      .select("id")
      .eq("slug", CLEAN_DEMO_SEED.shopSlug)
      .maybeSingle();
    if (error) throw new Error(`Riverside shop lookup failed: ${error.message}`);
    if (!shop?.id) {
      throw new Error(`Riverside shop ${CLEAN_DEMO_SEED.shopSlug} was not found.`);
    }
    await seedRiversideDirectMail(shop.id);
    console.log("Seeded Riverside direct-mail dashboard data.");
    console.log(`Shop: ${shop.id}`);
    return;
  }

  const missingDemoEnv = requiredDemoEnvNames(process.env).filter((key) => !process.env[key]);
  if (missingDemoEnv.length > 0) {
    throw new Error(`Missing required demo seed env vars: ${missingDemoEnv.join(", ")}.`);
  }

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
      website_url: "https://riversidecollision.example",
      primary_market: "San Francisco, CA",
      zip_code: "94107",
    },
    update: {
      website_url: "https://riversidecollision.example",
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
      url: "https://riversidecollision.example",
      telephone: "(555) 010-1209",
      address_locality: "San Francisco",
      address_region: "CA",
      address_postal_code: "94107",
      address_country: "US",
    },
    update: {
      client_id: client.id,
      name: CLEAN_DEMO_SEED.shopName,
      url: "https://riversidecollision.example",
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

  const { error: oldMembershipError } = await supabase
    .from("shop_users")
    .delete()
    .eq("user_id", shopUser.id)
    .neq("shop_id", shop.id);
  if (oldMembershipError) {
    throw new Error(`Old demo shop membership cleanup failed: ${oldMembershipError.message}`);
  }

  const { error: membershipError } = await supabase.from("shop_users").upsert(
    { user_id: shopUser.id, shop_id: shop.id, role: "owner" },
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

  await seedRiversideAnalytics(shop.id);
  await seedRiversideDirectMail(shop.id);

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
