import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullish(),
  requirements_jsonb: z.record(z.string(), z.unknown()).optional(),
  cost_cents: z.number().int().min(0).optional(),
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
    .from("items")
    .select("id, name, description, requirements_jsonb, cost_cents, updated_at")
    .eq("id", id).single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item: data });
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
  const { data, error } = await service.from("items").update(parsed.data).eq("id", id).select("id, name, cost_cents").single();
  if (error || !data) return NextResponse.json({ error: "Failed to update" }, { status: error ? 500 : 404 });
  return NextResponse.json({ item: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const service = createServiceClient();
  const { error } = await service.from("items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
