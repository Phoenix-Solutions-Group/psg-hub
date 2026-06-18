// v1.1 / PSG-34 — Repair Customers + Repair Orders domain.
// Shared zod schemas + pure workflow logic for the repair-customers / repair-orders
// verticals, reused by the /api/repair-customers[/id] and /api/repair-orders[/id]
// route handlers and unit-tested in isolation. Builds on the 15-00 Ops Foundation
// spine (repair_customers / repair_orders tables) and is gated by the
// manage_companies capability at the route/RLS layers.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Address (shared shape with the Companies vertical).
// ---------------------------------------------------------------------------
export const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postal_code: z.string().optional(),
  })
  .partial();

// ---------------------------------------------------------------------------
// Repair customers.
// ---------------------------------------------------------------------------
export const createRepairCustomerSchema = z.object({
  company_id: z.string().uuid(),
  first_name: z.string().trim().min(1, "first_name is required").max(120),
  last_name: z.string().trim().min(1, "last_name is required").max(120),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")),
  address: addressSchema.nullish(),
});

export const updateRepairCustomerSchema = createRepairCustomerSchema.partial().omit({
  company_id: true,
});

export type CreateRepairCustomerInput = z.infer<typeof createRepairCustomerSchema>;

// Sortable columns for the list view (allow-list — never interpolate raw input).
export const REPAIR_CUSTOMER_SORT_COLUMNS = [
  "last_name",
  "first_name",
  "created_at",
  "updated_at",
] as const;
export type RepairCustomerSortColumn = (typeof REPAIR_CUSTOMER_SORT_COLUMNS)[number];

export function resolveSort(
  column: string | null | undefined,
  direction: string | null | undefined,
): { column: RepairCustomerSortColumn; ascending: boolean } {
  const col = (REPAIR_CUSTOMER_SORT_COLUMNS as readonly string[]).includes(column ?? "")
    ? (column as RepairCustomerSortColumn)
    : "last_name";
  const ascending = direction !== "desc";
  return { column: col, ascending };
}

// ---------------------------------------------------------------------------
// Repair orders.
// ---------------------------------------------------------------------------
export const RO_STATUSES = ["open", "preview", "cancelled", "closed"] as const;
export type RoStatus = (typeof RO_STATUSES)[number];

export const createRepairOrderSchema = z.object({
  repair_customer_id: z.string().uuid(),
  company_id: z.string().uuid(),
  ro_number: z.string().trim().min(1, "ro_number is required").max(60),
  vehicle_id: z.string().uuid().nullish(),
  insurance_company_id: z.string().uuid().nullish(),
  insurance_agent_id: z.string().uuid().nullish(),
  total_loss_flag: z.boolean().optional().default(false),
  dates_json: z.record(z.string(), z.string()).nullish(),
  payload_jsonb: z.record(z.string(), z.unknown()).nullish(),
});

// Note: payload_jsonb is intentionally NOT updatable here — the
// "Add Additional Document" workflow owns it via the nested ./documents route,
// so general RO edits can't clobber the documents array.
export const updateRepairOrderSchema = z.object({
  ro_number: z.string().trim().min(1).max(60).optional(),
  vehicle_id: z.string().uuid().nullish(),
  insurance_company_id: z.string().uuid().nullish(),
  insurance_agent_id: z.string().uuid().nullish(),
  total_loss_flag: z.boolean().optional(),
  status: z.enum(RO_STATUSES).optional(),
  dates_json: z.record(z.string(), z.string()).nullish(),
});

export type CreateRepairOrderInput = z.infer<typeof createRepairOrderSchema>;

// Additional-document workflow. Documents live on the RO spine inside
// payload_jsonb.documents[] (no separate table — keeps PSG-34 on the spine).
export const addDocumentSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  kind: z.string().trim().max(60).default("other"),
  url: z.string().trim().url().max(1000).nullish().or(z.literal("")),
  note: z.string().trim().max(2000).nullish(),
});

export type RepairOrderDocument = {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  note: string | null;
  added_at: string;
};

/**
 * Append a document to an RO payload, returning a NEW payload object.
 * Pure: callers pass the current payload + a generated id/timestamp so the
 * function stays deterministic and unit-testable.
 */
export function appendDocument(
  payload: Record<string, unknown> | null | undefined,
  doc: { name: string; kind: string; url?: string | null; note?: string | null },
  id: string,
  addedAt: string,
): Record<string, unknown> {
  const base = payload && typeof payload === "object" ? { ...payload } : {};
  const existing = Array.isArray(base.documents) ? (base.documents as RepairOrderDocument[]) : [];
  const entry: RepairOrderDocument = {
    id,
    name: doc.name,
    kind: doc.kind || "other",
    url: doc.url ? doc.url : null,
    note: doc.note ?? null,
    added_at: addedAt,
  };
  return { ...base, documents: [...existing, entry] };
}

// Workflow status transitions. A cancelled or closed RO is terminal.
const ALLOWED_TRANSITIONS: Record<RoStatus, RoStatus[]> = {
  open: ["preview", "cancelled", "closed"],
  preview: ["open", "cancelled", "closed"],
  cancelled: [],
  closed: [],
};

export function canTransition(from: RoStatus, to: RoStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
