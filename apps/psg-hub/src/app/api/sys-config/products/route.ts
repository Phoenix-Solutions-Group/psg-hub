import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  items_jsonb: z.array(z.record(z.string(), z.unknown())).default([]),
  total_cost_cents: z.number().int().min(0).default(0),
  selling_price_cents: z.number().int().min(0).default(0),
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const service = createServiceClient();
  let query = service.from("products").select("id, name, description, selling_price_cents, updated_at").order("name").limit(500);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
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
  const { data, error } = await service.from("products").insert(parsed.data).select("id, name, selling_price_cents").single();
  if (error) {
    console.error("[products POST]:", error.message);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
  return NextResponse.json({ product: data }, { status: 201 });
}
