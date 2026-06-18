import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { resolveDocumentSort } from "@/lib/ops/production";

// v1.3 / PSG-27 (PSG-41) — Historical Production search over documents.
// Allow-listed exact filters (never interpolate raw input): by print ID
// (external_id), company, product, repair customer, status. Indexes for each
// path shipped in 20260618180000_production_module_v1_3.sql.

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  const sp = request.nextUrl.searchParams;
  const { column, ascending } = resolveDocumentSort(sp.get("sort"), sp.get("dir"));

  const service = createServiceClient();
  let query = service
    .from("production_documents")
    .select(
      "id, batch_id, company_id, repair_customer_id, product_id, piece_type, status, vendor, external_id, proof_url, expected_delivery_date, created_at"
    )
    .order(column, { ascending })
    .limit(200);

  const externalId = sp.get("external_id");
  const companyId = sp.get("company_id");
  const productId = sp.get("product_id");
  const repairCustomerId = sp.get("repair_customer_id");
  const batchId = sp.get("batch_id");
  const status = sp.get("status");

  if (externalId) query = query.eq("external_id", externalId.trim());
  if (companyId) query = query.eq("company_id", companyId);
  if (productId) query = query.eq("product_id", productId);
  if (repairCustomerId) query = query.eq("repair_customer_id", repairCustomerId);
  if (batchId) query = query.eq("batch_id", batchId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to search documents" }, { status: 500 });
  return NextResponse.json({ documents: data ?? [] });
}
