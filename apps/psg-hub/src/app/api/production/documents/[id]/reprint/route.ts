import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createMailAdapter } from "@/lib/production/adapters";
import { reprintDocument, reprintSchema, type ProductionClient } from "@/lib/ops/production";
import { MailProductionError } from "@/lib/production/types";

// v1.3 / PSG-43 (PSG-27/PSG-41) — reprint a production document. Re-submits via
// the per-template/per-shop selected vendor (lob | inhouse) AND writes the
// dedicated production_reprint_log audit row (who/why) — the v1.3 production-audit
// gate. Gated by manage_production.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = reprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const client = createServiceClient() as unknown as ProductionClient;

  try {
    const outcome = await reprintDocument(client, createMailAdapter, id, gate.userId, parsed.data.reason);
    return NextResponse.json({ outcome }, { status: 200 });
  } catch (error) {
    if (error instanceof MailProductionError) {
      const status = error.retryable ? 502 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[production/documents/[id]/reprint]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to reprint document" }, { status: 500 });
  }
}
