// PSG-139 — Shop directory loader: sources the shop/PSGID dataset at runtime.
//
// The standalone `import` repo loaded this from a committed `invoiced-customers.json`
// (real shop billing = PII). Per Ada's PSG-139 decision, that JSON is NOT brought
// into the repo. Instead the dataset is loaded from:
//   1. the live DB — `public.invoiced_customers` (RLS: psg_admin select only), or
//   2. an env/secret-backed JSON blob (`OPS_SHOP_DIRECTORY_JSON`), for CI / offline
//      contexts where the operator supplies the data out-of-band.
//
// Nothing here commits customer data.

import { ShopDirectory } from "./directory";
import type { InvoicedShop } from "./types";

/** A row from `public.invoiced_customers`. */
export interface InvoicedCustomerRow {
  invoiced_id: number | string;
  psg_id: string;
  name: string;
  city: string | null;
  state: string | null;
  parent_invoiced_id: number | string | null;
  /** Original Invoiced customer object; carries optional billing metadata. */
  metadata: Record<string, unknown> | null;
}

/** Minimal structural Supabase client (decoupled + testable). */
export interface ShopDirectoryClient {
  from(table: string): {
    select: (cols: string) => Promise<{
      data: InvoicedCustomerRow[] | null;
      error: { message: string } | null;
    }>;
  };
}

/** Columns the directory needs — billing metadata rides along in `metadata`. */
const SELECT_COLUMNS =
  "invoiced_id, psg_id, name, city, state, parent_invoiced_id, metadata";

/**
 * Map a DB row to an `InvoicedShop`. Canonical columns win; optional billing
 * fields are overlaid from the `metadata` jsonb (the original Invoiced object).
 * Pure + exported so it can be unit-tested without a live client.
 */
export function mapInvoicedRow(row: InvoicedCustomerRow): InvoicedShop {
  const meta = (row.metadata ?? {}) as Partial<InvoicedShop>;
  const parent =
    row.parent_invoiced_id != null
      ? Number(row.parent_invoiced_id)
      : meta.parentInvoicedId;
  return {
    ...meta,
    name: row.name,
    psgId: row.psg_id,
    invoicedId: Number(row.invoiced_id),
    city: row.city ?? meta.city ?? "",
    state: row.state ?? meta.state ?? "",
    parentInvoicedId: parent && parent > 0 ? parent : undefined,
  };
}

/**
 * Load the shop directory from the live DB. The caller supplies the Supabase
 * client and is responsible for choosing the right one: an RLS-scoped server
 * client (psg_admin only) for request paths, or the service client for trusted
 * ingestion. RLS on `invoiced_customers` is the enforcement boundary.
 */
export async function loadShopDirectoryFromDb(
  client: ShopDirectoryClient
): Promise<ShopDirectory> {
  const { data, error } = await client
    .from("invoiced_customers")
    .select(SELECT_COLUMNS);
  if (error) {
    throw new Error(`Failed to load shop directory: ${error.message}`);
  }
  const shops = (data ?? []).map(mapInvoicedRow);
  return new ShopDirectory(shops);
}

/**
 * Build a directory from an env/secret-backed JSON array of `InvoicedShop`.
 * Returns an empty directory when the var is unset or unparseable — fail-closed:
 * resolution degrades to "unresolved", it never crashes the import flow.
 */
export function shopDirectoryFromEnv(
  env: Record<string, string | undefined> = process.env,
  varName = "OPS_SHOP_DIRECTORY_JSON"
): ShopDirectory {
  const raw = env[varName];
  if (!raw) return new ShopDirectory([]);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new ShopDirectory([]);
    return new ShopDirectory(parsed as InvoicedShop[]);
  } catch {
    return new ShopDirectory([]);
  }
}
