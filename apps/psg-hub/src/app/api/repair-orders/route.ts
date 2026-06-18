import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const createSchema = z.object({
  repair_customer_id: z.string().uuid(),
  company_id: z.string().uuid(),
  ro_number: z.string().trim().min(1).max(100),
  vehicle_id: z.string().uuid().nullish(),
  insurance_company_id: z.string().uuid().nullish(),
  insurance_agent_id: z.string().uuid().nullish(),
  total_loss_flag: z.boolean().default(false),
  status: z.enum(["open", "preview", "cancelled", "closed"]).default("open"),
  dates_json: z.record(z.string(), z.unknown()).default({}),
  payload_jsonb: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const company_id = request.nextUrl.searchParams.get("company_id");
  const customer_id = request.nextUrl.searchParams.get("customer_id");
  const status = request.nextUrl.searchParams.get("status");
  const q = request.nextUrl.searchParams.get("q")?.trim();

  const service = createServiceClient();
  let query = service
    .from("repair_orders")
    .select(`
      id, ro_number, status, total_loss_flag, dates_json, created_at, updated_at,
      company_id, repair_customer_id,
      repair_customers(first_name, last_name),
      vehicles(make, model),
      insurance_companies(name)
    `)
    .order("created_at", { ascending: false })
    .limit(200);

  if (company_id) query = query.eq("company_id", company_id);
  if (customer_id) query = query.eq("repair_customer_id", customer_id);
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("ro_number", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load ROs" }, { status: 500 });
  return NextResponse.json({ repair_orders: data ?? [] });
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
    .from("repair_orders")
    .insert({ ...parsed.data })
    .select("id, ro_number, status, company_id, repair_customer_id, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "RO number already exists for this company" }, { status: 409 });
    }
    console.error("[repair-orders POST]:", error.message);
    return NextResponse.json({ error: "Failed to create RO" }, { status: 500 });
  }
  return NextResponse.json({ repair_order: data }, { status: 201 });
}
