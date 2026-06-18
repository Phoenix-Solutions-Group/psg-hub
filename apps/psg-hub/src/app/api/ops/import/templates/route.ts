// v1.1 / PSG-38 — Import templates API (list + create).
// GET  /api/ops/import/templates?company_id=&kind=   -> per-company templates
// POST /api/ops/import/templates                      -> create a template
// Gated by manage_companies (import_templates lives in that RLS group).
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const TEMPLATE_COLS = "id, company_id, kind, name, field_mapping_jsonb, created_at, updated_at";

const createSchema = z.object({
  company_id: z.string().uuid(),
  kind: z.enum(["ro", "estimate"]),
  name: z.string().trim().min(1).max(120),
  field_mapping: z.record(z.string(), z.string()).default({}),
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const sp = request.nextUrl.searchParams;
  const companyId = sp.get("company_id");
  const kind = sp.get("kind");
  if (!companyId) {
    return NextResponse.json({ error: "company_id is required" }, { status: 400 });
  }

  const service = createServiceClient();
  let query = service
    .from("import_templates")
    .select(TEMPLATE_COLS)
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (kind === "ro" || kind === "estimate") query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error) {
    console.error("[import/templates GET] failed:", error.message);
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
  }
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { company_id, kind, name, field_mapping } = parsed.data;
  const service = createServiceClient();
  const { data, error } = await service
    .from("import_templates")
    .insert({ company_id, kind, name, field_mapping_jsonb: field_mapping })
    .select(TEMPLATE_COLS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A template with that name already exists for this kind" },
        { status: 409 },
      );
    }
    console.error("[import/templates POST] failed:", error.message);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
  return NextResponse.json({ template: data }, { status: 201 });
}
