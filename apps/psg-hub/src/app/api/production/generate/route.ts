import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import {
  buildBatchDocuments,
  generateBatchSchema,
  type GenerateCustomer,
} from "@/lib/ops/production";

// v1.3 / PSG-27 (PSG-52) — production batch generation. The "pick product →
// pick company → generate" step from PLANNING.md (/api/production/generate):
// create a named batch for one company's program and render one mail piece per
// repair customer (blank customer set = every customer for the company). The
// rendered HTML feeds the Lob adapter directly at print time. Gated by
// manage_production; RLS backstops. No vendor spend here — generation only
// renders + persists; the (Lob test / in-house) submit happens at print time.

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = generateBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { name, company_id, product_id, product, repair_customer_ids, vendor } = parsed.data;

  const service = createServiceClient();

  // The company supplies the from-address + merge fields for every piece.
  const { data: company, error: companyError } = await service
    .from("companies")
    .select("id, name, phone, address")
    .eq("id", company_id)
    .single();
  if (companyError || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // The recipients: an explicit subset, or every repair customer for the company.
  let customerQuery = service
    .from("repair_customers")
    .select("id, first_name, last_name, address")
    .eq("company_id", company_id);
  if (repair_customer_ids && repair_customer_ids.length > 0) {
    customerQuery = customerQuery.in("id", repair_customer_ids);
  }
  const { data: customers, error: customersError } = await customerQuery;
  if (customersError) {
    return NextResponse.json({ error: "Failed to load repair customers" }, { status: 500 });
  }
  if (!customers || customers.length === 0) {
    return NextResponse.json(
      { error: "No repair customers to generate documents for" },
      { status: 422 }
    );
  }

  // Optional per-shop customizations (greeting/footer/logo) for this program.
  let program: Record<string, string> | null = null;
  if (product_id) {
    const { data: prog } = await service
      .from("company_programs")
      .select("customizations_jsonb")
      .eq("company_id", company_id)
      .eq("product_id", product_id)
      .maybeSingle();
    program = (prog?.customizations_jsonb as Record<string, string> | undefined) ?? null;
  }

  const built = buildBatchDocuments(
    {
      id: company.id,
      name: company.name,
      phone: company.phone,
      address: company.address as GenerateCustomer["address"],
      program,
    },
    (customers as GenerateCustomer[]),
    { product, productId: product_id ?? null, vendor: vendor ?? null }
  );

  // Create the batch first (queued, with the resolved vendor + document count),
  // then its documents. The print queue (draft/queued/printing) picks it up.
  const { data: batch, error: batchError } = await service
    .from("production_batches")
    .insert({
      name,
      company_id,
      product_id: product_id ?? null,
      status: "queued",
      vendor: built.vendor,
      document_count: built.documentCount,
      created_by_profile_id: gate.userId,
    })
    .select("id, name, company_id, product_id, status, vendor, document_count, created_at")
    .single();
  if (batchError || !batch) {
    console.error("[production/generate] batch insert:", batchError?.message);
    return NextResponse.json({ error: "Failed to create batch" }, { status: 500 });
  }

  const rows = built.documents.map((d) => ({ ...d, batch_id: batch.id }));
  const { error: docsError } = await service.from("production_documents").insert(rows);
  if (docsError) {
    // Don't leave an empty orphan batch behind if the documents fail to insert.
    await service.from("production_batches").delete().eq("id", batch.id);
    console.error("[production/generate] documents insert:", docsError.message);
    return NextResponse.json({ error: "Failed to generate documents" }, { status: 500 });
  }

  return NextResponse.json(
    {
      batch,
      documents: built.documentCount,
      vendor: built.vendor,
      missing: built.missingByCustomer,
    },
    { status: 201 }
  );
}
