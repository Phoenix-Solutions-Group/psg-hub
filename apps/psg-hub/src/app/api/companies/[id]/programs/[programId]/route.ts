import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

// Ops Company Programs item API (v1.1 / PSG-33). update/unenroll a single
// company_programs row (quantity, unit price, per-company customizations:
// logo/header/footer/greeting). Gated by manage_companies; RLS backstops.

const updateSchema = z
  .object({
    quantity: z.number().int().min(0),
    unit_price_cents: z.number().int().min(0),
    customizations_jsonb: z.record(z.string(), z.unknown()),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; programId: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id, programId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("company_programs")
    .update(parsed.data)
    .eq("id", programId)
    .eq("company_id", id)
    .select(
      `id, quantity, unit_price_cents, customizations_jsonb, created_at,
       products(id, name, description, selling_price_cents)`
    )
    .maybeSingle();

  if (error) {
    console.error("[programs/:id PATCH] failed:", error.message);
    return NextResponse.json({ error: "Failed to update program" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ program: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; programId: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id, programId } = await params;

  const service = createServiceClient();
  const { data, error } = await service
    .from("company_programs")
    .delete()
    .eq("id", programId)
    .eq("company_id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[programs/:id DELETE] failed:", error.message);
    return NextResponse.json({ error: "Failed to unenroll program" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
