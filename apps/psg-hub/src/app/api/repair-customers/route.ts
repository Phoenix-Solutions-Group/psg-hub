import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createRepairCustomerSchema, resolveSort } from "@/lib/ops/repair";

const createSchema = createRepairCustomerSchema;

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const company_id = sp.get("company_id");
  const { column, ascending } = resolveSort(sp.get("sort"), sp.get("dir"));

  const service = createServiceClient();
  let query = service
    .from("repair_customers")
    .select("id, company_id, first_name, last_name, phone, email, created_at")
    .order(column, { ascending })
    .limit(200);

  if (company_id) query = query.eq("company_id", company_id);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`last_name.ilike.%${safe}%,first_name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load customers" }, { status: 500 });
  return NextResponse.json({ customers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("repair_customers")
    .insert({ ...parsed.data, address: parsed.data.address ?? {} })
    .select("id, company_id, first_name, last_name, phone, email, created_at")
    .single();

  if (error) {
    console.error("[repair-customers POST]:", error.message);
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
  }
  return NextResponse.json({ customer: data }, { status: 201 });
}
