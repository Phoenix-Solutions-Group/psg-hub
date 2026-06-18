import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createLobAdapter } from "@/lib/production/lob";
import { printDocument, type ProductionClient } from "@/lib/ops/production";
import { MailProductionError } from "@/lib/production/types";

// v1.3 / PSG-27 (PSG-41) — print a single production document via the selected
// vendor (Lob now). Submits through the MailAdapter, persists external_id +
// status. Gated by manage_production. Live Lob spend is gated by board gate G4;
// a test_* LOB_API_KEY exercises this path with no spend.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const client = createServiceClient() as unknown as ProductionClient;
  const adapter = createLobAdapter();

  try {
    const outcome = await printDocument(client, adapter, id);
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
