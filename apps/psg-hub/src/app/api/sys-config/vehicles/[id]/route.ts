import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const schema = z.object({
  make: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(100).optional(),
});

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
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });

  const service = createServiceClient();
  const { data, error } = await service.from("vehicles").update(parsed.data).eq("id", id).select("id, make, model").single();
  if (error || !data) return NextResponse.json({ error: "Failed to update" }, { status: error ? 500 : 404 });
  return NextResponse.json({ vehicle: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();
  const { error } = await service.from("vehicles").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
