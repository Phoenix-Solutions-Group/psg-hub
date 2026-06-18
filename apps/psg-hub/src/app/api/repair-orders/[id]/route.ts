import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { updateRepairOrderSchema, canTransition, type RoStatus } from "@/lib/ops/repair";

// Repair Order detail + mutate (v1.1 / PSG-34). PATCH drives the Preview/Cancel
// workflows via guarded status transitions; the "Add Additional Document" workflow
// lives in the nested ./documents route. Gated by manage_companies; RLS backstops.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();
  const { data, error } = await service
    .from("repair_orders")
    .select(`
      id, ro_number, status, total_loss_flag, dates_json, payload_jsonb, created_at, updated_at,
      company_id, repair_customer_id,
      repair_customers(id, first_name, last_name, phone, email),
      companies(id, name),
      vehicles(id, make, model),
      insurance_companies(id, name),
      insurance_agents(id, name, phone, email)
    `)
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "RO not found" }, { status: 404 });
  return NextResponse.json({ repair_order: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateRepairOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });
  }

  const service = createServiceClient();

  // Guard status transitions (Preview / Cancel / Close): a cancelled or closed RO
  // is terminal, so we fetch the current status and reject illegal moves up front
  // rather than silently writing them. payload_jsonb is owned by ./documents.
  if (parsed.data.status) {
    const { data: current, error: readErr } = await service
      .from("repair_orders")
      .select("status")
      .eq("id", id)
      .single();
    if (readErr || !current) return NextResponse.json({ error: "RO not found" }, { status: 404 });
    if (!canTransition(current.status as RoStatus, parsed.data.status)) {
      return NextResponse.json(
        { error: `Cannot move RO from ${current.status} to ${parsed.data.status}` },
        { status: 409 }
      );
    }
  }

  const { data, error } = await service
    .from("repair_orders")
    .update(parsed.data)
    .eq("id", id)
    .select("id, ro_number, status, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "RO number already exists for this company" }, { status: 409 });
    }
    console.error("[repair-orders/[id] PATCH]:", error.message);
    return NextResponse.json({ error: "Failed to update RO" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "RO not found" }, { status: 404 });
  return NextResponse.json({ repair_order: data });
}
