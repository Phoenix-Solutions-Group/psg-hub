import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  shop_id: z.string().uuid().nullish(),
  phone: z.string().trim().max(40).nullish(),
  contact: z.string().trim().max(200).nullish(),
  status: z.enum(["active", "inactive", "prospect"]).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();
  const { data, error } = await service
    .from("companies")
    .select(`
      id, name, phone, contact, status, shop_id, address, created_at, updated_at,
      employees(id, name, role, email, phone, created_at),
      company_programs(
        id, quantity, unit_price_cents, customizations_jsonb, created_at,
        products(id, name, description, selling_price_cents)
      )
    `)
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }
  return NextResponse.json({ company: data });
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
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("companies")
    .update({ ...parsed.data })
    .eq("id", id)
    .select("id, name, phone, contact, status, shop_id, updated_at")
    .single();

  if (error || !data) {
    console.error("[api/companies/[id] PATCH] failed:", error?.message);
    return NextResponse.json({ error: "Failed to update company" }, { status: error ? 500 : 404 });
  }
  return NextResponse.json({ company: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();
  const { error } = await service.from("companies").delete().eq("id", id);
  if (error) {
    console.error("[api/companies/[id] DELETE] failed:", error.message);
    return NextResponse.json({ error: "Failed to delete company" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
