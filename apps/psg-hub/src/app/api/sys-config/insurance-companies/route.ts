import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const schema = z.object({ name: z.string().trim().min(1).max(200) });

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const service = createServiceClient();
  let query = service.from("insurance_companies").select("id, name, updated_at").order("name").limit(500);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  return NextResponse.json({ insurance_companies: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });

  const service = createServiceClient();
  const { data, error } = await service.from("insurance_companies").insert(parsed.data).select("id, name").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Insurance company already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
  return NextResponse.json({ insurance_company: data }, { status: 201 });
}
