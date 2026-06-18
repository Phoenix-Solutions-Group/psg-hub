import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

// Ops Employees item API (v1.1 / PSG-33). update/delete a single employee,
// scoped to its parent company. Gated by manage_companies; RLS backstops.

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    role: z.string().trim().max(100).nullable(),
    email: z.string().email().nullable(),
    phone: z.string().trim().max(40).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "No fields to update" });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; employeeId: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id, employeeId } = await params;

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
    .from("employees")
    .update(parsed.data)
    .eq("id", employeeId)
    .eq("company_id", id)
    .select("id, name, role, email, phone, created_at, updated_at")
    .maybeSingle();

  if (error) {
    console.error("[employees/:id PATCH] failed:", error.message);
    return NextResponse.json({ error: "Failed to update employee" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ employee: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; employeeId: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id, employeeId } = await params;

  const service = createServiceClient();
  const { data, error } = await service
    .from("employees")
    .delete()
    .eq("id", employeeId)
    .eq("company_id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[employees/:id DELETE] failed:", error.message);
    return NextResponse.json({ error: "Failed to delete employee" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
