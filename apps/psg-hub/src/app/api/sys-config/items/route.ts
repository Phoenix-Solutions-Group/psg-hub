import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

// SysConfig Items API (v1.1 / PSG-37). Items are the cost building-blocks
// composed into products. manage_sysconfig-gated; RLS is the backstop.
const schema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  requirements_jsonb: z.record(z.string(), z.unknown()).default({}),
  cost_cents: z.number().int().min(0).default(0),
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const service = createServiceClient();
  let query = service.from("items").select("id, name, description, cost_cents, updated_at").order("name").limit(500);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load items" }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
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
  const { data, error } = await service.from("items").insert(parsed.data).select("id, name, cost_cents").single();
  if (error) {
    console.error("[items POST]:", error.message);
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }
  return NextResponse.json({ item: data }, { status: 201 });
}
