// PSG-352 (PSG-358) — canonical invoiced-$ + pay-type normalization for repair_orders.
//
// repair_orders has historically had NO canonical invoiced-amount or pay-type
// column: the figures lived sparsely and disjointly in payload_jsonb (CCC/BMS
// wrote "bms.totals.grandTotal"; Advantage2.0 wrote advantage2.payType — they
// never co-occur). PSG-352 lands the canonical columns
// (repair_orders.repair_amount_cents + repair_orders.pay_type); these two pure
// helpers are the single normalization the importer AND the backfill migration
// share, so a value populated at insert time and a value backfilled from an old
// payload are derived by identical rules.
//
// HONEST SOURCING (held across PSG-48 / PSG-46): a missing/unparseable amount is
// NULL, never 0 — a fabricated $0 would understate every aggregation report.
// An unrecognized pay-type string is NULL, never a bogus bucket.

/** Canonical pay-type buckets — mirrors the repair_orders.pay_type CHECK. */
export const PAY_TYPES = ["insurance", "customer", "internal", "warranty"] as const;
export type PayType = (typeof PAY_TYPES)[number];

/**
 * Convert a dollar amount to integer cents (avoids float drift in aggregation).
 * Accepts a number or a human string ("$1,234.56", " 1234.56 "). Returns null
 * for null/undefined/empty/non-finite input — NEVER 0 for a missing amount.
 */
export function dollarsToCents(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return null;
    n = Number(cleaned);
  }
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Aliases → canonical bucket. Keys are lowercased + trimmed; matching is EXACT
 * (not substring) so a free-text value never lands in the wrong bucket via a
 * coincidental fragment — honest sourcing favors a blank over a wrong cell.
 *
 * This map is the single source of truth: the SQL backfill in
 * 20260624160000_repair_orders_amount_paytype.sql mirrors it one-for-one as a
 * CASE on lower(btrim(...)). Add a real Advantage2.0 `RC_PayType` /
 * `Cust_Demo_Pay_Type` value here AND in that CASE; document anything new.
 */
const PAY_TYPE_ALIASES: Readonly<Record<string, PayType>> = {
  // insurance — carrier / third-party-paid
  insurance: "insurance",
  ins: "insurance",
  claim: "insurance",
  "3rd party": "insurance",
  "third party": "insurance",
  // customer — self-pay / retail
  customer: "customer",
  cust: "customer",
  "customer pay": "customer",
  cp: "customer",
  self: "customer",
  retail: "customer",
  // internal — comeback / rework (no external payer)
  internal: "internal",
  comeback: "internal",
  rework: "internal",
  // warranty — manufacturer / factory
  warranty: "warranty",
  "mfg warranty": "warranty",
  factory: "warranty",
};

/**
 * Normalize a raw source pay-type token onto a canonical bucket, or null when it
 * matches no alias (constraint-safe; honest — no invented bucket). Case- and
 * surrounding-whitespace-insensitive, exact-alias match (see PAY_TYPE_ALIASES).
 */
export function normalizePayType(raw: string | null | undefined): PayType | null {
  if (raw == null) return null;
  const key = raw.trim().toLowerCase();
  if (key === "") return null;
  return PAY_TYPE_ALIASES[key] ?? null;
}
