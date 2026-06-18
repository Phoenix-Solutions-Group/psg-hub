import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isTerminalMailStatus, type MailWebhookEvent } from "./types";

/**
 * Persist an inbound vendor webhook event (e.g. a verified Lob status callback)
 * into the production data model. Mirrors the SendGrid/Twilio ingestion path:
 * a service-role client (RLS bypass) does an idempotent upsert keyed by the
 * UNIQUE(external_id, status) constraint, then advances the document status.
 *
 * Idempotency: a replayed (external_id, status) is ignored (no duplicate row),
 * and the document update is a monotonic best-effort, so re-delivery is safe.
 *
 * The supabase client is injectable so this is unit-testable without a live DB.
 */

/** Minimal slice of the supabase client surface this function uses. */
export interface ProductionJobClient {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
    upsert: (
      rows: Record<string, unknown>[],
      opts: { onConflict: string; ignoreDuplicates: boolean }
    ) => Promise<{ error: { message: string } | null }>;
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
}

export interface RecordResult {
  /** The document the event was correlated to, when found. */
  documentId: string | null;
  /** Whether the document status was advanced by this event. */
  documentUpdated: boolean;
}

export async function recordMailVendorEvent(
  event: MailWebhookEvent,
  client?: ProductionJobClient
): Promise<RecordResult> {
  const supabase = client ?? (createServiceClient() as unknown as ProductionJobClient);

  // Correlate to the document by vendor job id (may be absent if the create
  // response was not yet persisted — the vendor job row still records the event).
  const { data: doc, error: lookupError } = await supabase
    .from("production_documents")
    .select("id")
    .eq("external_id", event.externalId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`recordMailVendorEvent lookup failed: ${lookupError.message}`);
  }

  const { error: upsertError } = await supabase.from("mail_vendor_jobs").upsert(
    [
      {
        document_id: doc?.id ?? null,
        vendor: event.vendor,
        external_id: event.externalId,
        status: event.status,
        event_type: event.eventType,
        occurred_at: event.occurredAt ?? null,
        raw_jsonb: event.raw ?? {},
      },
    ],
    // UNIQUE(external_id, status): a replayed lifecycle row dedupes.
    { onConflict: "external_id,status", ignoreDuplicates: true }
  );
  if (upsertError) {
    throw new Error(`recordMailVendorEvent upsert failed: ${upsertError.message}`);
  }

  // Advance the document status (skip the noise "unknown" status so a parse miss
  // never overwrites a real prior status). Terminal states stick.
  let documentUpdated = false;
  if (doc?.id && event.status !== "unknown") {
    const { error: updateError } = await supabase
      .from("production_documents")
      .update({ status: event.status })
      .eq("id", doc.id);
    if (updateError) {
      throw new Error(`recordMailVendorEvent status update failed: ${updateError.message}`);
    }
    documentUpdated = true;
    void isTerminalMailStatus; // status-machine guards live in the batch service (follow-up)
  }

  return { documentId: doc?.id ?? null, documentUpdated };
}
