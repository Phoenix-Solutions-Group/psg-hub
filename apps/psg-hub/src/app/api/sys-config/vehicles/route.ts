import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const schema = z.object({
  make: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const service = createServiceClient();
  let query = service.from("vehicles").select("id, make, model, updated_at").order("make").order("model").limit(500);
  if (q) query = query.or(`make.ilike.%${q}%,model.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load vehicles" }, { status: 500 });
  return NextResponse.json({ vehicles: data ?? [] });
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
  const { data, error } = await service.from("vehicles").insert(parsed.data).select("id, make, model").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Vehicle already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to create vehicle" }, { status: 500 });
  }
  return NextResponse.json({ vehicle: data }, { status: 201 });
}
