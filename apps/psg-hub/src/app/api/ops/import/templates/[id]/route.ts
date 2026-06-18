// v1.1 / PSG-38 — Import template detail API (update + delete).
// PATCH  /api/ops/import/templates/{id}  -> rename / remap
// DELETE /api/ops/import/templates/{id}  -> remove
// Gated by manage_companies.
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const TEMPLATE_COLS = "id, company_id, kind, name, field_mapping_jsonb, created_at, updated_at";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    field_mapping: z.record(z.string(), z.string()).optional(),
  })
  .refine((v) => v.name !== undefined || v.field_mapping !== undefined, {
    message: "Provide name and/or field_mapping",
  });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.field_mapping !== undefined) update.field_mapping_jsonb = parsed.data.field_mapping;

  const service = createServiceClient();
  const { data, error } = await service
    .from("import_templates")
    .update(update)
    .eq("id", id)
    .select(TEMPLATE_COLS)
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    if (error.code === "23505") {
      return NextResponse.json({ error: "Name already in use for this kind" }, { status: 409 });
    }
    console.error("[import/templates PATCH] failed:", error.message);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }
  return NextResponse.json({ template: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const service = createServiceClient();
  const { error } = await service.from("import_templates").delete().eq("id", id);
  if (error) {
    console.error("[import/templates DELETE] failed:", error.message);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
