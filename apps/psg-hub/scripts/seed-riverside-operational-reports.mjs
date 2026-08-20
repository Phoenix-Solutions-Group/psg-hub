#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const RIVERSIDE_DEMO_SEED_MARKER = "psg-2975-operational-reports";
export const RIVERSIDE_DEMO_CONFIRMATION = "RIVERSIDE_COLLISION_DEMO_ONLY";

const RIVERSIDE_COMPANY_NAME = "Riverside Collision";
const RIVERSIDE_CUSTOMER = {
  firstName: "Maria",
  lastName: "Alvarez",
  email: "maria.alvarez@example.invalid",
};

export function buildRiversideOperationalReportRows({ companyId, customerId }) {
  return [
    {
      company_id: companyId,
      repair_customer_id: customerId,
      ro_number: "DEMO-RIV-2026-07-01",
      status: "closed",
      repair_amount_cents: 725000,
      pay_type: "insurance",
      dates_json: { date_in: "2026-07-03", date_out: "2026-07-10" },
      created_at: "2026-07-03T14:00:00.000Z",
    },
    {
      company_id: companyId,
      repair_customer_id: customerId,
      ro_number: "DEMO-RIV-2026-07-02",
      status: "closed",
      repair_amount_cents: 480000,
      pay_type: "customer",
      dates_json: { date_in: "2026-07-14", date_out: "2026-07-18" },
      created_at: "2026-07-14T14:00:00.000Z",
    },
    {
      company_id: companyId,
      repair_customer_id: customerId,
      ro_number: "DEMO-RIV-2026-07-03",
      status: "open",
      repair_amount_cents: 645000,
      pay_type: "insurance",
      dates_json: { date_in: "2026-07-27" },
      created_at: "2026-07-27T14:00:00.000Z",
    },
    {
      company_id: companyId,
      repair_customer_id: customerId,
      ro_number: "DEMO-RIV-2026-08-01",
      status: "closed",
      repair_amount_cents: 910000,
      pay_type: "insurance",
      dates_json: { date_in: "2026-08-04", date_out: "2026-08-12" },
      created_at: "2026-08-04T14:00:00.000Z",
    },
    {
      company_id: companyId,
      repair_customer_id: customerId,
      ro_number: "DEMO-RIV-2026-08-02",
      status: "open",
      repair_amount_cents: 565000,
      pay_type: "warranty",
      dates_json: { date_in: "2026-08-21" },
      created_at: "2026-08-21T14:00:00.000Z",
    },
  ].map((row) => ({
    ...row,
    payload_jsonb: { demoSeed: RIVERSIDE_DEMO_SEED_MARKER },
    updated_at: row.created_at,
  }));
}

function requireSingleRow(result, label) {
  if (result.error)
    throw new Error(`${label} lookup failed: ${result.error.message}`);
  if (!result.data)
    throw new Error(`${label} was not found; no rows were written`);
  return result.data;
}

export async function seedRiversideOperationalReports(client) {
  const company = requireSingleRow(
    await client
      .from("companies")
      .select("id,name")
      .eq("name", RIVERSIDE_COMPANY_NAME)
      .single(),
    "Riverside demo company",
  );

  const customer = requireSingleRow(
    await client
      .from("repair_customers")
      .select("id,company_id,first_name,last_name,email")
      .eq("company_id", company.id)
      .eq("first_name", RIVERSIDE_CUSTOMER.firstName)
      .eq("last_name", RIVERSIDE_CUSTOMER.lastName)
      .eq("email", RIVERSIDE_CUSTOMER.email)
      .single(),
    "Riverside demo repair customer",
  );

  if (
    customer.company_id !== company.id ||
    customer.email !== RIVERSIDE_CUSTOMER.email
  ) {
    throw new Error(
      "Riverside demo links did not pass validation; no rows were written",
    );
  }

  const rows = buildRiversideOperationalReportRows({
    companyId: company.id,
    customerId: customer.id,
  });
  const { error } = await client
    .from("repair_orders")
    .upsert(rows, { onConflict: "company_id,ro_number" });
  if (error)
    throw new Error(
      `Riverside operational report seed failed: ${error.message}`,
    );

  return {
    companyId: company.id,
    customerId: customer.id,
    rowCount: rows.length,
  };
}

/* v8 ignore start -- exercised only by the explicit, credentialed operator command */
function connectSupabase(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  if (env.RIVERSIDE_DEMO_SEED_CONFIRM !== RIVERSIDE_DEMO_CONFIRMATION) {
    throw new Error(
      `Set RIVERSIDE_DEMO_SEED_CONFIRM=${RIVERSIDE_DEMO_CONFIRMATION} to confirm this demo-only write`,
    );
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main() {
  const result = await seedRiversideOperationalReports(connectSupabase());
  console.log(
    `Seeded ${result.rowCount} Riverside operational-report demo rows.`,
  );
}

const isCliInvocation = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliInvocation) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
