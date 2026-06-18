import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createMailAdapter } from "@/lib/production/adapters";
import { printDocument, type ProductionClient } from "@/lib/ops/production";
import { MailProductionError } from "@/lib/production/types";

// v1.3 / PSG-43 (PSG-27/PSG-41) — print a single production document via the
// per-template/per-shop selected vendor (lob | inhouse). Passing the
// createMailAdapter resolver lets printDocument pick the adapter from the
// document's persisted vendor choice (selectVendor). Persists external_id +
// status. Gated by manage_production. Live Lob spend is gated by board gate G4;
// a test_* LOB_API_KEY exercises the Lob path with no spend, and the in-house
// adapter incurs no Lob spend at all.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const client = createServiceClient() as unknown as ProductionClient;

  try {
    const outcome = await printDocument(client, createMailAdapter, id);
    return NextResponse.json({ outcome }, { status: 200 });
  } catch (error) {
    if (error instanceof MailProductionError) {
      // Vendor rejection (e.g. bad address / missing asset) is a 422 client error;
      // transient/circuit issues are a 502 so the caller can retry.
      const status = error.retryable ? 502 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[production/documents/[id]/print]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to print document" }, { status: 500 });
  }
}
