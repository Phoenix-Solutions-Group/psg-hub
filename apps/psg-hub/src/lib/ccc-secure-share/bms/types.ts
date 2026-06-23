// PSG-261 / CCC Secure Share Phase 1B — canonical BMS estimate model.
//
// These types describe the *canonical* estimate the BMS parser+mapper produce,
// modelled around the CIECA BMS data dictionary (NOT CCC idiosyncrasies) so
// Mitchell/Audatex are incremental later. Anything without a canonical home is
// collected into `overflow` under the stable dotted-path namespace documented in
// ./README.md.

/** A single estimate line — a part, a labor operation, or a refinish/paint op. */
export type BmsLineKind = "part" | "labor" | "paint" | "other";

export type BmsLineItem = {
  /** 1-based line sequence within the estimate, when present. */
  lineNumber: number | null;
  /** Canonical classification of the line. */
  kind: BmsLineKind;
  /** Operation code/verb (e.g. "Repl", "Repair", "Refinish", "R&I"). */
  operation: string | null;
  /** Free-text line description. */
  description: string | null;
  /** Quantity (parts); null when not applicable. */
  quantity: number | null;
  /** Labor/paint hours; null for non-time lines. */
  hours: number | null;
  /** Per-unit price (parts) or hourly rate (labor), when present. */
  unitPrice: number | null;
  /** Extended/total price for the line. */
  extendedPrice: number | null;
  /** OEM/aftermarket/used part number, when present. */
  partNumber: string | null;
  /** BMS line attributes with no canonical home (dotted-path under bms.line.*). */
  extra: Record<string, string>;
};

/** A supplement record — sequence/linkage back to the base estimate. */
export type BmsSupplement = {
  /** Supplement number as labelled by the estimating system. */
  number: string | null;
  /** Monotonic supplement sequence (0 = base estimate, 1 = first supplement…). */
  sequence: number | null;
  /** Supplement date (ISO yyyy-mm-dd when parseable, else raw string). */
  date: string | null;
  extra: Record<string, string>;
};

export type BmsVehicle = {
  vin: string | null;
  year: string | null;
  make: string | null;
  model: string | null;
};

export type BmsTotals = {
  parts: number | null;
  labor: number | null;
  paint: number | null;
  tax: number | null;
  grandTotal: number | null;
};

export type BmsOwner = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type CccCanonicalEstimate = {
  estimateNumber: string | null;
  roNumber: string | null;
  claimNumber: string | null;
  status: string | null;
  /** Repair facility id as carried in BMS — fed to the shop resolver → PSGID. */
  facilityId: string | null;
  facilityName: string | null;
  vehicle: BmsVehicle;
  owner: BmsOwner;
  totals: BmsTotals;
  lineItems: BmsLineItem[];
  supplements: BmsSupplement[];
  /**
   * CCC/BMS-specific fields with no canonical column, keyed by stable dotted
   * paths (see ./README.md). Lands verbatim in estimates/repair_orders
   * payload_jsonb on commit.
   */
  overflow: Record<string, string>;
};
