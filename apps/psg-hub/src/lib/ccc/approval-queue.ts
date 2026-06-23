/**
 * CCC Secure Share — Phase 3 approval queue: connection state machine (pure).
 * [PSG-267, child 2/3 of PSG-256]. Spec: docs/ops/ccc/phase3-onboarding-consent-ux.md §2/§4 B/§5.
 *
 * This module is PURE — no DB, no network, no clock. The transitions a PSG superadmin drives
 * from the queue (Approve / Decline / Revoke) operate over an injected `CccAccountStore` + an
 * injected timestamp, so the state machine is fully unit-testable with an in-memory fake. The
 * supabase-backed store lives in ./account-store.ts (server-only); the routes glue the two
 * together and write the audit row.
 *
 * The status set is the canonical §2 contract (shared with connection-state.ts, which the
 * shop-facing card binds to). The queue owns ONLY the operator transitions:
 *
 *   pending_review ──Approve──► connected      (requires the row linked to a PSGID / shop_id)
 *   pending_review ──Decline──► declined       (requires a reason, ≤280 chars)
 *   connected|error ──Revoke──► not_connected  (stops the feed; credential teardown is Phase 1/2)
 *
 * The UI never sets connected/error from ingest health here — those edges are owned by Phase 2
 * ingest / Phase 4 health (spec §3.3). Every transition stamps `last_event_at` + a label so both
 * surfaces show a fresh "Last event …" line.
 *
 * Invariants:
 *   - Approve is rejected unless the row is linked to a shop (no orphan connections, spec §4 B);
 *   - Decline requires a non-empty reason;
 *   - each action only fires from its allowed source state (a second/double-click is rejected).
 */

import type { CccConnectionStatus } from "@/lib/ccc/connection-state";

/* -------------------------------------------------------------------------- */
/* Types.                                                                     */
/* -------------------------------------------------------------------------- */

/** The subset of ccc_accounts (Phase 1A + Phase 3 §5) the queue reads/writes. */
export interface CccAccountRow {
  id: string;
  shop_id: string | null;
  ccc_account_id: string;
  facility_id: string | null;
  connection_status: CccConnectionStatus;
  enabled_at: string | null;
  last_event_at: string | null;
  last_event_label: string | null;
  approved_by: string | null;
  approved_at: string | null;
  declined_reason: string | null;
  error_reason: string | null;
}

export type CccQueueAction = "approve" | "decline" | "revoke";

/** Maps a queue action to its audited vocabulary key (kept in sync with AUDIT_ACTIONS). */
export const CCC_AUDIT_ACTION: Record<CccQueueAction, string> = {
  approve: "ccc.connection.approve",
  decline: "ccc.connection.decline",
  revoke: "ccc.connection.revoke",
};

export const MAX_DECLINE_REASON = 280;

/** Raised when a transition is rejected by the state machine (→ HTTP 409). */
export class CccTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CccTransitionError";
  }
}

/* -------------------------------------------------------------------------- */
/* State machine (pure).                                                       */
/* -------------------------------------------------------------------------- */

/** Source states each operator action is allowed to fire from (spec §2). */
const ALLOWED_FROM: Record<CccQueueAction, ReadonlySet<CccConnectionStatus>> = {
  approve: new Set<CccConnectionStatus>(["pending_review"]),
  decline: new Set<CccConnectionStatus>(["pending_review"]),
  // Revoke an active OR errored connection — both stop a (possibly broken) feed (spec §3.4).
  revoke: new Set<CccConnectionStatus>(["connected", "error"]),
};

/**
 * Validate that `action` may fire from `current`. Pure, unit-testable, no row mutation.
 * A second decision on an already-resolved row is rejected so a double-click or two reviewers
 * cannot flip a verdict or revoke twice.
 */
export function validateCccTransition(
  action: CccQueueAction,
  current: CccConnectionStatus,
): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_FROM[action].has(current)) {
    return {
      ok: false,
      reason: `cannot ${action} a connection in state "${current}"`,
    };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Persistence surface (injected; faked in tests, supabase in ./account-store.ts). */
/* -------------------------------------------------------------------------- */

export interface CccAccountStore {
  /** Load one account row by id, or null. */
  get(id: string): Promise<CccAccountRow | null>;
  /** Patch a row by id; returns the updated row. */
  update(id: string, patch: Partial<CccAccountRow>): Promise<CccAccountRow>;
  /** All accounts, optionally filtered to a set of connection states, newest enable first. */
  list(statuses?: CccConnectionStatus[]): Promise<CccAccountRow[]>;
}

/* -------------------------------------------------------------------------- */
/* Orchestration (pure given an injected store + clock).                       */
/* -------------------------------------------------------------------------- */

export interface ApproveArgs {
  id: string;
  /** Acting superadmin's profile id (auth.uid()). */
  actorProfileId: string;
  /**
   * Optional shop link applied before approving. The queue forces a link on unmatched rows
   * (spec §4 B); passing shopId here links-then-approves in one step. If the row is already
   * linked, omit it.
   */
  shopId?: string | null;
  /** ISO timestamp (injected for deterministic tests). */
  now: string;
}

/**
 * Approve a pending connection → `connected`. Rejected unless the row is linked to a PSGID
 * (no orphan connections, spec §4 B) — pass `shopId` to link an unmatched row in the same call.
 * Stamps approval attribution + last_event.
 */
export async function approveCccConnection(
  store: CccAccountStore,
  args: ApproveArgs,
): Promise<CccAccountRow> {
  if (!args.actorProfileId) {
    throw new CccTransitionError("approveCccConnection: actorProfileId is required");
  }
  const existing = await store.get(args.id);
  if (!existing) throw new CccTransitionError(`ccc account ${args.id} not found`);

  const check = validateCccTransition("approve", existing.connection_status);
  if (!check.ok) throw new CccTransitionError(check.reason);

  // No orphan connections: the row must be linked to a shop after applying any inline link.
  const shopId = args.shopId ?? existing.shop_id;
  if (!shopId) {
    throw new CccTransitionError(
      "cannot approve: connection is not linked to a shop (PSGID). Link it first.",
    );
  }

  return store.update(args.id, {
    shop_id: shopId,
    connection_status: "connected",
    approved_by: args.actorProfileId,
    approved_at: args.now,
    last_event_at: args.now,
    last_event_label: "Connection approved",
    // A fresh approval clears any prior decline/error context.
    declined_reason: null,
    error_reason: null,
  });
}

export interface DeclineArgs {
  id: string;
  actorProfileId: string;
  /** Required, free-text, ≤280 chars (spec §3.2). Shown to the shop. */
  reason: string;
  now: string;
}

/** Decline a pending connection → `declined` with a required, shop-facing reason. */
export async function declineCccConnection(
  store: CccAccountStore,
  args: DeclineArgs,
): Promise<CccAccountRow> {
  if (!args.actorProfileId) {
    throw new CccTransitionError("declineCccConnection: actorProfileId is required");
  }
  const reason = args.reason?.trim();
  if (!reason) {
    throw new CccTransitionError("declineCccConnection: a decline reason is required");
  }
  if (reason.length > MAX_DECLINE_REASON) {
    throw new CccTransitionError(
      `declineCccConnection: reason exceeds ${MAX_DECLINE_REASON} characters`,
    );
  }

  const existing = await store.get(args.id);
  if (!existing) throw new CccTransitionError(`ccc account ${args.id} not found`);

  const check = validateCccTransition("decline", existing.connection_status);
  if (!check.ok) throw new CccTransitionError(check.reason);

  return store.update(args.id, {
    connection_status: "declined",
    declined_reason: reason,
    last_event_at: args.now,
    last_event_label: "Request declined",
  });
}

export interface RevokeArgs {
  id: string;
  actorProfileId: string;
  now: string;
}

/**
 * Revoke a connected (or errored) connection → `not_connected`. Stops new events; no data is
 * deleted (spec §3.4). The ingest credential teardown is owned by Phase 1/2 — this is the
 * connection-state transition the queue drives.
 */
export async function revokeCccConnection(
  store: CccAccountStore,
  args: RevokeArgs,
): Promise<CccAccountRow> {
  if (!args.actorProfileId) {
    throw new CccTransitionError("revokeCccConnection: actorProfileId is required");
  }
  const existing = await store.get(args.id);
  if (!existing) throw new CccTransitionError(`ccc account ${args.id} not found`);

  const check = validateCccTransition("revoke", existing.connection_status);
  if (!check.ok) throw new CccTransitionError(check.reason);

  return store.update(args.id, {
    connection_status: "not_connected",
    last_event_at: args.now,
    last_event_label: "Connection revoked",
    error_reason: null,
  });
}
