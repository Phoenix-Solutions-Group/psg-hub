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
  MailVendor,
} from "@/lib/production/types";
import { selectVendor } from "@/lib/production/select-vendor";
import {
  defaultTemplate,
  renderMailContent,
  type MailMergeData,
  type MailProduct,
  type ProgramCustomizations,
} from "@/lib/production/templates";

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
  /**
   * Vendor selected for this piece (mirrors the per-template/per-shop choice
   * persisted on the parent batch at queue time). Drives adapter selection at
   * print time via {@link selectVendor}; null falls back to the default vendor.
   */
  vendor?: MailVendor | null;
}

/**
 * Resolve the concrete adapter for a print. Callers may pass either a fixed
 * `MailAdapter` (vendor already decided) or a resolver that maps the selected
 * vendor → adapter, in which case the document's persisted per-template/per-shop
 * vendor choice (via {@link selectVendor}) decides which adapter handles the piece.
 */
export type MailAdapterResolver = (vendor: MailVendor) => MailAdapter;

function resolvePrintAdapter(
  adapter: MailAdapter | MailAdapterResolver,
  doc: DocumentRow
): MailAdapter {
  if (typeof adapter === "function") {
    return adapter(selectVendor({ documentVendor: doc.vendor ?? null }));
  }
  return adapter;
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
  adapter: MailAdapter | MailAdapterResolver,
  documentId: string
): Promise<PrintOutcome> {
  const { data: doc, error } = await client
    .from("production_documents")
    .select("id, batch_id, piece_type, to_address, from_address, rendered_url, product_id, vendor")
    .eq("id", documentId)
    .single();
  if (error) throw new Error(`printDocument load failed: ${error.message}`);
  if (!doc) throw new Error("printDocument: document not found");

  const result = await resolvePrintAdapter(adapter, doc).submit(buildMailDocument(doc));

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

export interface BatchPrintOutcome {
  batchId: string;
  status: BatchStatus;
  printed: PrintOutcome[];
}

/**
 * Print a whole batch: submit each not-yet-printed document via the vendor, then
 * move the batch printing→historical and stamp printed_at — the v1.3 happy path
 * ("move batch printing→historical on success"). The finalize only runs after
 * every submit succeeds; if any document fails the error propagates and the
 * batch stays where it was, so a partially-failed batch is never marked done.
 * `documentIds` is the set to submit (the caller filters out already-printed
 * docs to avoid double-mailing); an empty set just finalizes the batch.
 */
export async function printBatch(
  client: ProductionClient,
  adapter: MailAdapter | MailAdapterResolver,
  batchId: string,
  documentIds: string[],
  printedAt: string
): Promise<BatchPrintOutcome> {
  const printed: PrintOutcome[] = [];
  for (const id of documentIds) {
    printed.push(await printDocument(client, adapter, id));
  }

  const { error } = await client
    .from("production_batches")
    .update({ status: "historical", printed_at: printedAt })
    .eq("id", batchId);
  if (error) throw new Error(`printBatch finalize failed: ${error.message}`);

  return { batchId, status: "historical", printed };
}

/**
 * Reprint a document: re-submit to the vendor AND write the dedicated audit row
 * (production_reprint_log) — the v1.3 production-audit gate. The audit row is
 * written only after a successful re-submit + persist, because a reprint that
 * never reached the vendor is not a reprint.
 */
export async function reprintDocument(
  client: ProductionClient,
  adapter: MailAdapter | MailAdapterResolver,
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

// ---------------------------------------------------------------------------
// Batch generation — the v1.3 "pick product → pick company → generate" step
// (PLANNING.md /api/production/generate). Pure + DB-free so it is unit-testable;
// the route handler does the DB I/O (load company + customers, insert the batch
// + documents). One mail piece per repair customer, rendered through the shared
// mail-merge engine (src/lib/production/templates.ts) into the print-ready HTML
// the Lob adapter accepts directly (letter `file` / postcard `front`).
// ---------------------------------------------------------------------------

/** Mail product (template) a batch is generated for. Mirrors MailProduct. */
export const MAIL_PRODUCTS = [
  "thank_you",
  "warranty",
  "envelope",
  "service_recovery",
] as const;

export const generateBatchSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  company_id: z.string().uuid(),
  /** Catalog product row (products.id) the batch + documents are stamped with. */
  product_id: z.string().uuid().nullish(),
  /** Mail-merge template to render. Defaults to the warranty letter (single asset). */
  product: z.enum(MAIL_PRODUCTS).default("warranty"),
  /** Subset of the company's repair customers; blank/empty = every customer. */
  repair_customer_ids: z.array(z.string().uuid()).nullish(),
  /** Per-batch vendor override; falls back to the default (lob) via selectVendor. */
  vendor: z.enum(["lob", "inhouse"]).nullish(),
});
export type GenerateBatchInput = z.infer<typeof generateBatchSchema>;

/** The jsonb address shape stored on companies/repair_customers (all optional). */
export type StoredAddressInput =
  | (Partial<Pick<ProductionAddress, "line1" | "city" | "state" | "postal_code">> & {
      line2?: string | null;
    })
  | null
  | undefined;

export interface GenerateCompany {
  id: string;
  name: string;
  phone?: string | null;
  address?: StoredAddressInput;
  /** Per-shop customizations from company_programs.customizations_jsonb. */
  program?: ProgramCustomizations | null;
}

export interface GenerateCustomer {
  id: string;
  first_name: string;
  last_name: string;
  address?: StoredAddressInput;
  vehicle?: string | null;
  service_date?: string | null;
}

/** A production_documents insert payload (batch_id is added by the route). */
export interface GeneratedDocument {
  company_id: string;
  repair_customer_id: string;
  product_id: string | null;
  piece_type: MailPieceType;
  to_address: ProductionAddress;
  from_address: ProductionAddress;
  vendor: MailVendor;
  rendered_url: string | null;
  status: "rendered";
}

export interface BuildBatchDocumentsResult {
  vendor: MailVendor;
  documentCount: number;
  documents: GeneratedDocument[];
  /** Per-customer unresolved merge tokens, so the route can flag thin templates. */
  missingByCustomer: { repairCustomerId: string; tokens: string[] }[];
}

/** Map a stored jsonb address (+ a display name) onto the snapshot we persist. */
function toStoredAddress(name: string, address: StoredAddressInput): ProductionAddress {
  return {
    name,
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? null,
    city: address?.city ?? "",
    state: address?.state ?? "",
    postal_code: address?.postal_code ?? "",
  };
}

/**
 * Build the batch's document rows from the company + its selected repair
 * customers. One document per customer: the to/from addresses are snapshotted
 * (customer rows can change later) and the template is rendered to the HTML the
 * Lob adapter submits directly. Pure: same inputs → same rows, no DB / clock.
 */
export function buildBatchDocuments(
  company: GenerateCompany,
  customers: GenerateCustomer[],
  opts: {
    product: MailProduct;
    productId?: string | null;
    vendor?: MailVendor | null;
    /**
     * Display month/year stamped on every piece in the batch (e.g. "June 2026").
     * The master letters reference `{{customer.letterDate}}`; the route supplies
     * the batch's date so this function stays pure (no clock). Omit to leave the
     * token unresolved (it is then surfaced in `missingByCustomer`).
     */
    letterDate?: string | null;
  }
): BuildBatchDocumentsResult {
  const template = defaultTemplate(opts.product);
  const vendor = selectVendor({ batchVendor: opts.vendor ?? null });
  const from = toStoredAddress(company.name, company.address);

  const documents: GeneratedDocument[] = [];
  const missingByCustomer: { repairCustomerId: string; tokens: string[] }[] = [];

  for (const c of customers) {
    const data: MailMergeData = {
      customer: {
        firstName: c.first_name,
        lastName: c.last_name,
        vehicle: c.vehicle ?? undefined,
        serviceDate: c.service_date ?? undefined,
        // The inside-address block on the master letters reads these from the
        // customer's stored address — the same jsonb snapshotted into to_address
        // below. Without mapping them, a really-mailed piece renders literal
        // `{{customer.addressLine1}}` tokens: the proof path fills them from
        // SAMPLE_MERGE_DATA so proofs look clean while live batches would not.
        addressLine1: c.address?.line1 || undefined,
        city: c.address?.city || undefined,
        state: c.address?.state || undefined,
        zip: c.address?.postal_code || undefined,
        letterDate: opts.letterDate ?? undefined,
      },
      company: {
        name: company.name,
        phone: company.phone ?? undefined,
        city: company.address?.city,
        state: company.address?.state,
      },
      program: company.program ?? {},
    };
    const rendered = renderMailContent(template, data);
    // Letters carry a single `file`; postcards a `front` (the schema stores one
    // rendered asset, so the Lob round-trip is the single-asset letter path).
    const asset = template.pieceType === "postcard" ? rendered.front : rendered.file;

    documents.push({
      company_id: company.id,
      repair_customer_id: c.id,
      product_id: opts.productId ?? null,
      piece_type: template.pieceType,
      to_address: toStoredAddress(`${c.first_name} ${c.last_name}`.trim(), c.address),
      from_address: from,
      vendor,
      rendered_url: asset ?? null,
      status: "rendered",
    });
    if (rendered.missing.length) {
      missingByCustomer.push({ repairCustomerId: c.id, tokens: rendered.missing });
    }
  }

  return { vendor, documentCount: documents.length, documents, missingByCustomer };
}
