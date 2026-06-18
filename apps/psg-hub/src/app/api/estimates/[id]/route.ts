import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

// Single ops estimate (v1.1 / PSG-35). Same manage_companies gate as the list;
// returns the full payload_jsonb for the detail view. 404 on unknown id.

const SELECT =
  "id, estimate_number, company_id, repair_customer_id, payload_jsonb, created_at, updated_at, " +
  "companies(id, name), repair_customers(id, first_name, last_name, phone, email)";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid estimate id" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("estimates")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[api/estimates/[id] GET] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load estimate" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
  }
  return NextResponse.json({ estimate: data });
}
