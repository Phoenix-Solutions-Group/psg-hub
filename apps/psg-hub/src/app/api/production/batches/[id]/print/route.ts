import { type NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireOpsFn } from "@/lib/auth/ops-access";
import { createMailAdapter } from "@/lib/production/adapters";
import {
  nextBatchStatusOnPrint,
  printBatch,
  type BatchStatus,
  type ProductionClient,
} from "@/lib/ops/production";
import { MailProductionError } from "@/lib/production/types";

// v1.3 / PSG-43 (PSG-27/PSG-41) — print a whole production batch via the
// per-template/per-shop selected vendor (lob | inhouse). Passing the
// createMailAdapter resolver lets each document submit through the adapter its
// persisted vendor choice selects, then moves the batch printing→historical on
// success. Gated by manage_production. Live Lob spend is gated by board gate G4;
// a test_* LOB_API_KEY exercises the Lob path with no spend.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireOpsFn("manage_production");
  if (!gate.ok) return gate.response;
  const { id } = await params;

  const service = createServiceClient();

  // The batch must be in a printable (non-terminal) state.
  const { data: batch, error: batchError } = await service
    .from("production_batches")
    .select("id, status")
    .eq("id", id)
    .single();
  if (batchError || !batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  if (nextBatchStatusOnPrint(batch.status as BatchStatus) === null) {
    return NextResponse.json(
      { error: `Batch is ${batch.status} and cannot be printed` },
      { status: 409 }
    );
  }

  // Submit only documents that have not already been handed to the vendor, so a
  // re-run never double-mails a piece that already has an external_id.
  const { data: docs, error: docsError } = await service
    .from("production_documents")
    .select("id, external_id")
    .eq("batch_id", id);
  if (docsError) {
    return NextResponse.json({ error: "Failed to load batch documents" }, { status: 500 });
  }
  if (!docs || docs.length === 0) {
    return NextResponse.json({ error: "Batch has no documents" }, { status: 422 });
  }
  const toPrint = docs.filter((d) => !d.external_id).map((d) => d.id);

  const client = service as unknown as ProductionClient;

  try {
    const outcome = await printBatch(client, createMailAdapter, id, toPrint, new Date().toISOString());
    return NextResponse.json({ outcome }, { status: 200 });
  } catch (error) {
    if (error instanceof MailProductionError) {
      // Vendor rejection (e.g. bad address / missing asset) is a 422 client error;
      // transient/circuit issues are a 502 so the caller can retry the batch.
      const status = error.retryable ? 502 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("[production/batches/[id]/print]:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Failed to print batch" }, { status: 500 });
  }
}
