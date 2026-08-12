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
  packageTier: "performance",
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
    adSpend: 136,
    adClicks: 42,
    adImpressions: 1820,
    adConversions: 5,
    sessions: 96,
    users: 71,
    keyEvents: 8,
    searchClicks: 34,
    searchImpressions: 1640,
    calls: 6,
    websiteClicks: 11,
    directionRequests: 4,
    profileImpressions: 710,
  },
  directMail: {
    sends: 45,
    priorSent: 72,
    priorOutcomes: 11,
    segmentKey: "demo-riverside-direct-mail",
  },
  googleAds: {
    accountCustomerId: "1234567890",
    searchCampaignExternalId: "demo-riverside-search",
    pmaxCampaignExternalId: "demo-riverside-pmax",
    auditReportId: "11111111-2778-4778-8778-111111112778",
  },
  gtm: {
    containerPublicId: "GTM-BSMDEMO",
  },
  yext: {
    accountId: "demo-riverside-yext",
    entityId: "riverside-collision-san-francisco",
  },
  customerContent: {
    title: "Riverside Collision July repair tips",
    type: "blog_post",
    status: "pending_review",
    updatedAt: "2026-08-11T16:00:00.000Z",
    body:
      "# Riverside Collision July repair tips\n\n" +
      "PSG prepared this customer-facing article so Riverside can educate drivers before storm season.\n\n" +
      "- Check lamps and sensors after any bumper impact\n" +
      "- Schedule an estimate before small damage spreads\n" +
      "- Keep photos and claim numbers ready for the repair team",
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

async function upsertSingleByConflict({ table, payload, onConflict, label }) {
  const { error } = await supabase.from(table).upsert(payload, { onConflict });
  if (error) throw new Error(`${label} upsert failed: ${error.message}`);
}

async function seedPrimaryLocation(shopId) {
  const { data, error } = await supabase
    .from("locations")
    .upsert(
      {
        shop_id: shopId,
        name: CLEAN_DEMO_SEED.shopName,
        slug: "primary",
        is_primary: true,
      },
      { onConflict: "shop_id,slug" }
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`Riverside location seed failed: ${error?.message}`);
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
  const syncedAt = `${dates.at(-1)}T12:00:00Z`;
  const rows = dates.flatMap((date, index) => {
    const remainingDays = dates.length - 1 - index;
    const adSpend = latest.adSpend - remainingDays * 2;
    const adConversions = Math.max(1, latest.adConversions - Math.floor(remainingDays / 8));
    const searchImpressions = latest.searchImpressions - remainingDays * 18;
    return [
      {
        shop_id: shopId,
        source: "semrush",
        date,
        period: "daily",
        synced_at: syncedAt,
        metrics: {
          organic_traffic: latest.organicTraffic - remainingDays,
          organic_keywords: latest.organicKeywords - remainingDays,
          organic_traffic_cost: 580 + index * 11,
          backlinks: latest.backlinks - remainingDays,
          authority_score: latest.authorityScore,
        },
      },
      {
        shop_id: shopId,
        source: "google_ads",
        date,
        period: "daily",
        synced_at: syncedAt,
        metrics: {
          spend: adSpend,
          clicks: latest.adClicks - Math.floor(remainingDays / 2),
          impressions: latest.adImpressions - remainingDays * 24,
          conversions: adConversions,
          cpl: adSpend / adConversions,
          cost_micros: adSpend * 1_000_000,
          conversion_tracking_verified: true,
        },
      },
      {
        shop_id: shopId,
        source: "ga4",
        date,
        period: "daily",
        synced_at: syncedAt,
        metrics: {
          sessions: latest.sessions - remainingDays,
          total_users: latest.users - remainingDays,
          active_users: latest.users - Math.floor(remainingDays / 2),
          new_users: 18 + (index % 7),
          engaged_sessions: latest.sessions - remainingDays - 14,
          key_events: latest.keyEvents - Math.floor(remainingDays / 8),
          engagement_rate: 0.71,
        },
      },
      {
        shop_id: shopId,
        source: "gsc",
        date,
        period: "daily",
        synced_at: syncedAt,
        metrics: {
          clicks: latest.searchClicks - Math.floor(remainingDays / 3),
          impressions: searchImpressions,
          ctr: (latest.searchClicks - Math.floor(remainingDays / 3)) / searchImpressions,
          position: 7.8,
        },
      },
      {
        shop_id: shopId,
        source: "gbp",
        date,
        period: "daily",
        synced_at: syncedAt,
        metrics: {
          impressions_desktop_maps: 88 + index,
          impressions_desktop_search: 126 + index * 2,
          impressions_mobile_maps: 164 + index * 2,
          impressions_mobile_search: 226 + index * 3,
          impressions_total: latest.profileImpressions - remainingDays * 6,
          website_clicks: latest.websiteClicks - Math.floor(remainingDays / 8),
          call_clicks: latest.calls - Math.floor(remainingDays / 10),
          direction_requests: latest.directionRequests - Math.floor(remainingDays / 12),
          conversations: 1 + (index % 2),
        },
      },
    ];
  });

  const { error: deleteDemoMetricsError } = await supabase
    .from("analytics_snapshots")
    .delete()
    .eq("shop_id", shopId)
    .in("source", ["semrush", "google_ads", "ga4", "gsc", "gbp", "gbp_presence"]);
  if (deleteDemoMetricsError) {
    throw new Error(`Riverside analytics demo cleanup failed: ${deleteDemoMetricsError.message}`);
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

  return company;
}

async function seedBillingAndInvoices(shopId) {
  const now = new Date();
  const currentPeriodEnd = new Date(now);
  currentPeriodEnd.setUTCMonth(currentPeriodEnd.getUTCMonth() + 1);

  assertNoSupabaseError(
    await supabase.from("subscriptions").upsert(
      {
        shop_id: shopId,
        stripe_customer_id: `cus_demo_riverside_${shopId.slice(0, 8)}`,
        stripe_subscription_id: `sub_demo_riverside_${shopId.slice(0, 8)}`,
        tier: CLEAN_DEMO_SEED.packageTier,
        status: "active",
        current_period_end: currentPeriodEnd.toISOString(),
      },
      { onConflict: "shop_id" }
    ),
    "Seed Riverside performance subscription"
  );

  const invoiceRows = [
    {
      stripe_invoice_id: `in_demo_riverside_open_${shopId.slice(0, 8)}`,
      shop_id: shopId,
      stripe_customer_id: `cus_demo_riverside_${shopId.slice(0, 8)}`,
      stripe_subscription_id: `sub_demo_riverside_${shopId.slice(0, 8)}`,
      number: "RIV-2026-0811",
      status: "open",
      amount_due: 99900,
      amount_paid: 0,
      currency: "usd",
      hosted_invoice_url: "https://billing.stripe.com/demo/riverside-open",
      invoice_pdf: "https://billing.stripe.com/demo/riverside-open.pdf",
      period_start: "2026-08-01T00:00:00.000Z",
      period_end: "2026-08-31T23:59:59.000Z",
      created: "2026-08-01T12:00:00.000Z",
      raw: { demoSeed: "psg-2778", surface: "invoice-open" },
    },
    {
      stripe_invoice_id: `in_demo_riverside_paid_${shopId.slice(0, 8)}`,
      shop_id: shopId,
      stripe_customer_id: `cus_demo_riverside_${shopId.slice(0, 8)}`,
      stripe_subscription_id: `sub_demo_riverside_${shopId.slice(0, 8)}`,
      number: "RIV-2026-0711",
      status: "paid",
      amount_due: 99900,
      amount_paid: 99900,
      currency: "usd",
      hosted_invoice_url: "https://billing.stripe.com/demo/riverside-paid",
      invoice_pdf: "https://billing.stripe.com/demo/riverside-paid.pdf",
      period_start: "2026-07-01T00:00:00.000Z",
      period_end: "2026-07-31T23:59:59.000Z",
      created: "2026-07-01T12:00:00.000Z",
      raw: { demoSeed: "psg-2778", surface: "invoice-paid" },
    },
  ];

  for (const row of invoiceRows) {
    await upsertSingleByConflict({
      table: "invoices",
      payload: row,
      onConflict: "stripe_invoice_id",
      label: `Riverside invoice ${row.number}`,
    });
  }
}

async function seedGoogleAdsSurface({ shopId, operatorId, shopUserId }) {
  const account = await upsertByLookup({
    table: "google_ads_accounts",
    filters: { shop_id: shopId, customer_id: CLEAN_DEMO_SEED.googleAds.accountCustomerId },
    insert: {
      shop_id: shopId,
      customer_id: CLEAN_DEMO_SEED.googleAds.accountCustomerId,
      login_customer_id: "9876543210",
      encrypted_refresh_token: "\\x64656d6f",
      key_version: 1,
      scope: "https://www.googleapis.com/auth/adwords",
      status: "linked",
      linked_by: operatorId,
      linked_at: "2026-08-01T15:00:00.000Z",
    },
    update: {
      login_customer_id: "9876543210",
      encrypted_refresh_token: "\\x64656d6f",
      key_version: 1,
      scope: "https://www.googleapis.com/auth/adwords",
      status: "linked",
      linked_by: operatorId,
      linked_at: "2026-08-01T15:00:00.000Z",
      revoked_at: null,
      last_error: null,
    },
    label: "Riverside Google Ads account",
  });

  const campaigns = [
    {
      externalId: CLEAN_DEMO_SEED.googleAds.searchCampaignExternalId,
      resourceName: "customers/1234567890/campaigns/1001",
      name: "Collision Repair Near Me - Search",
      campaignType: "search",
      budgetMicros: 125000000,
      metrics: {
        clicks: 42,
        impressions: 1820,
        conversions: 5,
        cost_micros: 136000000,
      },
    },
    {
      externalId: CLEAN_DEMO_SEED.googleAds.pmaxCampaignExternalId,
      resourceName: "customers/1234567890/campaigns/1002",
      name: "Riverside Brand Protection - Performance Max",
      campaignType: "performance_max",
      budgetMicros: 65000000,
      metrics: {
        clicks: 28,
        impressions: 2450,
        conversions: 3,
        cost_micros: 84000000,
      },
    },
  ];

  for (const campaign of campaigns) {
    await upsertByLookup({
      table: "google_ads_campaigns",
      filters: { shop_id: shopId, external_id: campaign.externalId },
      insert: {
        shop_id: shopId,
        account_id: account.id,
        external_resource_name: campaign.resourceName,
        external_id: campaign.externalId,
        name: campaign.name,
        campaign_type: campaign.campaignType,
        status: "enabled",
        daily_budget_micros: campaign.budgetMicros,
        metrics: campaign.metrics,
        metrics_synced_at: "2026-08-11T12:00:00.000Z",
      },
      update: {
        account_id: account.id,
        external_resource_name: campaign.resourceName,
        name: campaign.name,
        campaign_type: campaign.campaignType,
        status: "enabled",
        daily_budget_micros: campaign.budgetMicros,
        metrics: campaign.metrics,
        metrics_synced_at: "2026-08-11T12:00:00.000Z",
      },
      label: `Riverside Google Ads campaign ${campaign.name}`,
    });
  }

  const searchCampaign = await upsertByLookup({
    table: "google_ads_campaigns",
    filters: { shop_id: shopId, external_id: CLEAN_DEMO_SEED.googleAds.searchCampaignExternalId },
    label: "Riverside search campaign lookup",
    insert: {
      shop_id: shopId,
      account_id: account.id,
      external_resource_name: "customers/1234567890/campaigns/1001",
      external_id: CLEAN_DEMO_SEED.googleAds.searchCampaignExternalId,
      name: "Collision Repair Near Me - Search",
      campaign_type: "search",
      status: "enabled",
      daily_budget_micros: 125000000,
      metrics: { clicks: 42, impressions: 1820, conversions: 5, cost_micros: 136000000 },
      metrics_synced_at: "2026-08-11T12:00:00.000Z",
    },
  });

  await upsertByLookup({
    table: "google_ads_customer_requests",
    filters: { shop_id: shopId, title: "Increase estimate-booking leads this month" },
    insert: {
      shop_id: shopId,
      requested_by_profile_id: shopUserId,
      request_type: "campaign_adjustment",
      campaign_id: searchCampaign.id,
      campaign_name: "Collision Repair Near Me - Search",
      title: "Increase estimate-booking leads this month",
      details: "Please shift more budget toward searches from drivers who need estimates.",
      desired_launch_date: "2026-08-18",
      budget_notes: "Keep the monthly total near the current plan.",
      status: "psg_reviewing",
      psg_response: "PSG is reviewing the search terms and budget split.",
      updated_by_profile_id: operatorId,
    },
    update: {
      campaign_id: searchCampaign.id,
      campaign_name: "Collision Repair Near Me - Search",
      details: "Please shift more budget toward searches from drivers who need estimates.",
      desired_launch_date: "2026-08-18",
      budget_notes: "Keep the monthly total near the current plan.",
      status: "psg_reviewing",
      psg_response: "PSG is reviewing the search terms and budget split.",
      updated_by_profile_id: operatorId,
    },
    label: "Riverside Google Ads customer request",
  });

  await upsertByLookup({
    table: "google_ads_optimization_audit_reports",
    filters: {
      storage_path: `${shopId}/${CLEAN_DEMO_SEED.googleAds.auditReportId}.pdf`,
    },
    insert: {
      shop_id: shopId,
      title: "Riverside Google Ads Optimization Review",
      period_month: "2026-08",
      storage_path: `${shopId}/${CLEAN_DEMO_SEED.googleAds.auditReportId}.pdf`,
      original_filename: "riverside-google-ads-optimization-review.pdf",
      content_type: "application/pdf",
      byte_size: 245760,
      published_by_profile_id: operatorId,
      metadata_jsonb: { demoSeed: "psg-2778", summary: "Budget and search-term review" },
    },
    update: {
      title: "Riverside Google Ads Optimization Review",
      period_month: "2026-08",
      original_filename: "riverside-google-ads-optimization-review.pdf",
      content_type: "application/pdf",
      byte_size: 245760,
      published_by_profile_id: operatorId,
      metadata_jsonb: { demoSeed: "psg-2778", summary: "Budget and search-term review" },
    },
    label: "Riverside Google Ads audit report",
  });
}

async function seedReviewAndApprovalSurfaces({ shopId, locationId, operatorId, shopUserId }) {
  const review = await upsertByLookup({
    table: "review_items",
    filters: {
      shop_id: shopId,
      author: "Danielle Brooks",
      reviewed_at: "2026-08-07T16:30:00.000Z",
    },
    insert: {
      shop_id: shopId,
      location_id: locationId,
      platform: "google",
      rating: 5,
      text: "Riverside kept me updated every step of the way and the car looks brand new.",
      author: "Danielle Brooks",
      reviewed_at: "2026-08-07T16:30:00.000Z",
    },
    update: {
      location_id: locationId,
      platform: "google",
      rating: 5,
      text: "Riverside kept me updated every step of the way and the car looks brand new.",
    },
    label: "Riverside customer review",
  });

  await upsertSingleByConflict({
    table: "review_sentiment",
    payload: {
      review_item_id: review.id,
      shop_id: shopId,
      polarity: "positive",
      confidence: 0.94,
      themes: ["communication", "repair_quality"],
      actionable_complaint: false,
      raw: { demoSeed: "psg-2778" },
      model_id: "demo-classifier",
      prompt_version: "demo-v1",
      classified_updated_at: "2026-08-07T16:30:00.000Z",
    },
    onConflict: "review_item_id",
    label: "Riverside review sentiment",
  });

  const response = await upsertByLookup({
    table: "review_responses",
    filters: { review_item_id: review.id },
    insert: {
      review_item_id: review.id,
      shop_id: shopId,
      draft_text:
        "Danielle, thank you for trusting Riverside Collision. We are glad the updates helped and that your vehicle looks brand new.",
      status: "draft",
      tone_preset: "warm",
      model_id: "demo-response-writer",
      prompt_version: "demo-v1",
      created_by: operatorId,
      version: 1,
      safety_flags: [],
      safety_overridden: false,
    },
    update: {
      shop_id: shopId,
      draft_text:
        "Danielle, thank you for trusting Riverside Collision. We are glad the updates helped and that your vehicle looks brand new.",
      status: "draft",
      tone_preset: "warm",
      model_id: "demo-response-writer",
      prompt_version: "demo-v1",
      created_by: operatorId,
      version: 1,
      safety_flags: [],
      safety_overridden: false,
    },
    label: "Riverside review response draft",
  });

  await upsertByLookup({
    table: "review_response_comments",
    filters: {
      review_item_id: review.id,
      body: "Demo note: customer-visible response is ready for owner approval.",
    },
    insert: {
      review_item_id: review.id,
      review_response_id: response.id,
      shop_id: shopId,
      body: "Demo note: customer-visible response is ready for owner approval.",
      created_by: operatorId,
    },
    update: {
      review_response_id: response.id,
      shop_id: shopId,
      created_by: operatorId,
    },
    label: "Riverside review response comment",
  });

  await upsertByLookup({
    table: "approval_queue",
    filters: { shop_id: shopId, title: "Approve August repair follow-up post" },
    insert: {
      shop_id: shopId,
      action_type: "content",
      title: "Approve August repair follow-up post",
      summary: "A customer follow-up post is ready to approve before PSG publishes it.",
      payload_jsonb: {
        demoSeed: "psg-2778",
        channel: "Google Business Profile",
        preview: "A short update reminding customers to schedule post-repair inspections.",
      },
      status: "pending",
      proposed_by: "BSM content agent",
    },
    update: {
      summary: "A customer follow-up post is ready to approve before PSG publishes it.",
      payload_jsonb: {
        demoSeed: "psg-2778",
        channel: "Google Business Profile",
        preview: "A short update reminding customers to schedule post-repair inspections.",
      },
      status: "pending",
      proposed_by: "BSM content agent",
      decided_by_profile_id: null,
      decided_by_name: null,
      decided_at: null,
      decision_notes: null,
      published_at: null,
      publish_error: null,
    },
    label: "Riverside pending approval",
  });

  const contentReview = await upsertByLookup({
    table: "bsm_content_review_items",
    filters: { shop_id: shopId, title: "Riverside August reputation post" },
    insert: {
      shop_id: shopId,
      customer_profile_id: shopUserId,
      title: "Riverside August reputation post",
      content_type: "generated_page",
      status: "in_review",
      admin_context_note: "Demo proof showing the customer-facing approval workflow.",
      due_at: "2026-08-18T17:00:00.000Z",
      sent_at: "2026-08-11T15:00:00.000Z",
      created_by_profile_id: operatorId,
      metadata_jsonb: { demoSeed: "psg-2778" },
    },
    update: {
      customer_profile_id: shopUserId,
      content_type: "generated_page",
      status: "in_review",
      admin_context_note: "Demo proof showing the customer-facing approval workflow.",
      due_at: "2026-08-18T17:00:00.000Z",
      sent_at: "2026-08-11T15:00:00.000Z",
      created_by_profile_id: operatorId,
      metadata_jsonb: { demoSeed: "psg-2778" },
    },
    label: "Riverside BSM content review item",
  });

  const version = await upsertByLookup({
    table: "bsm_content_review_versions",
    filters: { review_item_id: contentReview.id, version_number: 1 },
    insert: {
      review_item_id: contentReview.id,
      shop_id: shopId,
      version_number: 1,
      status: "current",
      original_filename: "riverside-august-reputation-post.html",
      content_type: "text/html",
      byte_size: 2048,
      preview_type: "generated_page",
      source_metadata_jsonb: {
        demoSeed: "psg-2778",
        previewUrl: "/review-workspace/demo/riverside-august-reputation-post",
      },
      created_by_profile_id: operatorId,
    },
    update: {
      shop_id: shopId,
      status: "current",
      original_filename: "riverside-august-reputation-post.html",
      content_type: "text/html",
      byte_size: 2048,
      preview_type: "generated_page",
      source_metadata_jsonb: {
        demoSeed: "psg-2778",
        previewUrl: "/review-workspace/demo/riverside-august-reputation-post",
      },
      created_by_profile_id: operatorId,
    },
    label: "Riverside BSM content review version",
  });

  assertNoSupabaseError(
    await supabase
      .from("bsm_content_review_items")
      .update({ current_version_id: version.id })
      .eq("id", contentReview.id),
    "Attach current Riverside content review version"
  );
}

export function demoCustomerContentItemRow({ shopId, locationId }) {
  return {
    shop_id: shopId,
    location_id: locationId,
    type: CLEAN_DEMO_SEED.customerContent.type,
    title: CLEAN_DEMO_SEED.customerContent.title,
    body: CLEAN_DEMO_SEED.customerContent.body,
    status: CLEAN_DEMO_SEED.customerContent.status,
    updated_at: CLEAN_DEMO_SEED.customerContent.updatedAt,
  };
}

async function seedCustomerContentSurface({ shopId, locationId }) {
  const row = demoCustomerContentItemRow({ shopId, locationId });
  await upsertByLookup({
    table: "content_items",
    filters: { shop_id: shopId, title: CLEAN_DEMO_SEED.customerContent.title },
    insert: row,
    update: row,
    label: "Riverside customer content item",
  });
}

async function seedOpsAndIntegrationSurfaces({ shopId, company, operatorId }) {
  await upsertSingleByConflict({
    table: "gtm_container_statuses",
    payload: {
      shop_id: shopId,
      container_public_id: CLEAN_DEMO_SEED.gtm.containerPublicId,
      account_name: "Riverside Collision",
      container_name: "Riverside Web Container",
      workspace_id: "42",
      workspace_name: "PSG production workspace",
      workspace_status: "published",
      published_version_id: "17",
      published_version_name: "Lead tracking v17",
      tags_jsonb: [
        { name: "GA4 config", status: "live" },
        { name: "Estimate request conversion", status: "live" },
      ],
      triggers_jsonb: [
        { name: "Estimate form submit", type: "form_submit" },
        { name: "Call click", type: "click" },
      ],
      raw_jsonb: { demoSeed: "psg-2778" },
      last_checked_at: "2026-08-11T12:00:00.000Z",
    },
    onConflict: "shop_id,container_public_id",
    label: "Riverside GTM status",
  });

  await upsertSingleByConflict({
    table: "yext_accounts",
    payload: {
      shop_id: shopId,
      yext_account_id: CLEAN_DEMO_SEED.yext.accountId,
      yext_entity_id: CLEAN_DEMO_SEED.yext.entityId,
      status: "active",
      last_sync_at: "2026-08-11T12:00:00.000Z",
      last_sync_status: "success",
    },
    onConflict: "shop_id",
    label: "Riverside Yext account",
  });

  await upsertSingleByConflict({
    table: "yext_listings_cache",
    payload: {
      shop_id: shopId,
      yext_entity_id: CLEAN_DEMO_SEED.yext.entityId,
      payload_jsonb: { demoSeed: "psg-2778" },
      summary_jsonb: {
        totalListings: 42,
        syncedListings: 40,
        needsAttention: 2,
        completenessScore: 95,
      },
      cached_at: "2026-08-11T12:00:00.000Z",
      ttl_at: "2026-09-10T12:00:00.000Z",
    },
    onConflict: "shop_id",
    label: "Riverside Yext listings cache",
  });

  await upsertSingleByConflict({
    table: "yext_reviews_cache",
    payload: {
      shop_id: shopId,
      yext_entity_id: CLEAN_DEMO_SEED.yext.entityId,
      payload_jsonb: { demoSeed: "psg-2778" },
      summary_jsonb: {
        averageRating: 4.8,
        reviewCount: 186,
        unansweredReviews: 3,
        newestReviewAt: "2026-08-07T16:30:00.000Z",
      },
      cached_at: "2026-08-11T12:00:00.000Z",
      ttl_at: "2026-09-10T12:00:00.000Z",
    },
    onConflict: "shop_id",
    label: "Riverside Yext reviews cache",
  });

  await upsertByLookup({
    table: "ccc_accounts",
    filters: { shop_id: shopId, ccc_account_id: "BSMDEMO-CONNECTED" },
    insert: {
      shop_id: shopId,
      ccc_account_id: "BSMDEMO-CONNECTED",
      facility_id: "RIV-CCC-001",
      credential_kind: "unconfirmed",
      status: "linked",
      linked_by: operatorId,
      linked_at: "2026-08-01T15:00:00.000Z",
      connection_status: "connected",
      enabled_at: "2026-08-01T15:00:00.000Z",
      last_event_at: "2026-08-11T12:00:00.000Z",
      last_event_label: "Estimate imported",
    },
    update: {
      facility_id: "RIV-CCC-001",
      credential_kind: "unconfirmed",
      status: "linked",
      linked_by: operatorId,
      linked_at: "2026-08-01T15:00:00.000Z",
      revoked_at: null,
      last_error: null,
      connection_status: "connected",
      enabled_at: "2026-08-01T15:00:00.000Z",
      last_event_at: "2026-08-11T12:00:00.000Z",
      last_event_label: "Estimate imported",
      error_reason: null,
      declined_reason: null,
    },
    label: "Riverside CCC account",
  });

  const product = await upsertByLookup({
    table: "products",
    filters: { name: "Demo Thank-You Letter Program" },
    insert: {
      name: "Demo Thank-You Letter Program",
      description: "Demo-only customer thank-you mail program.",
      selling_price_cents: 0,
    },
    update: {
      description: "Demo-only customer thank-you mail program.",
      selling_price_cents: 0,
    },
    label: "Riverside demo mail product",
  });

  const customer = await upsertByLookup({
    table: "repair_customers",
    filters: {
      company_id: company.id,
      first_name: "Maria",
      last_name: "Alvarez",
    },
    insert: {
      company_id: company.id,
      first_name: "Maria",
      last_name: "Alvarez",
      email: "maria.alvarez@example.invalid",
      phone: "555-014-4821",
      address: {
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
    },
    update: {
      email: "maria.alvarez@example.invalid",
      phone: "555-014-4821",
      address: {
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
    },
    label: "Riverside demo repair customer",
  });

  const batch = await upsertByLookup({
    table: "production_batches",
    filters: { name: "DEMO Riverside thank-you queued" },
    insert: {
      name: "DEMO Riverside thank-you queued",
      company_id: company.id,
      product_id: product.id,
      status: "queued",
      vendor: "inhouse",
      document_count: 1,
      created_by_profile_id: operatorId,
    },
    update: {
      company_id: company.id,
      product_id: product.id,
      status: "queued",
      vendor: "inhouse",
      document_count: 1,
      created_by_profile_id: operatorId,
      printed_at: null,
    },
    label: "Riverside queued production batch",
  });

  await upsertByLookup({
    table: "production_documents",
    filters: { batch_id: batch.id, repair_customer_id: customer.id },
    insert: {
      batch_id: batch.id,
      company_id: company.id,
      repair_customer_id: customer.id,
      product_id: product.id,
      piece_type: "letter",
      to_address: {
        name: "Maria Alvarez",
        line1: "185 Berry St Ste 6100",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
      from_address: {
        name: CLEAN_DEMO_SEED.shopName,
        line1: "2400 Harbor Drive",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
      },
      status: "rendered",
      vendor: "inhouse",
      rendered_url: "/api/ops/production/templates/thank_you/proof?format=html&seed=riverside",
      proof_url: "/api/ops/production/templates/thank_you/proof?format=html&seed=riverside",
    },
    update: {
      company_id: company.id,
      repair_customer_id: customer.id,
      product_id: product.id,
      piece_type: "letter",
      status: "rendered",
      vendor: "inhouse",
      rendered_url: "/api/ops/production/templates/thank_you/proof?format=html&seed=riverside",
      proof_url: "/api/ops/production/templates/thank_you/proof?format=html&seed=riverside",
    },
    label: "Riverside production document",
  });
}

async function seedSurveySurface(company) {
  const responseId = "demo-riverside-survey-2026-08";
  const existing = await supabase
    .from("survey_responses")
    .select("id")
    .eq("response_id", responseId)
    .maybeSingle();
  if (existing.error) throw new Error(`Riverside survey lookup failed: ${existing.error.message}`);

  const payload = {
    shop_name: CLEAN_DEMO_SEED.shopName,
    survey_date: "2026-08-05",
    scale_emi_pct: 0.94,
    q05_01: 10,
    q05_02: 9,
    q05_03: 10,
    q05_04: 9,
    text_customer_comments: "Clear updates, friendly staff, and excellent repair quality.",
    source: "demo_seed",
    import_batch_id: "psg-2778-full-demo",
    raw_payload: { demoSeed: "psg-2778" },
    response_id: responseId,
    match_key: "demo-riverside-ro-1042",
    shop_id: company.shop_id,
    ro_number: "RIV-1042",
    would_recommend: true,
  };

  if (existing.data?.id) {
    assertNoSupabaseError(
      await supabase.from("survey_responses").update(payload).eq("id", existing.data.id),
      "Update Riverside demo survey response"
    );
  } else {
    assertNoSupabaseError(
      await supabase.from("survey_responses").insert(payload),
      "Insert Riverside demo survey response"
    );
  }

  await upsertSingleByConflict({
    table: "survey_dispatches",
    payload: {
      company_id: company.id,
      shop_name: CLEAN_DEMO_SEED.shopName,
      ro_number: "RIV-1042",
      sent_date: "2026-08-03",
      channel: "email",
      response_id: responseId,
      dispatch_ref: "demo:riverside:RIV-1042:2026-08-03",
    },
    onConflict: "dispatch_ref",
    label: "Riverside survey dispatch",
  });
}

async function seedFullDemoAccountSurfaces({ shop, operator, shopUser, company }) {
  const location = await seedPrimaryLocation(shop.id);
  await seedBillingAndInvoices(shop.id);
  await seedCustomerContentSurface({
    shopId: shop.id,
    locationId: location.id,
  });
  await seedGoogleAdsSurface({
    shopId: shop.id,
    operatorId: operator.id,
    shopUserId: shopUser.id,
  });
  await seedReviewAndApprovalSurfaces({
    shopId: shop.id,
    locationId: location.id,
    operatorId: operator.id,
    shopUserId: shopUser.id,
  });
  await seedOpsAndIntegrationSurfaces({
    shopId: shop.id,
    company,
    operatorId: operator.id,
  });
  await seedSurveySurface(company);
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

  await seedRiversideAnalytics(shop.id);
  const company = await seedRiversideDirectMail(shop.id);
  await seedFullDemoAccountSurfaces({ shop, operator, shopUser, company });

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
  console.log("Full demo surfaces: analytics, ads, billing, reviews, approvals, direct mail, production, CCC, GTM, Yext, and surveys.");
}

if (isCliInvocation) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
