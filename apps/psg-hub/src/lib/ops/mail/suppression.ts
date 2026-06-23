// W0 / PSG-221 (PSG-115e) — direct-mail suppression / dedup engine interface.
// Spec: docs/specs/002-mail-send-history-w0/spec.md §3.2.
//
// The direct-mail engine calls isSuppressed(...) BEFORE any send. A recipient is
// suppressed when a rule in public.mail_suppression matches their household_key
// or recipient_hash (and, for a piece-scoped rule, the specific piece) and the
// rule is in effect as of the send date.
//
// The evaluator (evaluateSuppression) is a PURE function over a set of rows so it
// is fully unit-testable without a DB; isSuppressed wraps it with a fetch from the
// service-role client (RLS bypass), with the client injectable for tests. The seed
// helpers build the two seed paths from §3.2: (a) opt-out / bad-address flags from
// the FileMaker exports, and (b) derived "already_mailed (piece, household)" rows
// — ready even before mail_send_history (PSG-216a) lands.

import { householdKey, recipientHash, type HashOptions } from "./household";
import type { AddressInput } from "../import/address";

export type SuppressionScope = "household" | "recipient" | "piece";

export type SuppressionReason =
  | "opt_out"
  | "already_mailed"
  | "bad_address"
  | "deceased"
  | "manual";

/** A persisted suppression rule (the columns the evaluator needs). */
export type SuppressionRow = {
  scope: SuppressionScope;
  household_key: string | null;
  recipient_hash: string | null;
  piece_code: string | null;
  reason: SuppressionReason;
  /** ISO date (YYYY-MM-DD); the rule is in effect from this date forward. */
  effective_from: string;
};

/** A full seed/insert row (rule + idempotency + provenance). */
export type SuppressionSeedRow = SuppressionRow & {
  company_id: string | null;
  source: string;
  suppression_ref: string;
};

export type SuppressionQuery = {
  householdKey?: string | null;
  recipientHash?: string | null;
  /** The piece about to be sent (needed to honor piece-scoped dedup rules). */
  pieceCode?: string | null;
  /** As-of date (ISO YYYY-MM-DD). Defaults to today (UTC). */
  asOf?: string;
};

export type SuppressionResult = {
  suppressed: boolean;
  reason?: SuppressionReason;
};

// Most-restrictive-wins ordering when several rules match (e.g. a household is
// both opted-out and already-mailed → report opt_out). Hard do-not-contact
// reasons outrank the soft per-piece dedup.
const REASON_PRIORITY: Record<SuppressionReason, number> = {
  deceased: 5,
  opt_out: 4,
  bad_address: 3,
  manual: 2,
  already_mailed: 1,
};

/** Today as an ISO date string (UTC), used as the default as-of. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Does a single rule match the query (key + piece + effective date)? */
function ruleMatches(row: SuppressionRow, query: SuppressionQuery, asOf: string): boolean {
  // Not yet in effect as of the send date.
  if (row.effective_from > asOf) return false;

  switch (row.scope) {
    case "household":
      return !!query.householdKey && row.household_key === query.householdKey;
    case "recipient":
      return !!query.recipientHash && row.recipient_hash === query.recipientHash;
    case "piece":
      // Never re-mail THIS piece to THIS household.
      return (
        !!query.householdKey &&
        !!query.pieceCode &&
        row.household_key === query.householdKey &&
        row.piece_code === query.pieceCode
      );
    default:
      return false;
  }
}

/**
 * Pure evaluator: is the recipient in `query` suppressed by any rule in `rows`?
 * Returns the most-restrictive matching reason. No DB, no I/O.
 */
export function evaluateSuppression(
  rows: readonly SuppressionRow[],
  query: SuppressionQuery
): SuppressionResult {
  const asOf = query.asOf ?? todayIso();
  let best: SuppressionReason | undefined;
  for (const row of rows) {
    if (!ruleMatches(row, query, asOf)) continue;
    if (best === undefined || REASON_PRIORITY[row.reason] > REASON_PRIORITY[best]) {
      best = row.reason;
    }
  }
  return best === undefined ? { suppressed: false } : { suppressed: true, reason: best };
}

/** Minimal slice of the supabase client surface the default fetch uses. */
export interface SuppressionQueryClient {
  from(table: string): {
    select: (cols: string) => {
      or: (filter: string) => {
        lte: (
          col: string,
          val: string
        ) => Promise<{ data: SuppressionRow[] | null; error: { message: string } | null }>;
      };
    };
  };
}

export type IsSuppressedOptions = {
  /** Pre-fetched rows (skips DB — used by callers that batch their own load). */
  rows?: readonly SuppressionRow[];
  /** Injectable client for tests; defaults to the service-role client. */
  client?: SuppressionQueryClient;
};

function orFilterFor(query: SuppressionQuery): string {
  const clauses: string[] = [];
  // household_key covers both household- and piece-scoped rules for the household.
  if (query.householdKey) clauses.push(`household_key.eq.${query.householdKey}`);
  if (query.recipientHash) clauses.push(`recipient_hash.eq.${query.recipientHash}`);
  return clauses.join(",");
}

/**
 * Engine entry point. Returns whether the recipient is suppressed and why.
 * Fail-safe: a recipient with no household_key AND no recipient_hash can never be
 * matched, so it is treated as NOT suppressed (the caller validates addressability
 * separately). When `rows` are supplied they are evaluated directly; otherwise the
 * matching candidate rules are fetched (service-role) and evaluated.
 */
export async function isSuppressed(
  query: SuppressionQuery,
  opts: IsSuppressedOptions = {}
): Promise<SuppressionResult> {
  if (opts.rows) return evaluateSuppression(opts.rows, query);

  const orFilter = orFilterFor(query);
  // No keys to match on → nothing can suppress.
  if (orFilter === "") return { suppressed: false };

  const asOf = query.asOf ?? todayIso();
  const client = opts.client ?? (await defaultClient());
  const { data, error } = await client
    .from("mail_suppression")
    .select("scope, household_key, recipient_hash, piece_code, reason, effective_from")
    .or(orFilter)
    .lte("effective_from", asOf);
  if (error) throw new Error(`isSuppressed query failed: ${error.message}`);

  return evaluateSuppression(data ?? [], { ...query, asOf });
}

// Lazily import the service client so this module stays usable (and testable)
// without server-only env. Only reached on the live fetch path.
async function defaultClient(): Promise<SuppressionQueryClient> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  return createServiceClient() as unknown as SuppressionQueryClient;
}

// ---------------------------------------------------------------------------
// Seed builders — produce idempotent SuppressionSeedRow rows for upsert
// ON CONFLICT (suppression_ref). PII-min: only the salted keys are ever stored.
// ---------------------------------------------------------------------------

/** Stable idempotency key for a suppression rule. */
export function buildSuppressionRef(
  reason: SuppressionReason,
  scope: SuppressionScope,
  key: string,
  pieceCode?: string | null
): string {
  return scope === "piece"
    ? `${reason}:${scope}:${pieceCode ?? ""}:${key}`
    : `${reason}:${scope}:${key}`;
}

export type FlagSeedInput = {
  name?: string | null;
  address: AddressInput;
  reason: Extract<SuppressionReason, "opt_out" | "bad_address" | "deceased" | "manual">;
  effectiveFrom: string;
  companyId?: string | null;
  source?: string;
  hash?: HashOptions;
};

/**
 * Seed path (a): an opt-out / bad-address / deceased flag from the FileMaker
 * exports. opt_out + deceased suppress the whole household (any piece, any name
 * at that address won't be re-mailed); bad_address is recipient-scoped (a fixed
 * address for a sibling at the same house should still mail). Returns null when
 * the row has no usable key.
 */
export function flagSuppressionRow(input: FlagSeedInput): SuppressionSeedRow | null {
  const source = input.source ?? "filemaker";
  // bad_address is specific to the recipient's mailing record; opt_out/deceased/
  // manual apply to the household.
  if (input.reason === "bad_address") {
    const rh = recipientHash(input.name, input.address, input.hash);
    if (rh === "") return null;
    return {
      scope: "recipient",
      household_key: null,
      recipient_hash: rh,
      piece_code: null,
      reason: input.reason,
      effective_from: input.effectiveFrom,
      company_id: input.companyId ?? null,
      source,
      suppression_ref: buildSuppressionRef(input.reason, "recipient", rh),
    };
  }
  const hk = householdKey(input.address, input.hash);
  if (hk === "") return null;
  return {
    scope: "household",
    household_key: hk,
    recipient_hash: null,
    piece_code: null,
    reason: input.reason,
    effective_from: input.effectiveFrom,
    company_id: input.companyId ?? null,
    source,
    suppression_ref: buildSuppressionRef(input.reason, "household", hk),
  };
}

export type AlreadyMailedInput = {
  householdKey: string;
  pieceCode: string;
  /** The send date — the dedup rule is in effect from when the piece went out. */
  sentDate: string;
  companyId?: string | null;
  source?: string;
};

/**
 * Seed path (b): a derived "already_mailed (piece, household)" dedup rule from a
 * mail_send_history row. Interface-ready ahead of PSG-216a — a caller maps each
 * send row to one of these and upserts. Never re-mails the same piece to the
 * same household.
 */
export function alreadyMailedRow(input: AlreadyMailedInput): SuppressionSeedRow {
  return {
    scope: "piece",
    household_key: input.householdKey,
    recipient_hash: null,
    piece_code: input.pieceCode,
    reason: "already_mailed",
    effective_from: input.sentDate,
    company_id: input.companyId ?? null,
    source: input.source ?? "derived",
    suppression_ref: buildSuppressionRef(
      "already_mailed",
      "piece",
      input.householdKey,
      input.pieceCode
    ),
  };
}
