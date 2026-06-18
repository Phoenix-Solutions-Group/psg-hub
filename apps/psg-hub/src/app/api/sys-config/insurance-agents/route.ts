import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

const schema = z.object({
  name: z.string().trim().min(1).max(200),
  insurance_company_ids: z.array(z.string().uuid()).default([]),
  address: z.record(z.string(), z.unknown()).default({}),
  email: z.string().email().nullish(),
  phone: z.string().trim().max(40).nullish(),
  mobile: z.string().trim().max(40).nullish(),
  fax: z.string().trim().max(40).nullish(),
  contacts_jsonb: z.array(z.record(z.string(), z.unknown())).default([]),
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_sysconfig");
  if (!gate.ok) return gate.response;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const service = createServiceClient();
  let query = service
    .from("insurance_agents")
    .select("id, name, insurance_company_ids, email, phone, updated_at")
    .order("name")
    .limit(500);
  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  return NextResponse.json({ insurance_agents: data ?? [] });
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
  const { data, error } = await service.from("insurance_agents").insert(parsed.data).select("id, name, email, phone").single();
  if (error) {
    console.error("[insurance-agents POST]:", error.message);
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
  return NextResponse.json({ insurance_agent: data }, { status: 201 });
}
