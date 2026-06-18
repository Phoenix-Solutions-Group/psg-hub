import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  insurance_company_ids: z.array(z.string().uuid()).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  email: z.string().email().nullish(),
  phone: z.string().trim().max(40).nullish(),
  mobile: z.string().trim().max(40).nullish(),
  fax: z.string().trim().max(40).nullish(),
  contacts_jsonb: z.array(z.record(z.string(), z.unknown())).optional(),
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
    .from("insurance_agents")
    .select("id, name, insurance_company_ids, address, email, phone, mobile, fax, contacts_jsonb, updated_at")
    .eq("id", id).single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ insurance_agent: data });
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
  const { data, error } = await service.from("insurance_agents").update(parsed.data).eq("id", id).select("id, name, email, phone").single();
  if (error || !data) return NextResponse.json({ error: "Failed to update" }, { status: error ? 500 : 404 });
  return NextResponse.json({ insurance_agent: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const service = createServiceClient();
  const { error } = await service.from("insurance_agents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
