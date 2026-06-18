import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { BATCH_STATUSES, createBatchSchema } from "@/lib/ops/production";

// v1.3 / PSG-27 (PSG-41) — production batches list + create. Gated by
// manage_production; RLS backstops. Historical search over batches: by name,
// company, status.

export async function GET(request: NextRequest) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const companyId = sp.get("company_id");
  const status = sp.get("status");

  const service = createServiceClient();
  let query = service
    .from("production_batches")
    .select("id, name, company_id, product_id, status, vendor, document_count, printed_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (companyId) query = query.eq("company_id", companyId);
  if (status && (BATCH_STATUSES as readonly string[]).includes(status)) {
    query = query.eq("status", status);
  }
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.ilike("name", `%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load batches" }, { status: 500 });
  return NextResponse.json({ batches: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createBatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const service = createServiceClient();
  const { data, error } = await service
    .from("production_batches")
    .insert({
      name: parsed.data.name,
      company_id: parsed.data.company_id,
      product_id: parsed.data.product_id ?? null,
      created_by_profile_id: gate.userId,
    })
    .select("id, name, company_id, product_id, status, created_at")
    .single();

  if (error) {
    console.error("[production/batches POST]:", error.message);
    return NextResponse.json({ error: "Failed to create batch" }, { status: 500 });
  }
  return NextResponse.json({ batch: data }, { status: 201 });
}
