import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  items_jsonb: z.array(z.record(z.string(), z.unknown())).optional(),
  total_cost_cents: z.number().int().min(0).optional(),
  selling_price_cents: z.number().int().min(0).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();
  const { data, error } = await service
    .from("products")
    .select("id, name, description, items_jsonb, total_cost_cents, selling_price_cents, updated_at")
    .eq("id", id).single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ product: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 422 });

  const service = createServiceClient();
  const { data, error } = await service.from("products").update(parsed.data).eq("id", id).select("id, name, selling_price_cents").single();
  if (error || !data) return NextResponse.json({ error: "Failed to update" }, { status: error ? 500 : 404 });
  return NextResponse.json({ product: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const service = createServiceClient();
  const { error } = await service.from("products").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
