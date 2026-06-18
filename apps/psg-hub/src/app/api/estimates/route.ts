import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

// Ops Estimates API (v1.1 / PSG-35, parent PSG-25). Estimates live on the
// manage_companies side of the spine, so this fails closed on that capability;
// RLS (estimates_ops_all) remains the authoritative backstop.

const SELECT =
  "id, estimate_number, company_id, repair_customer_id, created_at, updated_at, " +
  "companies(name), repair_customers(first_name, last_name)";

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim();
  const companyId = params.get("company_id")?.trim();
  const repairCustomerId = params.get("repair_customer_id")?.trim();

  const service = createServiceClient();
  let query = service
    .from("estimates")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(200);

  if (q) query = query.ilike("estimate_number", `%${q}%`);
  if (companyId) query = query.eq("company_id", companyId);
  if (repairCustomerId) query = query.eq("repair_customer_id", repairCustomerId);

  const { data, error } = await query;
  if (error) {
    console.error("[api/estimates GET] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load estimates" }, { status: 500 });
  }
  return NextResponse.json({ estimates: data ?? [] });
}
