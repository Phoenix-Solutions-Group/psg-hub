// v1.3 / PSG-27 (PSG-41) — Production print queue + reprint (audit) + historical search.
// Pure zod schemas + workflow orchestration over the v1.3 data model
// (production_batches / production_documents / mail_vendor_jobs /
// production_reprint_log), reused by the /api/production/* route handlers and
// unit-tested in isolation. Gated by the manage_production capability at the
// route/RLS layers. The mail vendor is reached only through the MailAdapter
// interface (src/lib/production/types.ts), so this layer is vendor-agnostic.

import "server-only";
import { z } from "zod";
import type {
  MailAdapter,
  MailAddress,
  MailDocument,
  MailPieceType,
} from "@/lib/production/types";

// ---------------------------------------------------------------------------
// Batch status machine.
// ---------------------------------------------------------------------------
export const BATCH_STATUSES = ["draft", "queued", "printing", "historical", "cancelled"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * The status a batch moves to once its documents have been handed to the vendor.
 * Happy path: draft → queued → printing → historical. A cancelled batch never
 * prints. Returns null when the transition is not allowed (already terminal).
 */
export function nextBatchStatusOnPrint(current: BatchStatus): BatchStatus | null {
  switch (current) {
    case "draft":
    case "queued":
    case "printing":
      return "printing";
    case "historical":
    case "cancelled":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Address (shared ops jsonb shape) → MailAddress.
// ---------------------------------------------------------------------------
/** The jsonb address shape stored on production_documents.to_address / from_address. */
export const productionAddressSchema = z.object({
  name: z.string().trim().min(1).max(200),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(2).max(2),
  postal_code: z.string().trim().min(5).max(10),
});
export type ProductionAddress = z.infer<typeof productionAddressSchema>;

/** Map the stored jsonb address onto the vendor-agnostic MailAddress. */
export function toMailAddress(address: ProductionAddress): MailAddress {
  return {
    name: address.name,
    addressLine1: address.line1,
    addressLine2: address.line2 ?? undefined,
    city: address.city,
    state: address.state,
    zip: address.postal_code,
    country: "US",
  };
}

// ---------------------------------------------------------------------------
// Create-batch input.
// ---------------------------------------------------------------------------
export const createBatchSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  company_id: z.string().uuid(),
  product_id: z.string().uuid().nullish(),
});
export type CreateBatchInput = z.infer<typeof createBatchSchema>;

export const reprintSchema = z.object({
  reason: z.string().trim().max(500).nullish(),
});

// ---------------------------------------------------------------------------
// Historical search — allow-listed filters + sort (never interpolate raw input).
// ---------------------------------------------------------------------------
export const DOCUMENT_SORT_COLUMNS = ["created_at", "updated_at", "status"] as const;
export type DocumentSortColumn = (typeof DOCUMENT_SORT_COLUMNS)[number];

export function resolveDocumentSort(
  column: string | null | undefined,
  direction: string | null | undefined
): { column: DocumentSortColumn; ascending: boolean } {
  const col = (DOCUMENT_SORT_COLUMNS as readonly string[]).includes(column ?? "")
    ? (column as DocumentSortColumn)
    : "created_at";
  return { column: col, ascending: direction === "asc" };
}

export interface HistoricalSearchParams {
  /** Vendor job id (Lob psc_/ltr_), exact. */
  externalId?: string | null;
  companyId?: string | null;
  productId?: string | null;
  repairCustomerId?: string | null;
  status?: string | null;
}

// ---------------------------------------------------------------------------
// Minimal supabase surface used by the orchestration (injectable for tests).
// ---------------------------------------------------------------------------
interface DbError {
  message: string;
}
interface SelectChain {
  eq: (col: string, val: string) => { single: () => Promise<{ data: DocumentRow | null; error: DbError | null }> };
}
interface UpdateChain {
  eq: (col: string, val: string) => Promise<{ error: DbError | null }>;
}
interface InsertResult {
  error: DbError | null;
}
export interface ProductionClient {
  from(table: string): {
    select: (cols: string) => SelectChain;
    update: (values: Record<string, unknown>) => UpdateChain;
    insert: (rows: Record<string, unknown>) => Promise<InsertResult>;
  };
}

export interface DocumentRow {
  id: string;
  batch_id: string;
  piece_type: MailPieceType;
  to_address: ProductionAddress;
  from_address: ProductionAddress;
  rendered_url: string | null;
  product_id: string | null;
}

export interface PrintOutcome {
  documentId: string;
  externalId: string;
  status: string;
  vendor: string;
}

/** Build the vendor-agnostic MailDocument from a stored production document row. */
export function buildMailDocument(doc: DocumentRow): MailDocument {
  const base: MailDocument = {
    documentId: doc.id,
    pieceType: doc.piece_type,
    to: toMailAddress(doc.to_address),
    from: toMailAddress(doc.from_address),
    metadata: { batchId: doc.batch_id },
  };
  if (doc.piece_type === "postcard") {
    // Size defaults to the adapter's 4x6 when the rendered template doesn't pin one.
    return { ...base, front: doc.rendered_url ?? undefined };
  }
  return { ...base, file: doc.rendered_url ?? undefined };
}

/**
 * Submit one document to the vendor and persist the result back onto the row.
 * Shared by the single-document print, batch print, and reprint paths.
 */
export async function printDocument(
  client: ProductionClient,
  adapter: MailAdapter,
  documentId: string
): Promise<PrintOutcome> {
  const { data: doc, error } = await client
    .from("production_documents")
    .select("id, batch_id, piece_type, to_address, from_address, rendered_url, product_id")
    .eq("id", documentId)
    .single();
  if (error) throw new Error(`printDocument load failed: ${error.message}`);
  if (!doc) throw new Error("printDocument: document not found");

  const result = await adapter.submit(buildMailDocument(doc));

  const { error: updateError } = await client
    .from("production_documents")
    .update({
      external_id: result.externalId,
      vendor: result.vendor,
      status: result.status,
      proof_url: result.proofUrl ?? null,
      expected_delivery_date: result.expectedDeliveryDate ?? null,
    })
    .eq("id", documentId);
  if (updateError) throw new Error(`printDocument persist failed: ${updateError.message}`);

  return {
    documentId,
    externalId: result.externalId,
    status: result.status,
    vendor: result.vendor,
  };
}

/**
 * Reprint a document: re-submit to the vendor AND write the dedicated audit row
 * (production_reprint_log) — the v1.3 production-audit gate. The audit row is
 * written only after a successful re-submit + persist, because a reprint that
 * never reached the vendor is not a reprint.
 */
export async function reprintDocument(
  client: ProductionClient,
  adapter: MailAdapter,
  documentId: string,
  actorProfileId: string,
  reason?: string | null
): Promise<PrintOutcome> {
  const outcome = await printDocument(client, adapter, documentId);

  const { error } = await client.from("production_reprint_log").insert({
    document_id: documentId,
    reprinted_by_profile_id: actorProfileId,
    reason: reason ?? null,
  });
  if (error) throw new Error(`reprintDocument audit write failed: ${error.message}`);

  return outcome;
}
