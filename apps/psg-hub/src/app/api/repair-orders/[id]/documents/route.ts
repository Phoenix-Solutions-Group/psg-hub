import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { addDocumentSchema, appendDocument } from "@/lib/ops/repair";

// "Add Additional Document" workflow (v1.1 / PSG-34). Documents live on the RO
// spine inside payload_jsonb.documents[] — no separate table, keeping PSG-34 on
// the repair_orders spine. Gated by manage_companies; RLS backstops.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_companies");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = addDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 422 });
  }

  const service = createServiceClient();
  const { data: current, error: readErr } = await service
    .from("repair_orders")
    .select("payload_jsonb")
    .eq("id", id)
    .single();
  if (readErr || !current) return NextResponse.json({ error: "RO not found" }, { status: 404 });

  const nextPayload = appendDocument(
    (current.payload_jsonb ?? {}) as Record<string, unknown>,
    parsed.data,
    crypto.randomUUID(),
    new Date().toISOString(),
  );

  const { data, error } = await service
    .from("repair_orders")
    .update({ payload_jsonb: nextPayload })
    .eq("id", id)
    .select("id, payload_jsonb, updated_at")
    .single();

  if (error || !data) {
    console.error("[repair-orders/[id]/documents POST]:", error?.message);
    return NextResponse.json({ error: "Failed to add document" }, { status: 500 });
  }
  const documents = (data.payload_jsonb as { documents?: unknown }).documents ?? [];
  return NextResponse.json({ documents }, { status: 201 });
}
