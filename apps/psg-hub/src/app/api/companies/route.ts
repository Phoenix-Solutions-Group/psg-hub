import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";

// Ops Companies API (v1.1 / PSG-25). Gated by the manage_companies capability;
// RLS is the authoritative backstop, requireOpsFn fails closed first.

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postal_code: z.string().optional(),
  })
  .partial()
  .optional();

const createCompanySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  shop_id: z.string().uuid().nullish(),
  phone: z.string().trim().max(40).nullish(),
  contact: z.string().trim().max(200).nullish(),
  status: z.enum(["active", "inactive", "prospect"]).default("active"),
  address: addressSchema,
});

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  const service = createServiceClient();
  let query = service
    .from("companies")
    .select("id, name, phone, contact, status, shop_id, created_at, updated_at")
    .order("name", { ascending: true })
    .limit(200);

  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error("[api/companies GET] query failed:", error.message);
    return NextResponse.json({ error: "Failed to load companies" }, { status: 500 });
  }
  return NextResponse.json({ companies: data ?? [] });
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

  const parsed = createCompanySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { name, shop_id, phone, contact, status, address } = parsed.data;
  const service = createServiceClient();
  const { data, error } = await service
    .from("companies")
    .insert({
      name,
      shop_id: shop_id ?? null,
      phone: phone ?? null,
      contact: contact ?? null,
      status,
      address: address ?? {},
    })
    .select("id, name, phone, contact, status, shop_id, created_at, updated_at")
    .single();

  if (error) {
    console.error("[api/companies POST] insert failed:", error.message);
    return NextResponse.json({ error: "Failed to create company" }, { status: 500 });
  }
  return NextResponse.json({ company: data }, { status: 201 });
}
