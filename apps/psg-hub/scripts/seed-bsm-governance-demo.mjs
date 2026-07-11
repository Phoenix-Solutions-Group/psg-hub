#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const root = process.cwd();
const DRY_RUN_UUID = "00000000-0000-4000-8000-000000000000";

loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, "apps/psg-hub/.env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RIVERSIDE = {
  clientName: "Riverside Collision",
  shopSlug: "riverside-collision",
  companyName: "Riverside Collision",
  productName: "Demo Thank-You Letter Program",
  customer: {
    firstName: "Maria",
    lastName: "Alvarez",
    email: "maria.alvarez@example.invalid",
    phone: "555-014-4821",
    address: {
      line1: "185 Berry St Ste 6100",
      city: "San Francisco",
      state: "CA",
      postal_code: "94107",
    },
  },
  companyAddress: {
    line1: "2400 Harbor Drive",
    city: "San Francisco",
    state: "CA",
    postal_code: "94107",
  },
};

const PROOF_URL =
  "/api/ops/production/templates/thank_you/proof?format=html&seed=riverside";

if (!url || !serviceKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run from an environment configured for the demo host."
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function logStep(message) {
  console.log(`${APPLY ? "apply" : "dry-run"}: ${message}`);
}

async function findFirst(table, select, filters) {
  let query = supabase.from(table).select(select).limit(1);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { data, error } = await query;
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return data?.[0] ?? null;
}

async function upsertByLookup({ table, select = "id", filters, insert, update, label }) {
  const existing = await findFirst(table, select, filters);
  if (!APPLY) {
    logStep(`${existing ? "would update" : "would insert"} ${label}`);
    return { id: existing?.id ?? DRY_RUN_UUID };
  }
  if (existing) {
    const { data, error } = await supabase
      .from(table)
      .update(update ?? insert)
      .eq("id", existing.id)
      .select(select)
      .single();
    if (error) throw new Error(`${label} update failed: ${error.message}`);
    logStep(`updated ${label}`);
    return data;
  }
  const { data, error } = await supabase.from(table).insert(insert).select(select).single();
  if (error) throw new Error(`${label} insert failed: ${error.message}`);
  logStep(`inserted ${label}`);
  return data;
}

async function seedCoreRows() {
  const client = await upsertByLookup({
    table: "clients",
    filters: { name: RIVERSIDE.clientName },
    insert: {
      name: RIVERSIDE.clientName,
      website_url: "https://riversidecollision.example",
      primary_market: "San Francisco, CA",
      zip_code: "94107",
    },
    update: {
      website_url: "https://riversidecollision.example",
      primary_market: "San Francisco, CA",
      zip_code: "94107",
    },
    label: "Riverside client",
  });

  const shop = await upsertByLookup({
    table: "shops",
    filters: { name: RIVERSIDE.clientName },
    insert: {
      client_id: client.id,
      name: RIVERSIDE.clientName,
      slug: RIVERSIDE.shopSlug,
      url: "https://riversidecollision.example",
      telephone: "(555) 014-7821",
      address_street: RIVERSIDE.companyAddress.line1,
      address_locality: RIVERSIDE.companyAddress.city,
      address_region: RIVERSIDE.companyAddress.state,
      address_postal_code: RIVERSIDE.companyAddress.postal_code,
      address_country: "US",
    },
    update: {
      client_id: client.id,
      slug: RIVERSIDE.shopSlug,
      url: "https://riversidecollision.example",
      telephone: "(555) 014-7821",
      address_street: RIVERSIDE.companyAddress.line1,
      address_locality: RIVERSIDE.companyAddress.city,
      address_region: RIVERSIDE.companyAddress.state,
      address_postal_code: RIVERSIDE.companyAddress.postal_code,
      address_country: "US",
    },
    label: "Riverside shop",
  });

  const company = await upsertByLookup({
    table: "companies",
    filters: { name: RIVERSIDE.companyName },
    insert: {
      shop_id: shop.id,
      name: RIVERSIDE.companyName,
      address: RIVERSIDE.companyAddress,
      phone: "(555) 014-7821",
      contact: "Pat Morgan",
      status: "active",
    },
    update: {
      shop_id: shop.id,
      address: RIVERSIDE.companyAddress,
      phone: "(555) 014-7821",
      contact: "Pat Morgan",
      status: "active",
    },
    label: "Riverside company",
  });

  const product = await upsertByLookup({
    table: "products",
    filters: { name: RIVERSIDE.productName },
    insert: {
      name: RIVERSIDE.productName,
      description: "Demo-only thank-you mail program for governance screenshots.",
      selling_price_cents: 0,
    },
    update: {
      description: "Demo-only thank-you mail program for governance screenshots.",
      selling_price_cents: 0,
    },
    label: "Riverside thank-you product",
  });

  await upsertByLookup({
    table: "company_programs",
    filters: { company_id: company.id, product_id: product.id },
    insert: {
      company_id: company.id,
      product_id: product.id,
      quantity: 1,
      unit_price_cents: 0,
      customizations_jsonb: {
        greeting: "We truly appreciate your business.",
        footer: "Riverside Collision ·",
        addressLine1: RIVERSIDE.companyAddress.line1,
        addressLine2: `${RIVERSIDE.companyAddress.city}, ${RIVERSIDE.companyAddress.state} ${RIVERSIDE.companyAddress.postal_code}`,
        ownerName: "Pat Morgan",
        ownerFirstName: "Pat",
        ownerTitle: "Owner",
        ownerDirectLine: "(555) 014-7822",
        surveyUrl: "www.theacrb.com",
        pieceCode: "PS682",
        jobNumber: "RIV-1042.07",
        hasWarranty: "true",
        warrantyTerm: "for as long as you own the vehicle",
      },
    },
    label: "Riverside company program",
  });

  const customer = await upsertByLookup({
    table: "repair_customers",
    filters: {
      company_id: company.id,
      first_name: RIVERSIDE.customer.firstName,
      last_name: RIVERSIDE.customer.lastName,
    },
    insert: {
      company_id: company.id,
      first_name: RIVERSIDE.customer.firstName,
      last_name: RIVERSIDE.customer.lastName,
      email: RIVERSIDE.customer.email,
      phone: RIVERSIDE.customer.phone,
      address: RIVERSIDE.customer.address,
    },
    update: {
      email: RIVERSIDE.customer.email,
      phone: RIVERSIDE.customer.phone,
      address: RIVERSIDE.customer.address,
    },
    label: "Maria Alvarez repair customer",
  });

  return { shop, company, product, customer };
}

async function seedProduction({ company, product, customer }) {
  const activeBatch = await upsertByLookup({
    table: "production_batches",
    filters: { name: "DEMO Riverside thank-you queued" },
    insert: {
      name: "DEMO Riverside thank-you queued",
      company_id: company.id,
      product_id: product.id,
      status: "queued",
      vendor: "inhouse",
      document_count: 1,
    },
    update: {
      company_id: company.id,
      product_id: product.id,
      status: "queued",
      vendor: "inhouse",
      document_count: 1,
      printed_at: null,
    },
    label: "queued production batch",
  });

  await upsertByLookup({
    table: "production_documents",
    filters: { batch_id: activeBatch.id, repair_customer_id: customer.id },
    insert: productionDocument({
      batchId: activeBatch.id,
      companyId: company.id,
      productId: product.id,
      customerId: customer.id,
      status: "rendered",
      externalId: null,
      expectedDeliveryDate: null,
    }),
    update: productionDocument({
      batchId: activeBatch.id,
      companyId: company.id,
      productId: product.id,
      customerId: customer.id,
      status: "rendered",
      externalId: null,
      expectedDeliveryDate: null,
    }),
    label: "queued Maria production document",
  });

  const historicalBatch = await upsertByLookup({
    table: "production_batches",
    filters: { name: "DEMO Riverside thank-you mailed" },
    insert: {
      name: "DEMO Riverside thank-you mailed",
      company_id: company.id,
      product_id: product.id,
      status: "historical",
      vendor: "inhouse",
      document_count: 1,
      printed_at: "2026-07-10T15:30:00.000Z",
    },
    update: {
      company_id: company.id,
      product_id: product.id,
      status: "historical",
      vendor: "inhouse",
      document_count: 1,
      printed_at: "2026-07-10T15:30:00.000Z",
    },
    label: "historical production batch",
  });

  await upsertByLookup({
    table: "production_documents",
    filters: { batch_id: historicalBatch.id, repair_customer_id: customer.id },
    insert: productionDocument({
      batchId: historicalBatch.id,
      companyId: company.id,
      productId: product.id,
      customerId: customer.id,
      status: "mailed",
      externalId: "DEMO-MAILED-RIVERSIDE-001",
      expectedDeliveryDate: "2026-07-14",
    }),
    update: productionDocument({
      batchId: historicalBatch.id,
      companyId: company.id,
      productId: product.id,
      customerId: customer.id,
      status: "mailed",
      externalId: "DEMO-MAILED-RIVERSIDE-001",
      expectedDeliveryDate: "2026-07-14",
    }),
    label: "historical Maria production document",
  });
}

function productionDocument({
  batchId,
  companyId,
  productId,
  customerId,
  status,
  externalId,
  expectedDeliveryDate,
}) {
  return {
    batch_id: batchId,
    company_id: companyId,
    repair_customer_id: customerId,
    product_id: productId,
    piece_type: "letter",
    color: true,
    size: "8.5x11",
    to_address: {
      name: "Maria Alvarez",
      ...RIVERSIDE.customer.address,
    },
    from_address: {
      name: RIVERSIDE.companyName,
      ...RIVERSIDE.companyAddress,
    },
    status,
    vendor: "inhouse",
    external_id: externalId,
    rendered_url: PROOF_URL,
    proof_url: PROOF_URL,
    expected_delivery_date: expectedDeliveryDate,
  };
}

async function seedCcc({ shop }) {
  const rows = [
    {
      ccc_account_id: "BSMDEMO-CONNECTED",
      facility_id: "RIV-CCC-001",
      connection_status: "connected",
      enabled_at: "2026-07-08T14:00:00.000Z",
      last_event_at: "2026-07-11T18:45:00.000Z",
      last_event_label: "Workfile saved",
      error_reason: null,
      declined_reason: null,
    },
    {
      ccc_account_id: "BSMDEMO-PENDING",
      facility_id: "RIV-CCC-002",
      connection_status: "pending_review",
      enabled_at: "2026-07-11T14:15:00.000Z",
      last_event_at: "2026-07-11T14:15:00.000Z",
      last_event_label: "Shop enabled BSM in CCC ONE",
      error_reason: null,
      declined_reason: null,
    },
    {
      ccc_account_id: "BSMDEMO-ERROR",
      facility_id: "RIV-CCC-003",
      connection_status: "error",
      enabled_at: "2026-07-07T09:00:00.000Z",
      last_event_at: "2026-07-11T17:30:00.000Z",
      last_event_label: "Import failed",
      error_reason: "auth_expired",
      declined_reason: null,
    },
  ];

  for (const row of rows) {
    const existing = await findFirst("ccc_accounts", "id", {
      ccc_account_id: row.ccc_account_id,
    });
    const payload = {
      shop_id: shop.id,
      credential_kind: "unconfirmed",
      status: row.connection_status === "error" ? "error" : "linked",
      ...row,
    };
    if (!APPLY) {
      logStep(`${existing ? "would update" : "would insert"} CCC ${row.ccc_account_id}`);
      continue;
    }
    if (existing) {
      const { error } = await supabase.from("ccc_accounts").update(payload).eq("id", existing.id);
      if (error) throw new Error(`CCC ${row.ccc_account_id} update failed: ${error.message}`);
      logStep(`updated CCC ${row.ccc_account_id}`);
    } else {
      const { error } = await supabase.from("ccc_accounts").insert(payload);
      if (error) throw new Error(`CCC ${row.ccc_account_id} insert failed: ${error.message}`);
      logStep(`inserted CCC ${row.ccc_account_id}`);
    }
  }
}

async function main() {
  console.log(`Target Supabase host: ${new URL(url).host}`);
  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write the demo seed rows.");
  }

  const core = await seedCoreRows();
  await seedProduction(core);
  await seedCcc(core);

  console.log("Done.");
  console.log("Recapture:");
  console.log("- /ops/production");
  console.log("- /ops/admin/integrations/ccc");
  console.log(`- ${PROOF_URL}`);
  console.log("- /ops/production/artwork (deployment status only)");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
