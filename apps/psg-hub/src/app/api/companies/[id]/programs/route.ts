import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const programSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(0).default(1),
  unit_price_cents: z.number().int().min(0).default(0),
  customizations_jsonb: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();
  const { data, error } = await service
    .from("company_programs")
    .select(`
      id, quantity, unit_price_cents, customizations_jsonb, created_at,
      products(id, name, description, selling_price_cents)
    `)
    .eq("company_id", id)
    .order("created_at");

  if (error) return NextResponse.json({ error: "Failed to load programs" }, { status: 500 });
  return NextResponse.json({ programs: data ?? [] });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id: company_id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = programSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("company_programs")
    .upsert({ company_id, ...parsed.data }, { onConflict: "company_id,product_id" })
    .select("id, quantity, unit_price_cents, customizations_jsonb")
    .single();

  if (error) {
    console.error("[programs POST] failed:", error.message);
    return NextResponse.json({ error: "Failed to enroll program" }, { status: 500 });
  }
  return NextResponse.json({ program: data }, { status: 201 });
}
