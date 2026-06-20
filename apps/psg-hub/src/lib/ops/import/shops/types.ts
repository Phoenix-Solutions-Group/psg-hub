// PSG-139 — PSG shop / PSGID registry: shared types (structure only, no data).
//
// Ported from the standalone `import` repo (`src/lib/shops/registry.ts`), but the
// committed `invoiced-customers.json` data blob is intentionally NOT brought over —
// it is real shop billing data (PII). The shop/PSGID dataset is sourced at runtime
// from the live DB (`public.invoiced_customers`, RLS psg_admin-only) or an
// env/secret-backed loader. See `loader.ts`.
//
// These are type definitions only — a schema, not data.

/**
 * A shop as it appears in the Invoiced customer dataset. The billing-metadata
 * fields are optional and only populated when present in the source `metadata`
 * jsonb; they are never committed to the repo.
 */
export interface InvoicedShop {
  name: string;
  psgId: string;
  invoicedId: number;
  city: string;
  state: string;
  // Billing metadata (optional — older shops may lack these). Sourced from the
  // DB `metadata` jsonb at runtime; never committed.
  nameRate?: number;
  advantageProductId?: string;
  webHostingId?: string;
  webHostingPrice?: number;
  webHostingDiscount?: number;
  dontAddWhm?: boolean;
  customPricingProductId?: string;
  parentInvoicedId?: number;
}

/** A shop entry in the legacy MSO variant registry (used for name-variant matching). */
export interface Shop {
  shopName: string;
  shopNameVariants: string[];
  shopID: string;
  psgID: string;
  invoicedAccountNumber: string;
}

export interface MSOGroup {
  msoName: string;
  msoID: string;
  shops: Shop[];
}

/**
 * Legacy MSO variant registry. Holds curated name variants for fuzzy matching.
 * Sourced from an env/secret-backed loader, never committed with real data — the
 * in-repo default is empty (see `EMPTY_SHOP_REGISTRY`).
 */
export interface ShopRegistry {
  version: string;
  lastUpdated: string;
  msoGroups: MSOGroup[];
}

/** An MSO group auto-detected from a common shop-name prefix. */
export interface MSOAutoGroup {
  msoName: string;
  prefix: string;
  shops: InvoicedShop[];
}

export interface ResolvedShop {
  shopName: string;
  shopID: string;
  psgID: string;
  msoName: string;
  recordCount: number;
}

export interface UnresolvedShop {
  shopName: string;
  recordCount: number;
}

export interface ShopResolution {
  resolved: ResolvedShop[];
  unresolved: UnresolvedShop[];
  sourceColumn: string | null;
}

export interface AutoDetectResult {
  detected: boolean;
  column: string | null;
  resolution: ShopResolution | null;
}

/**
 * Empty MSO variant registry — the safe in-repo default. Real variant data, when
 * needed, is supplied to the resolver via a loader (DB or env), not committed.
 */
export const EMPTY_SHOP_REGISTRY: ShopRegistry = {
  version: "0.0",
  lastUpdated: "",
  msoGroups: [],
};
