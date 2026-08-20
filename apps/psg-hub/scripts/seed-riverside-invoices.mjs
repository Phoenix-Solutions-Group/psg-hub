#!/usr/bin/env node
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export const RIVERSIDE_INVOICE_NUMBERS = [
  "RIV-DEMO-1001",
  "RIV-DEMO-1002",
  "RIV-DEMO-1003",
];
export const RIVERSIDE_PRODUCTION_CONFIRMATION = "--confirm-production";

const RIVERSIDE_SHOP_NAME = "Riverside Collision";
const RIVERSIDE_SHOP_SLUG = "riverside-collision";

export function buildRiversideInvoiceRows(shopId) {
  const idSuffix = shopId.replaceAll("-", "").slice(0, 8);
  const shared = {
    shop_id: shopId,
    stripe_customer_id: `cus_demo_riverside_${idSuffix}`,
    stripe_subscription_id: `sub_demo_riverside_${idSuffix}`,
    currency: "usd",
    hosted_invoice_url: null,
    invoice_pdf: null,
  };

  return [
    {
      ...shared,
      stripe_invoice_id: `in_demo_riverside_void_${idSuffix}`,
      number: "RIV-DEMO-1001",
      status: "void",
      amount_due: 75_000,
      amount_paid: 0,
      raw: {
        demoSeed: "psg-3036",
        testOnly: true,
        canonical_document_ref: "demo://riverside/RIV-DEMO-1001",
        due_date: "2026-06-30T23:59:59.000Z",
        subtotal: 75_000,
        tax: 0,
        total: 75_000,
        amount_remaining: 0,
        lines: [
          {
            id: "cancelled-consulting",
            description: "Fictional consulting engagement (voided)",
            quantity: 3,
            unit_amount: 25_000,
            amount: 75_000,
          },
        ],
      },
      period_start: "2026-06-01T00:00:00.000Z",
      period_end: "2026-06-30T23:59:59.000Z",
      created: "2026-06-15T14:00:00.000Z",
    },
    {
      ...shared,
      stripe_invoice_id: `in_demo_riverside_paid_${idSuffix}`,
      number: "RIV-DEMO-1002",
      status: "paid",
      amount_due: 250_000,
      amount_paid: 250_000,
      raw: {
        demoSeed: "psg-3036",
        testOnly: true,
        canonical_document_ref: "demo://riverside/RIV-DEMO-1002",
        due_date: "2026-07-30T23:59:59.000Z",
        subtotal: 250_000,
        tax: 0,
        total: 250_000,
        amount_remaining: 0,
        lines: [
          {
            id: "quarterly-marketing",
            description: "Fictional quarterly marketing program",
            quantity: 1,
            unit_amount: 250_000,
            amount: 250_000,
          },
        ],
      },
      period_start: "2026-07-01T00:00:00.000Z",
      period_end: "2026-07-31T23:59:59.000Z",
      created: "2026-07-15T14:00:00.000Z",
    },
    {
      ...shared,
      stripe_invoice_id: `in_demo_riverside_open_${idSuffix}`,
      number: "RIV-DEMO-1003",
      status: "open",
      amount_due: 125_000,
      amount_paid: 0,
      raw: {
        demoSeed: "psg-3036",
        testOnly: true,
        canonical_document_ref: "demo://riverside/RIV-DEMO-1003",
        due_date: "2026-08-30T23:59:59.000Z",
        subtotal: 115_000,
        tax: 10_000,
        total: 125_000,
        amount_remaining: 125_000,
        lines: [
          {
            id: "monthly-marketing",
            description: "Body Shop Marketer monthly service",
            quantity: 1,
            unit_amount: 100_000,
            amount: 100_000,
          },
          {
            id: "campaign-support",
            description: "Fictional campaign support package",
            quantity: 1,
            unit_amount: 15_000,
            amount: 15_000,
          },
        ],
      },
      period_start: "2026-08-01T00:00:00.000Z",
      period_end: "2026-08-31T23:59:59.000Z",
      created: "2026-08-15T14:00:00.000Z",
    },
  ];
}

export function parseRiversideInvoiceSeedArgs(args) {
  const shopIdIndex = args.indexOf("--shop-id");
  const shopId = shopIdIndex >= 0 ? args[shopIdIndex + 1] : undefined;
  if (!args.includes(RIVERSIDE_PRODUCTION_CONFIRMATION)) {
    throw new Error(`Missing required ${RIVERSIDE_PRODUCTION_CONFIRMATION} flag; no rows were written`);
  }
  if (!shopId || shopId.startsWith("--")) {
    throw new Error("Missing required --shop-id <Riverside shop UUID>; no rows were written");
  }
  return { shopId, dryRun: args.includes("--dry-run") };
}

export function connectRiversideInvoiceSeed(env = process.env, createClientImpl = createClient) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; no rows were written");
  }
  return createClientImpl(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function seedRiversideInvoices(client, { shopId, dryRun = false }) {
  const shopResult = await client
    .from("shops")
    .select("id,name,slug")
    .eq("id", shopId)
    .single();

  if (shopResult.error) {
    throw new Error(`Riverside shop lookup failed: ${shopResult.error.message}; no rows were written`);
  }
  if (!shopResult.data) {
    throw new Error("Riverside shop was not found; no rows were written");
  }
  if (
    shopResult.data.id !== shopId ||
    (shopResult.data.name !== RIVERSIDE_SHOP_NAME && shopResult.data.slug !== RIVERSIDE_SHOP_SLUG)
  ) {
    throw new Error("Target shop is not Riverside Collision; no rows were written");
  }

  const rows = buildRiversideInvoiceRows(shopId);
  if (!dryRun) {
    const { error } = await client
      .from("invoices")
      .upsert(rows, { onConflict: "stripe_invoice_id" });
    if (error) throw new Error(`Riverside invoice seed failed: ${error.message}`);
  }

  return { shopId, rowCount: rows.length, dryRun, invoiceNumbers: rows.map((row) => row.number) };
}

/* v8 ignore start -- credentialed CLI wrapper; exported logic is covered above */
async function main() {
  const options = parseRiversideInvoiceSeedArgs(process.argv.slice(2));
  const result = await seedRiversideInvoices(connectRiversideInvoiceSeed(), options);
  console.log(
    `${result.dryRun ? "Validated" : "Seeded"} ${result.rowCount} fictional Riverside invoices: ${result.invoiceNumbers.join(", ")}.`,
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
