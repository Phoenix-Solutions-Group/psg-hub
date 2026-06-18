import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const employeeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().max(100).nullish(),
  email: z.string().email().nullish(),
  phone: z.string().trim().max(40).nullish(),
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
    .from("employees")
    .select("id, name, role, email, phone, created_at, updated_at")
    .eq("company_id", id)
    .order("name");

  if (error) return NextResponse.json({ error: "Failed to load employees" }, { status: 500 });
  return NextResponse.json({ employees: data ?? [] });
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
  const parsed = employeeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("employees")
    .insert({ company_id, ...parsed.data })
    .select("id, name, role, email, phone, created_at, updated_at")
    .single();

  if (error) {
    console.error("[employees POST] failed:", error.message);
    return NextResponse.json({ error: "Failed to create employee" }, { status: 500 });
  }
  return NextResponse.json({ employee: data }, { status: 201 });
}
